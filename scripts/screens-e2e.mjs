/**
 * THE visual/layout regression harness. Every screen, every width, looked at
 * AND checked.
 *
 *   bash scripts/e2e.sh scripts/screens-e2e.mjs                # the CI set
 *   SWEEP_FULL=1   bash scripts/e2e.sh scripts/screens-e2e.mjs # + device profiles
 *   SWEEP_WIDTHS=320 bash scripts/e2e.sh scripts/screens-e2e.mjs  # one width
 *
 * It replaced four hand-run screenshot scripts, and the lesson they encode
 * between them is the reason this one asserts: A TOUR THAT CANNOT FAIL IS A
 * SCREENSHOT GENERATOR. The closest of them wrapped its whole body in a
 * try/catch that logged and continued, so it reported success either way — and
 * had rotted to clicking "People" as a top-level button long after that moved
 * into the More sheet. So: this exits non-zero, and `app/src/ciCoverage.test.ts`
 * fails if CI ever stops running it.
 *
 * WHAT IT CHECKS, and the bug each one is here for:
 *   - the page never scrolls sideways         the classic responsive failure a
 *                                             top-of-page shot never reveals
 *   - no two same-layer controls overlap      the search chips crowding the
 *                                             board dropdown — at one width and
 *                                             not another
 *   - every screen has a way out              Stats shipped with no Back and no
 *                                             tab bar: a dead end on a phone
 *                                             browser, where there is no
 *                                             hardware Back either
 *   - the right board layout rendered         columns vs swipe, vs the
 *                                             breakpoint read from source
 *   - targets under 44px are REPORTED         not failed — informational
 *
 * Deliberately NOT checked: a generic "is any text truncated". It fires on every
 * intentional `numberOfLines` clamp in the app and would drown the real signal.
 * Scope that check to the surface that needs it, as stats-e2e does for its axis.
 *
 * A CARD IS THREE SCREENS, not one: at rest, with the description editor open,
 * and with the comment composer in use. The editors add a toolbar row and a
 * Save/Cancel row that exist in no other state, and 320px is where they run out
 * of room — so they are toured like any other screen rather than trusted because
 * the card underneath them measured fine.
 *
 * Seeding goes through the Admin SDK: deterministic, seconds not minutes, and
 * clients cannot write most of it anyway. The seeded description deliberately
 * uses every element of the vocabulary, so these shots show real formatting.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { RULES_VERSION } from '../packages/shared/lib/report.js';
import { PORTS, PROJECT } from './lib/emulators.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { RULES_TITLE, agreeToRules } from './lib/rules.mjs';

/** First sign-ins that took the app's Try again (lib/signin.mjs), printed with the results. */
const tally = tryAgainTally();

const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORTS.web}/`;
const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = resolve(ROOT, 'shots', 'screens');
const FULL = process.env.SWEEP_FULL === '1';

process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, ...(ok ? {} : { detail }) });
  // Detail describes the FAILURE, so it is printed only when there is one.
  // Appending it to a passing line produced `ok ... — no Back and no tab bar`,
  // which reads as the opposite of what happened.
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

/**
 * Approve + set a role, the way an admin does. `grant-admin.mjs` only makes
 * admins, and an account left `pending` cannot see a board at all.
 *
 * These two are fixtures for the board tours, so their acceptance of the
 * institute's rules is written here as acceptRules would write it. The rules
 * SCREEN is toured as Faisal, at every width, below.
 */
const setUserRole = async (email, role) => {
  const snap = await db.collection('users').where('email', '==', email).get();
  const ref = snap.docs[0].ref;
  await ref.update({
    role,
    status: 'active',
    rulesVersion: RULES_VERSION,
    rulesAcceptedAt: FieldValue.serverTimestamp(),
  });
  const { getAuth } = await import('firebase-admin/auth');
  await getAuth().setCustomUserClaims(ref.id, { role, status: 'active' });
};

const grantAdmin = (email) =>
  new Promise((res, rej) => {
    const c = spawn('node', [resolve(ROOT, 'scripts/grant-admin.mjs'), email], {
      env: { ...process.env },
      stdio: 'pipe',
    });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`grant-admin exited ${code}`))));
  });

/**
 * The breakpoint comes from the SOURCE, never from a copy here.
 * A constant restated in a test drifts from the thing it is testing — that has
 * already happened once in this repo.
 */
const layoutSrc = await readFile(resolve(ROOT, 'app/src/theme/layout.ts'), 'utf8');
const WIDE_BREAKPOINT = Number(layoutSrc.match(/WIDE_BREAKPOINT\s*=\s*(\d+)/)?.[1] ?? 768);

/**
 * Widths chosen to straddle the breakpoint rather than to look thorough: a bug
 * on one side of it is invisible from the other, which is how `Screen`'s
 * phone-only spacing gap survived. One below, one at, one above, one wide.
 */
const WIDTHS = process.env.SWEEP_WIDTHS
  ? process.env.SWEEP_WIDTHS.split(',').map(Number)
  : [320, 390, WIDE_BREAKPOINT, 1024, 1440];
/** Real descriptors add DPR, touch and UA, which plain widths do not. */
const PROFILES = FULL
  ? [['iphone-se', devices['iPhone SE']], ['pixel-7', devices['Pixel 7']], ['ipad-mini', devices['iPad Mini']]]
  : [];

// A clean folder, so the report (`sabeel-ci screens-report`) shows this run's
// screens and no other's, and the checks beside them however the run ends.
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });
process.on('exit', () => writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 1)));
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const browser = await chromium.launch();

// ---- Provision, then seed against the real uid -----------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'faisal', exact: true }).click();
  tally.note('faisal', await settle(page, page.getByText('Waiting for approval')));
  await grantAdmin('faisal@oursabeel.com');
  await agreeToRules(page);
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 25000 });
  await ctx.close();
}

/**
 * A BOARD OWNER and a plain MEMBER as well as the admin.
 *
 * Every screen in this sweep was toured as an admin, so gated and member-only
 * layouts had no coverage at any width — the one place a bug is invisible to the
 * person who owns the app, because they never render it.
 *
 * Sara is seeded as an `organizer` AND into the board's `boardOwnerUids`, and
 * the pair is deliberate: the org role lets her start boards of her own and
 * grants nothing on this one, while the ownership entry is what gives her the
 * controls below. Omar is a member of the board and an owner of nothing, so his
 * run is the read-only side of the same screen.
 */
async function provision(who, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: who, exact: true }).click();
  tally.note(who, await settle(page, page.getByText('Waiting for approval')));
  await ctx.close();
  const snap = await db.collection('users').where('email', '==', email).get();
  if (snap.empty) throw new Error(`${who} was never provisioned`);
  return snap.docs[0].id;
}
const ownerUid = await provision('sara', 'sara@oursabeel.com');
const memberUid = await provision('omar', 'omar@oursabeel.com');
await setUserRole('sara@oursabeel.com', 'organizer');
await setUserRole('omar@oursabeel.com', 'member');

const users = await db.collection('users').where('email', '==', 'faisal@oursabeel.com').get();
if (users.empty) throw new Error('the dev account was never provisioned');
const uid = users.docs[0].id;

const now = Date.now();
const BOARD = 'sw_board';
await db.doc('labels/sw_l1').set({ name: 'Finance', color: '#83114F', createdAt: now, createdBy: uid });
await db.doc('labels/sw_l2').set({ name: 'Outreach', color: '#A8B89A', createdAt: now, createdBy: uid });
/*
 * A label shaped like the one that broke Board settings: an emoji prefix and a
 * name too long for the row. The name was not allowed to give way, so it pushed
 * its own delete button off the right edge of the screen.
 */
await db.doc('labels/sw_l3').set({
  name: '\u{1F535} Waiting on a much longer answer',
  color: '#3E6B8A',
  createdAt: now,
  createdBy: uid,
});
await db.doc(`boards/${BOARD}`).set({
  name: 'Fundraising 2026',
  description: 'A board with enough on it to lay out properly.',
  archived: false,
  columns: [
    { id: 'c1', name: 'To Do' },
    { id: 'c2', name: 'In Progress' },
    // Deliberately long: the phone pager centres the column NAME and lets the
    // pencil hang to its right, sliding the pair left rather than truncating
    // early. A board of short names never exercises that and the sweep would
    // photograph a layout nobody had tested.
    { id: 'c3', name: 'Waiting on the finance committee' },
  ],
  columnIds: ['c1', 'c2', 'c3'],
  memberUids: [uid, ownerUid, memberUid],
  // Two owners, and neither is the whole story: Faisal owns it because he made
  // it, Sara because she was given it. Omar is a member of the board and an
  // owner of nothing, which is the case the read-only roster exists for.
  boardOwnerUids: [uid, ownerUid],
  memberProfiles: {
    [uid]: { displayName: 'Faisal', email: 'faisal@oursabeel.com' },
    [ownerUid]: { displayName: 'Sara', email: 'sara@oursabeel.com' },
    [memberUid]: { displayName: 'Omar', email: 'omar@oursabeel.com' },
  },
  activeCardCount: 0,
  createdAt: now,
  createdBy: uid,
});

/**
 * A board with NO columns, which is a reachable state: `columnDeleteBlocked`
 * only refuses a column that still holds cards, so the last empty one can go.
 * It exists here because the phone board hangs its board-level actions off the
 * column footer, and with no columns there is no footer — which was a dead end
 * with no way back into Board settings to add one.
 */
await db.doc('boards/sw_empty').set({
  name: 'Empty board',
  description: '',
  archived: false,
  columns: [],
  columnIds: [],
  memberUids: [uid],
  boardOwnerUids: [uid],
  memberProfiles: { [uid]: { displayName: 'Faisal', email: 'faisal@oursabeel.com' } },
  activeCardCount: 0,
  createdAt: now,
  createdBy: uid,
});

/**
 * A board with NO OWNER — the state the migration deliberately produces.
 *
 * The backfill writes an empty owner list wherever a board's creator has left
 * it, and an admin repairs those by hand on day one. Nothing else exercises that
 * state: `b_legacy` in the rules suite is a board MISSING the field, which is a
 * different shape, and every UI fixture has an owner. What has to hold is that
 * an admin can still open its settings and give somebody ownership — otherwise
 * the repair path the whole plan rests on does not exist.
 */
await db.doc('boards/sw_ownerless').set({
  name: 'Nobody owns this',
  description: '',
  archived: false,
  columns: [{ id: 'o1', name: 'To Do' }],
  columnIds: ['o1'],
  memberUids: [uid, memberUid],
  boardOwnerUids: [],
  memberProfiles: {
    [uid]: { displayName: 'Faisal', email: 'faisal@oursabeel.com' },
    [memberUid]: { displayName: 'Omar', email: 'omar@oursabeel.com' },
  },
  activeCardCount: 0,
  createdAt: now,
  createdBy: uid,
});

// Content chosen to STRESS layout: a long title, every priority, labels and an
// assignee on each, so card faces are at their widest.
const CARDS = [
  ['sw_card1', 'c1', 'Book the venue for the spring fundraiser', 'urgent'],
  ['sw_card2', 'c1', 'Draft the donor letter', 'high'],
  ['sw_card3', 'c2', 'Reconcile the Q2 accounts', 'medium'],
  ['sw_card4', 'c3', 'Thank the volunteers', 'none'],
  ['sw_card5', 'c1', 'A deliberately long card title that has to wrap somewhere sensible', 'low'],
];
for (const [id, columnId, title, priority] of CARDS) {
  await db.doc(`cards/${id}`).set({
    boardId: BOARD, title, columnId, priority,
    description:
      'Confirm the **deposit** and the *date* before Friday.\n\n- call the hall\n- send the [contract](https://example.org/contract)\n\n1. deposit\n2. signature\n\nVenue notes: https://example.org/venue',
    rank: `V${id.slice(-1)}`,
    assigneeUids: [uid], subscriberUids: [uid], labelIds: ['sw_l1', 'sw_l2'],
    dueDate: '2026-08-15', archived: false,
    // 0, NOT 1: `onCommentWritten` increments this when the comment doc
    // below is created, so seeding both made every card read "Comments (2)"
    // with one comment under it.
    commentCount: 0,
    createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
  });
  await db.doc(`cards/${id}/comments/cm1`).set({
    authorUid: uid,
    body: 'A **formatted** comment, so the rendered thread is measured too:\n\n- with a bullet\n- and [a link](https://example.org)',
    mentionUids: [], createdAt: now,
  });
}
await db.doc('cards/sw_archived').set({
  boardId: BOARD, title: 'An archived card', description: '', columnId: 'c1', rank: 'Vz',
  assigneeUids: [], labelIds: [], priority: 'none', archived: true, archivedAt: now,
  commentCount: 0, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
});
await db.doc(`users/${uid}/notifications/n1`).set({
  type: 'assigned', boardId: BOARD, cardId: 'sw_card1', actorUid: uid,
  text: 'Faisal assigned you "Book the venue for the spring fundraiser"',
  read: false, at: now,
});
await db.doc(`users/${uid}`).update({ unreadNotifCount: 1 });
console.log(`  seeded 1 board, ${CARDS.length} cards, 2 labels, 1 archived card, 1 alert`);
console.log(`  breakpoint read from source: ${WIDE_BREAKPOINT}px\n`);

// ---- Assertions ------------------------------------------------------------
const layoutFaults = (page, width) =>
  page.evaluate((w) => {
    const faults = [];
    // Inner horizontal scrollers (the board, the chart) are their own elements,
    // so the PAGE should never widen. This is the classic responsive failure a
    // top-of-page screenshot never reveals.
    const bleed = document.documentElement.scrollWidth - w;
    if (bleed > 1) faults.push(`page scrolls sideways by ${bleed}px`);

    /**
     * The part of an element you can actually SEE.
     *
     * `getBoundingClientRect` reports where an element would be, not what is
     * visible: a card scrolled halfway out of its list still returns its full
     * height, so it geometrically "overlaps" whatever sits below the list — the
     * bottom nav, in the first version of this check, on every screen with more
     * content than fits. Clipping an ancestor does not shrink the rect, so the
     * rect has to be clipped here instead.
     */
    const visibleRect = (el) => {
      let r = el.getBoundingClientRect();
      for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const o = getComputedStyle(n).overflow + getComputedStyle(n).overflowY;
        if (!/hidden|auto|scroll/.test(o)) continue;
        const c = n.getBoundingClientRect();
        r = {
          left: Math.max(r.left, c.left),
          right: Math.min(r.right, c.right),
          top: Math.max(r.top, c.top),
          bottom: Math.min(r.bottom, c.bottom),
        };
      }
      // And by the viewport itself.
      return {
        left: Math.max(r.left, 0),
        right: Math.min(r.right, window.innerWidth),
        top: Math.max(r.top, 0),
        bottom: Math.min(r.bottom, window.innerHeight),
      };
    };
    const area = (r) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

    /** The nearest positioned ancestor — a fixed nav, a modal, or the page. */
    const layerOf = (el) => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky' || pos === 'absolute') return n;
      }
      return document.body;
    };

    // Only things actually on screen: an element scrolled out of view cannot
    // overlap anything a person can see.
    const els = [...document.querySelectorAll('[role="button"], [role="radio"]')].filter(
      (e) => area(visibleRect(e)) > 4,
    );
    const name = (e) => (e.getAttribute('aria-label') || e.textContent || '?').trim().slice(0, 22);
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        // Nesting is legitimate (a control inside a pressable row); two
        // INDEPENDENT controls sharing pixels is not.
        if (a.contains(b) || b.contains(a)) continue;
        // Neither is overlap ACROSS LAYERS. The bottom nav is fixed and content
        // scrolls beneath it by design; so does a sheet over a screen. Only
        // controls in the SAME layer are laid out against each other, so that is
        // the only pair worth comparing — the first version of this check
        // reported every search result "overlapping" the nav bar at 320px.
        if (layerOf(a) !== layerOf(b)) continue;
        const ra = visibleRect(a), rb = visibleRect(b);
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 1 && oy > 1) {
          faults.push(`"${name(a)}" overlaps "${name(b)}" by ${Math.round(ox)}x${Math.round(oy)}px`);
        }
      }
    }
    /*
     * NOTHING MAY BE CLIPPED BY THE RIGHT EDGE.
     *
     * Distinct from "the page scrolls sideways": a row can overflow inside a
     * clipping ancestor, so the page width never changes and the sideways check
     * stays green while a control is sliced in half at the boundary. That is
     * how a label with a long name carried its own delete button off screen.
     * Only elements with visible area are considered, so the pager's
     * off-screen pages — laid out to the right by design — are not flagged.
     */
    for (const e of els) {
      const raw = e.getBoundingClientRect();
      if (raw.right > w + 1 && area(visibleRect(e)) > 4) {
        faults.push(`"${name(e)}" is clipped by the right edge (${Math.round(raw.right - w)}px past)`);
      }
    }

    /*
     * NO INTERACTIVE CONTENT NESTED INSIDE A <button>.
     *
     * `accessibilityRole="button"` does not add an ARIA attribute on web —
     * react-native-web maps it to a real <button> ELEMENT. Put that on a
     * Pressable that wraps other things and the result is invalid HTML, and the
     * browser resolves it by treating keys pressed in the nested control as
     * activating the button. That is how a space typed into the new-label field
     * dismissed the whole sheet: the Sheet backdrop was a <button> wrapping the
     * dialog and its TextInput.
     *
     * Checked structurally rather than per-component, because the shape is what
     * is wrong and it can be reintroduced anywhere a Pressable gains a role and
     * a child. Cheap: one querySelectorAll over the rendered page.
     */
    for (const b of document.querySelectorAll('button')) {
      const nested = b.querySelector('input, textarea, select, button, a[href], [contenteditable="true"]');
      if (nested) {
        faults.push(
          `<button> "${name(b)}" contains a nested <${nested.tagName.toLowerCase()}> — ` +
            'invalid HTML; keys pressed inside it can activate the button',
        );
      }
    }

    return [...new Set(faults)];
  }, width);

/**
 * Can you LEAVE this screen without the browser's Back?
 *
 * The bottom bar renders on tab roots only (`isTabRoot`), so a pushed screen on a
 * phone has exactly one exit: its own Back control. `StatsScreen` shipped without
 * one and was a dead end on a phone browser, where there is no hardware Back
 * either — found because the tour got stuck there, which is luck, not a test.
 * Every screen, every width: a Back, or a tab bar. One of the two.
 */
const escapes = (page) =>
  page.evaluate(() => {
    const shown = (e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const label = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
    const controls = [...document.querySelectorAll('[role="button"]')].filter(shown);
    return {
      back: controls.some((e) => /^back$/i.test(label(e))),
      tabs: controls.some((e) => /^(Boards|My Work)$/.test(label(e))),
    };
  });

const smallTargets = (page) =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('[role="button"], [role="radio"]')]
        .map((e) => ({
          n: (e.getAttribute('aria-label') || e.textContent || '?').trim().slice(0, 18),
          r: e.getBoundingClientRect(),
        }))
        .filter((x) => x.r.width > 0 && x.r.height > 0 && x.r.height < 44)
        .map((x) => `${x.n} ${Math.round(x.r.height)}px`),
    ),
  ]);

/**
 * THE INSTITUTE'S RULES, the one screen between approval and every board.
 *
 * Shown once per account, so each width starts by taking Faisal's acceptance
 * away again — the state every account was in before the screen existed — and
 * signing in onto it. Its way out is Sign out, not Back or the tab bar: it is
 * a gate, and nothing behind it may be reachable until "I agree". That is
 * checked here at every width, after the title has drawn, so the absence of
 * the nav means the screen withheld it and not that nothing had loaded yet.
 */
async function rulesScreen(page, tag, width) {
  await page.getByText(RULES_TITLE, { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  const faults = await layoutFaults(page, width);
  check(`${tag} / rules`, faults.length === 0, faults.join('; ').slice(0, 160));
  const gate = await page.evaluate(() => {
    const label = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
    const shown = [...document.querySelectorAll('[role="button"]')]
      .filter((e) => e.getBoundingClientRect().width > 0)
      .map(label);
    return {
      agree: shown.includes('I agree'),
      signOut: shown.includes('Sign out'),
      behind: shown.filter((l) => /^(More|Boards|My Work|Search|Alerts|New board)(,|$)/.test(l)),
    };
  });
  check(
    `${tag} / rules offers I agree and Sign out, and nothing behind it`,
    gate.agree && gate.signOut && gate.behind.length === 0,
    JSON.stringify(gate),
  );
  await page.screenshot({ path: join(SHOTS, `${tag}-rules.png`), fullPage: true });
  await page.getByRole('button', { name: 'I agree', exact: true }).click();
  await page.getByText(RULES_TITLE, { exact: true }).waitFor({ state: 'detached', timeout: 30000 });
}

// ---- The tour --------------------------------------------------------------
const SCREENS = 20;

async function tour(page, tag, width) {
  /**
   * Get back to a tab root, THEN tap the tab.
   *
   * On a narrow layout the bottom bar renders on tab roots only (see
   * `isTabRoot`), so a pushed screen — People, a card, Settings — has no nav to
   * tap and the tour has to walk Back first. The wide rail is always present, so
   * this is a no-op there. Written once here rather than remembered at ten call
   * sites, which is how the old tour drifted.
   */
  const nav = async (label) => {
    for (let i = 0; i < 6; i += 1) {
      // A PREFIX, not an exact match: the Alerts tab announces its badge as
      // "Alerts, 3 unread", so an exact name stops finding it the moment
      // anything is waiting — and this suite seeds exactly that.
      const tab = page
        .getByRole('button', { name: new RegExp(`^${label}(,|$)`) })
        .first();
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(700);
        return;
      }
      const back = page.getByRole('button', { name: 'Back' }).first();
      if (!(await back.isVisible().catch(() => false))) break;
      await back.click();
      await page.waitForTimeout(600);
    }
    throw new Error(`could not reach the "${label}" tab`);
  };
  let seen = 0;

  const visit = async (name, go) => {
    await go();
    await page.waitForTimeout(500);
    const faults = await layoutFaults(page, width);
    check(`${tag} / ${name}`, faults.length === 0, faults.join('; ').slice(0, 160));
    const out = await escapes(page);
    check(`${tag} / ${name} has a way out`, out.back || out.tabs, 'no Back and no tab bar');
    const small = await smallTargets(page);
    if (small.length) console.log(`         under 44px: ${small.join(', ').slice(0, 100)}`);
    await page.screenshot({ path: join(SHOTS, `${tag}-${name}.png`), fullPage: true });
    seen += 1;
  };

  await visit('boards', () => nav('Boards'));

  /*
   * The push nudge is ON this screenshot, and that has to be asserted or the
   * stub above is a screenshot generator.
   *
   * The card renders only while the device can still be asked, and headless
   * Chromium reports 'denied' — so it is here only because an init script
   * replaces the permission getter. Should that quietly stop working (a
   * react-native-web change, a getter that stops being configurable), the card
   * would vanish from every screenshot at every width and all of these checks
   * would still pass, which is exactly the hole the stub was added to close.
   *
   * It is also the layout check for the card itself: it is the one thing in the
   * app whose layout has been got wrong three times, and until now it appeared
   * in no sweep at all.
   */
  check(
    `${tag} / boards shows the push nudge`,
    await page
      .getByRole('button', { name: 'Enable notifications' })
      .first()
      .isVisible()
      .catch(() => false),
    'the permission stub is not taking effect — the card is in no screenshot',
  );

  await visit('mywork', () => nav('My Work'));
  await visit('search', () => nav('Search'));
  /**
   * The search box takes the cursor on a DESKTOP and nowhere else.
   *
   * A phone browser is `Platform.OS === 'web'` too, so keying autofocus off the
   * platform opened the on-screen keyboard over the results on exactly the
   * surface the setting was added to protect. Width is the real question, so it
   * is checked at every width rather than asserted once.
   */
  {
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('placeholder') ?? 'none',
    );
    const wantsCursor = width >= WIDE_BREAKPOINT;
    const hasCursor = focused.startsWith('Search cards');
    check(
      `${tag} / search ${wantsCursor ? 'takes' : 'does not take'} the cursor`,
      hasCursor === wantsCursor,
      `activeElement placeholder = ${focused}`,
    );
  }
  /**
   * The Filters sheet, OPEN with a section expanded.
   *
   * A structural check cannot see a dialog that is never opened, and this one
   * is the shape most likely to break narrow: an accordion, a narrowing field
   * and a capped scrolling list, all inside a modal bounded to 80% of the
   * viewport. At 320x568 that leaves room for exactly one open section, which
   * is why it is an accordion rather than four independent collapsibles — and
   * this is the check that would catch it if that stopped being true.
   */
  await visit('search-filters', async () => {
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    await page.getByRole('button', { name: /^Labels(:| \(|$)/ }).first().click();
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForTimeout(400);

  await visit('alerts', () => nav('Alerts'));
  await visit('stats', async () => {
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Stats' }).click();
  });
  /**
   * Stats with a bar SELECTED, which is the only state the breakdown exists in.
   *
   * On a phone the chart already reaches the fold, so the panel this appends
   * lands entirely off-screen — the one failure mode reading the code cannot
   * show, and the reason the screen scrolls it into view. The seed may leave a
   * quiet chart with no bar to tap, so this falls back to the plain stats
   * screen rather than failing for a reason that is not about layout.
   */
  await visit('stats-detail', async () => {
    const bar = page.getByLabel(/^[1-9]\d* cards created, /).first();
    if (await bar.isVisible().catch(() => false)) {
      await bar.click();
      await page.waitForTimeout(500);
    }
  });
  await visit('people', async () => {
    await nav('Boards');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'People' }).click();
  });

  /**
   * The More sheet, open: it gained Report a problem, with a detail line, and
   * 320px is where a row and its detail run out of room.
   */
  await visit('more', async () => {
    await nav('Boards');
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: /^Report a problem/ }).waitFor({ timeout: 15000 });
  });
  /**
   * Report a problem with a report half-written: the explanation, the field's
   * label, the field holding more than it shows, and Send, at every width.
   */
  await visit('report', async () => {
    await page.getByRole('button', { name: /^Report a problem/ }).click();
    const field = page.getByLabel('What or who are you reporting, and what is wrong?');
    await field.waitFor({ timeout: 15000 });
    await field.fill(
      'The comment on "Book the venue for the spring fundraiser" calls a colleague names.\n\nIt was posted this morning.',
    );
  });

  await visit('board', async () => {
    await nav('Boards');
    await page.getByText('Fundraising 2026').first().click();
    await page.waitForTimeout(1000);
  });

  // Which board layout actually rendered? The pager exists only in the narrow
  // one, and the expectation comes from the source breakpoint rather than a
  // number copied into this file.
  //
  // Probed by ROLE + accessible name, not by visible text: the pager is a pair
  // of arrow icons, so `getByText('Prev')` matches nothing and would report
  // "columns" at every width — a green-looking check that had stopped looking at
  // anything.
  const expected = width >= WIDE_BREAKPOINT ? 'columns' : 'swipe';
  const hasPager = await page
    .getByRole('button', { name: 'Previous column' })
    .first()
    .isVisible()
    .catch(() => false);
  const actual = hasPager ? 'swipe' : 'columns';
  check(`${tag} / board renders the ${expected} layout`, actual === expected, `got ${actual}`);

  /**
   * ONE column's worth of controls in the accessibility tree, not nine.
   *
   * Every column page is laid out so the pager can swipe, so without
   * `aria-hidden` on the off-screen ones a screen reader walks every card of
   * every column and hears "+ Add card" once per column. The DOM count stays
   * high — that is the point of the comparison — while the tree count is one.
   * Playwright's role engine skips aria-hidden subtrees, which is the same rule
   * a screen reader follows, so a role count IS the tree count.
   */
  if (width < WIDE_BREAKPOINT) {
    const inTree = await page.getByRole('button', { name: '+ Add card', exact: true }).count();
    const inDom = await page.evaluate(
      () =>
        [...document.querySelectorAll('[role="button"]')].filter(
          (e) => (e.getAttribute('aria-label') || e.textContent || '').trim() === '+ Add card',
        ).length,
    );
    check(
      `${tag} / only the visible column is in the accessibility tree`,
      inTree === 1 && inDom > 1,
      `tree=${inTree} dom=${inDom}`,
    );
  }

  /**
   * THE LONG COLUMN NAME, which is its own layout problem.
   *
   * The pager centres the column NAME and lets the pencil hang to its right; a
   * name too long for that has to slide the pair LEFT rather than truncate
   * early. Column 3 of the seed is deliberately long, and no other step in this
   * tour ever navigates off column 1, so without this the behaviour ships
   * unphotographed and unchecked.
   */
  if (width < WIDE_BREAKPOINT) {
    const next = page.getByRole('button', { name: 'Next column' });
    await next.click();
    await page.waitForTimeout(400);
    await next.click();
    await page.waitForTimeout(700);
    const longFaults = await layoutFaults(page, width);
    check(
      `${tag} / board with a long column name`,
      longFaults.length === 0,
      longFaults.join('; ').slice(0, 160),
    );
    await page.screenshot({ path: join(SHOTS, `${tag}-board-longname.png`), fullPage: true });

    // Back to column 1 — the card steps below open `.first()` card and would
    // otherwise be looking at a different column's contents.
    const prev = page.getByRole('button', { name: 'Previous column' });
    await prev.click();
    await page.waitForTimeout(400);
    await prev.click();
    await page.waitForTimeout(700);
  }

  /**
   * THE ADD-CARD COMPOSER, OPEN.
   *
   * An open composer is its own layout, exactly as `card-editing`,
   * `card-comment` and `card-sheet` are — and until this entry the sweep had
   * NO screen with any composer open at any width. That is the same blind spot
   * that let a <button> wrapping a TextInput ship: a structural check cannot
   * see a control that is never on screen.
   *
   * It matters most on the narrow board, where the composer is pinned above
   * the keyboard at the bottom of a non-scrolling screen — 320px is where a
   * field, two buttons and the pager have to coexist or something bleeds.
   */
  await visit('board-compose', async () => {
    await page.getByRole('button', { name: '+ Add card' }).first().click();
    await page.getByPlaceholder('Card title').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
  });

  // Close it again before the tour moves on, as `settings` does for
  // `card-sheet`: an open composer holds focus and the steps below tap cards.
  //
  // HOW you close it differs by layout, like selecting does. The wide web board
  // is a raw-DOM composer with no Cancel at all — Escape is its only dismiss —
  // while the narrow layout is the RN one with a Cancel button.
  if (width >= WIDE_BREAKPOINT) {
    await page.keyboard.press('Escape');
  } else {
    await page.getByRole('button', { name: 'Cancel' }).first().click();
  }
  await page.waitForTimeout(500);
  check(
    `${tag} / the add-card composer closes again`,
    (await page.getByPlaceholder('Card title').count()) === 0,
  );

  /**
   * BULK SELECTION, which floats a bar over the board.
   *
   * It had no coverage at all, and it did not fit: six 44px actions are 264px,
   * exactly the inner width at 320px before gaps or the count, so the bar
   * pushed the page sideways and took its own close button off-screen.
   * Selecting differs by layout — wide has a real checkbox per row, narrow has
   * long-press — which is the same split `manual-shots.mjs` documents.
   */
  await visit('bulk', async () => {
    if (width >= WIDE_BREAKPOINT) {
      await page.getByRole('checkbox').first().click();
    } else {
      await page.locator('[data-testid^="card-"]').first().click({ delay: 900 });
    }
    await page.getByText(/\d+ selected/).first().waitFor({ timeout: 15000 });
  });

  // Leave selection mode: while it is active a tap SELECTS a card rather than
  // opening it, so the card steps below would never reach a card screen.
  await page.getByRole('button', { name: 'Clear selection' }).first().click();
  await page.waitForTimeout(700);

  await visit('card', async () => {
    await page.locator('[data-testid^="card-"]').first().click();
    await page.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 20000 });
  });
  /**
   * THE EDITING STATES, which are their own layouts.
   *
   * A card at rest and a card with an editor open are different screens: the
   * editor adds a five-icon toolbar row and a Save/Cancel row, and both have to
   * survive 320px without pushing anything sideways. The rendered card cannot
   * tell you that — every rich-text layout bug so far has been in this state.
   */
  await visit('card-editing', async () => {
    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.locator('[contenteditable="true"]').first().waitFor({ timeout: 20000 });
    // Wait for the TOOLBAR, not just the box — it is the part that can overflow.
    await page.getByRole('button', { name: 'Bold', exact: true }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
  });

  await visit('card-comment', async () => {
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await page.waitForTimeout(600);
    const box = page.locator('[data-testid="comment-editor"]');
    await box.click();
    await page.keyboard.type('Looks good — ');
    // Leaves Bold ACTIVE, so the shot shows the toolbar's selected state.
    await page.getByRole('button', { name: 'Bold', exact: true }).last().click();
    await page.keyboard.type('ready to send');
    await page.waitForTimeout(400);
  });

  /**
   * THE @MENTION POPOVER, OPEN.
   *
   * A floating layer over a composer, and until this entry the sweep had never
   * drawn one — the only picture of it anywhere was an unasserted screenshot in
   * web-e2e. It is now anchored to the CARET rather than pinned above the whole
   * field, so where it lands depends on the width, the wrap and the line: the
   * sweep is exactly the check that catches it clipping an edge at 320px.
   *
   * Typed into the composer left focused by `card-comment`, so this costs no
   * navigation.
   */
  await visit('card-mention', async () => {
    await page.keyboard.type(' @sa');
    await page
      .getByRole('button', { name: /^Mention / })
      .first()
      .waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
  });

  /**
   * A SHEET IS ITS OWN SCREEN, and was the one state never toured.
   *
   * Every overlay in the app goes through `Sheet` — the new-label dialog, the
   * link dialog, Filters, Attach a file, the More menu. None of them were ever
   * on screen during the sweep, so none of their layouts were checked at 320px
   * and none of their DOM was checked at all. That is how the backdrop shipped
   * as a <button> wrapping a TextInput: the structural check cannot see a
   * dialog that is never open.
   *
   * The new-label sheet stands in for all of them: it is the one with a text
   * field, which is the combination that broke.
   */
  await visit('card-sheet', async () => {
    // Escape closes the mention popover left open above. Without it the list
    // floats over the card body and swallows the tap below.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'New label' }).first().click();
    await page.getByPlaceholder(/label name/i).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(400);
  });

  await visit('settings', async () => {
    // Close the sheet left open by `card-sheet` first — a modal swallows the
    // taps this navigation needs. Same shape as `card-comment` closing the
    // description editor above.
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Back' }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Board settings' }).click();
  });
  await visit('archive', async () => {
    await page.getByRole('button', { name: 'Back' }).first().click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Archived cards' }).click();
  });


  /**
   * A BOARD WITH NO COLUMNS still has to be manageable.
   *
   * Narrow only, because that layout keeps Archived cards and Board settings in
   * the column footer — and a board with no columns renders no footer. Board
   * settings is the only way to add a column back, so losing it strands the
   * board. Checked last: it navigates away from the toured board.
   */
  /**
   * The ownerless board: an ADMIN must still be able to run it, because that is
   * the only way one ever gets an owner again. Narrow only, alongside its
   * sibling below — the gate being checked is a role, not a layout.
   */
  if (width < WIDE_BREAKPOINT) {
    await nav('Boards');
    await page.getByText('Nobody owns this').first().click();
    await page.waitForTimeout(1200);
    const onOwnerless = await page.evaluate(() => {
      const name = (e) => (e.getAttribute('aria-label') || '').trim();
      const shown = [...document.querySelectorAll('[role="button"]')].filter(
        (e) => e.getBoundingClientRect().width > 0,
      );
      return {
        settings: shown.some((e) => name(e) === 'Board settings'),
        members: shown.some((e) => name(e) === 'Board members'),
      };
    });
    check(
      `${tag} / an admin can still run a board nobody owns`,
      onOwnerless.settings && !onOwnerless.members,
      JSON.stringify(onOwnerless),
    );
    // …and the roster offers the switch that repairs it.
    await page.getByRole('button', { name: 'Board settings' }).click();
    const repairable = await page
      .getByRole('switch', { name: /^Owner of this board: Omar/ })
      .first()
      .isVisible()
      .catch(() => false);
    check(`${tag} / and can give somebody ownership of it`, repairable);
  }

  if (width < WIDE_BREAKPOINT) {
    await nav('Boards');
    await page.getByText('Empty board').first().click();
    await page.waitForTimeout(1200);
    const reachable = await page.evaluate(() => {
      const name = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
      const shown = [...document.querySelectorAll('[role="button"]')].filter(
        (e) => e.getBoundingClientRect().width > 0,
      );
      return {
        settings: shown.some((e) => name(e) === 'Board settings'),
        archived: shown.some((e) => name(e) === 'Archived cards'),
      };
    });
    check(
      `${tag} / a board with no columns keeps its board actions`,
      reachable.settings && reachable.archived,
      JSON.stringify(reachable),
    );
    await page.screenshot({ path: join(SHOTS, `${tag}-board-empty.png`), fullPage: true });
  }

  /**
   * THE HEADER MUST NOT FLIP DURING AN ARROW-DRIVEN MOVE.
   *
   * The arrows set the page at once so the header answers the tap, then animate
   * the scroll; every frame of that animation fires onScroll, and for the first
   * half the offset still rounds to the column being left. The header went
   * 1 -> 2 -> 1 -> 2 on a single tap. Swiping never did it. Sampled rather than
   * screenshotted, because a screenshot of the settled state looks perfect.
   */
  if (width < WIDE_BREAKPOINT) {
    const seenRuns = await page.evaluate(
      () =>
        new Promise((res) => {
          const out = [];
          const t = setInterval(() => {
            const m = document.body.innerText.match(/(\d+) of (\d+)/);
            if (m && out[out.length - 1] !== m[1]) out.push(m[1]);
          }, 16);
          const btn = [...document.querySelectorAll('[role="button"]')].find(
            (e) => e.getAttribute('aria-label') === 'Next column',
          );
          btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          setTimeout(() => {
            clearInterval(t);
            res(out);
          }, 1600);
        }),
    );
    check(
      `${tag} / the column name does not flip while the arrows animate`,
      seenRuns.length <= 2,
      seenRuns.join(' -> '),
    );
    await page.getByRole('button', { name: 'Previous column' }).first().click();
    await page.waitForTimeout(800);
  }

  /**
   * BOTH SIDES OF BOARD AUTHORITY, not just the admin who owns the app.
   *
   * Owner-gated and member-only layouts had no coverage at any width. Each
   * person gets their own context because the session is per-browser-context,
   * and narrow only because that is where the gated controls share one cramped
   * row.
   *
   * The `settings`/`members` pair is the assertion that matters: the entry point
   * is now ALWAYS present and its NAME is what changes, so checking only for the
   * absence of "Board settings" would pass just as well if the control had
   * vanished entirely and stranded the member with no roster.
   */
  if (width < WIDE_BREAKPOINT) {
    for (const [who, role, wants] of [
      ['sara', 'owner', { deleteColumn: true, settings: true, members: false }],
      ['omar', 'member', { deleteColumn: false, settings: false, members: true }],
    ]) {
      const roleCtx = await browser.newContext({ viewport: { width, height: 900 } });
      const rp = await roleCtx.newPage();
      const roleErrors = [];
      rp.on('pageerror', (e) => roleErrors.push(String(e).slice(0, 90)));
      await rp.goto(BASE, { waitUntil: 'networkidle' });
      await rp.getByRole('button', { name: who, exact: true }).click();
      await rp.getByRole('button', { name: 'More' }).waitFor({ timeout: 40000 });
      await rp.getByText('Fundraising 2026').first().waitFor({ timeout: 30000 });
      await rp.getByText('Fundraising 2026').first().click();
      await rp.waitForTimeout(2000);
      const got = await rp.evaluate(() => {
        const nm = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
        const vis = [...document.querySelectorAll('[role="button"]')].filter(
          (e) => e.getBoundingClientRect().width > 2,
        );
        return {
          addCard: vis.some((e) => nm(e) === '+ Add card'),
          deleteColumn: vis.some((e) => nm(e).startsWith('Delete column')),
          archived: vis.some((e) => nm(e) === 'Archived cards'),
          settings: vis.some((e) => nm(e) === 'Board settings'),
          members: vis.some((e) => nm(e) === 'Board members'),
          bleed: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      const ok =
        got.addCard &&
        got.archived &&
        got.bleed <= 1 &&
        got.deleteColumn === wants.deleteColumn &&
        got.settings === wants.settings &&
        got.members === wants.members &&
        roleErrors.length === 0;
      check(`${tag} / the board as ${role === 'owner' ? 'an owner' : 'a member'}`, ok, `${JSON.stringify(got)} ${roleErrors.join('|')}`);
      await rp.screenshot({ path: join(SHOTS, `${tag}-board-${role}.png`), fullPage: true });

      // The roster ITSELF, at phone width, on both sides. It is a screen the
      // admin tour can never reach: an admin always owns every board, so the
      // read-only version renders for nobody who is looking.
      await rp.getByRole('button', { name: wants.settings ? 'Board settings' : 'Board members' }).click();
      await rp.getByText('Members (3)').first().waitFor({ timeout: 20000 });
      const roster = await rp.evaluate(() => {
        const nm = (e) => (e.getAttribute('aria-label') || '').trim();
        const vis = (sel) =>
          [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 2);
        const creator = vis('[role="switch"]').find((e) => /: Faisal$/.test(nm(e)));
        return {
          title: (document.body.textContent || '').includes('Board settings')
            ? 'settings'
            : 'members',
          toggles: vis('[role="switch"]').filter((e) => nm(e).startsWith('Owner of this board')).length,
          creatorLocked: creator ? creator.getAttribute('aria-disabled') === 'true' : null,
          ownerHints: (document.body.textContent || '').split('Owner').length - 1,
          // Curating the shared labels is ADMIN work, not board authority. These
          // controls sat inside the owner-gated Labels card and stayed there
          // when curation narrowed — three buttons the rules refuse, on the
          // screen of every board owner in the org.
          labelEdits: vis('[role="button"]').filter((e) =>
            /^(Rename label|Delete label|Change colour of) /.test(nm(e)),
          ).length,
          canAddLabel: vis('[role="button"]').some((e) => nm(e) === 'Add label'),
          bleed: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      // An owner gets a toggle per member and cannot demote the creator; a
      // member gets no toggle at all and reads who to ask instead. NEITHER can
      // rename or delete a shared label, and the owner can still add one.
      const rosterOk = wants.settings
        ? roster.title === 'settings' &&
          roster.toggles === 3 &&
          roster.creatorLocked === true &&
          roster.labelEdits === 0 &&
          roster.canAddLabel
        : roster.title === 'members' &&
          roster.toggles === 0 &&
          roster.ownerHints >= 2 &&
          roster.labelEdits === 0;
      check(
        `${tag} / the roster as ${role === 'owner' ? 'an owner' : 'a member'}`,
        rosterOk && roster.bleed <= 1,
        JSON.stringify(roster),
      );
      await rp.screenshot({ path: join(SHOTS, `${tag}-roster-${role}.png`), fullPage: true });

      /**
       * THE ARCHIVE, where permanent deletion lives for anyone who never opens a
       * card. Same authority as the card screen's Delete permanently, a separate
       * rendering site — and the label bug proved a rendering site can drift
       * from the authority it is meant to express while the rules stay right.
       *
       * `sw_archived` is seeded on this board, so the row exists for both actors
       * and the difference is the bin, not the emptiness.
       */
      await rp.getByRole('button', { name: 'Back' }).first().click();
      await rp.getByRole('button', { name: 'Archived cards' }).click();
      await rp.getByText('An archived card').first().waitFor({ timeout: 25000 });
      const archive = await rp.evaluate(() => {
        const nm = (e) => (e.getAttribute('aria-label') || '').trim();
        const vis = [...document.querySelectorAll('[role="button"]')].filter(
          (e) => e.getBoundingClientRect().width > 2,
        );
        return {
          restore: vis.some((e) => /^Restore .* to the board$/.test(nm(e))),
          destroy: vis.some((e) => /^Delete .* permanently$/.test(nm(e))),
        };
      });
      check(
        `${tag} / the archive as ${role === 'owner' ? 'an owner' : 'a member'}`,
        // Restore is EVERYONE's — members archive, so members must un-archive.
        // Permanent deletion is the board's owners and admins alone.
        archive.restore && archive.destroy === wants.settings,
        JSON.stringify(archive),
      );

      await roleCtx.close();
    }
  }

  check(`${tag} reached every screen`, seen === SCREENS, `${seen}/${SCREENS}`);
}

try {
  const runs = [
    ...WIDTHS.map((w) => [`${w}px`, { viewport: { width: w, height: 900 } }, w]),
    ...PROFILES.map(([label, d]) => [label, d, d.viewport.width]),
  ];
  for (const [tag, contextOptions, width] of runs) {
    const ctx = await browser.newContext(contextOptions);
    // Make the push nudge RENDER. Headless Chromium reports
    // `Notification.permission` as 'denied', so the card on the Boards screen —
    // which only shows while the device can still be asked — was absent from
    // every screenshot at every width. That is the one card in the app whose
    // layout has already been got wrong three times (it ate a quarter of a
    // narrow screen, it outranked an urgent alert, its dismiss link floated off
    // alone on a wide one), and the sweep that exists to catch exactly that
    // could not see it. `grantPermissions` does not move the getter, so the
    // getter is what gets replaced; the alternative was a permanent hole in the
    // default layout check.
    await ctx.addInitScript(() => {
      // Guarded: an init script runs in EVERY frame, and a blank one has no
      // Notification to define a property on. A throw here would surface through
      // the pageerror handler below as a failed check about something else.
      if (typeof window.Notification === 'undefined') return;
      Object.defineProperty(window.Notification, 'permission', {
        configurable: true,
        get: () => 'default',
      });
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => check(`${tag} page error`, false, String(e).slice(0, 90)));
    await db.doc(`users/${uid}`).update({
      rulesVersion: FieldValue.delete(),
      rulesAcceptedAt: FieldValue.delete(),
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'faisal', exact: true }).click();
    await rulesScreen(page, tag, width);
    await page.getByRole('button', { name: 'More' }).waitFor({ timeout: 30000 });
    await tour(page, tag, width);
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`  ${tally.summary()}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`shots/screens/ — ${WIDTHS.length + PROFILES.length} viewports x ${SCREENS} screens`);
if (!FULL) console.log('SWEEP_FULL=1 adds real device profiles (DPR, touch, UA).');
if (failed.length) {
  console.error(`FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
