/**
 * Regenerate the USER MANUAL's screenshots from the seeded dev stack.
 *
 *   scripts/dev.sh web            # emulators + web + seed, and WAIT for the seed
 *   node scripts/manual-shots.mjs
 *   node scripts/manual-shots.mjs stats search    # just these
 *
 * This is a DOC-ASSET GENERATOR, not a regression test — it is the sibling of
 * `screens-e2e.mjs`, which asserts, and deliberately not the same thing. What it
 * guarantees is only that every image in `docs/USER-MANUAL.md` can be rebuilt by
 * running one command, because an image with no generator is an image that
 * quietly goes stale. Six of these were a release behind before any generator
 * existed; `search-*` was a release behind again after the Search redesign,
 * because only six of the twenty were covered. So now all of them are.
 *
 * SIZES ARE PART OF THE LAYOUT. The manual pairs a `wide` figure with a
 * `narrow` one, and `render-manual.py` prints them at 116 mm and 46 mm. 1280x900
 * and 390x844 are the capture sizes; 1280 is wide enough to stay sharp at
 * 116 mm on paper. Do not "tidy" them.
 *
 * NOTE: it drives the real UI, so every click must be aimed precisely. On the
 * WIDE board each card row carries its own Archive button right beside the
 * title, and a stray `Back`/`.first()` click there silently archives the card
 * the next run then cannot find. Click by exact text, never by proximity.
 *
 * `pending.png` is the ONE image still captured by hand: it needs an account
 * that has signed in and NOT been approved, and the dev seed approves everyone
 * it creates. It is also the most stable screen in the app. Everything else
 * here is automatic — `rules.png` included: the seed's accounts have all
 * accepted the institute's rules, so that shot takes Omar's acceptance away
 * first, photographs the screen, and agrees again.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { PORTS, PROJECT } from './lib/emulators.mjs';
import { RULES_TITLE } from './lib/rules.mjs';

const OUT = 'docs/manual/img';
const BASE = process.env.MANUAL_BASE ?? `http://127.0.0.1:${PORTS.web}`;
const BOARD = 'Fundraising 2026';
const CARD = 'Draft the donor letter';

/** [tag, width, height] — the two shapes the manual lays out for. */
const VIEWPORTS = [
  ['wide', 1280, 900],
  ['phone', 390, 844],
];

const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);

/**
 * Give the seeded board enough on it to be worth photographing.
 *
 * `scripts/dev.sh web` seeds boards, columns, cards and members — but assigns
 * nobody, sets no due dates, no priorities and no labels. Every card face then
 * renders bare and **My Work photographs as "Nothing is assigned to you right
 * now"**, which teaches the reader nothing about the screen the section is
 * describing. An empty screenshot is a stale screenshot by another route.
 *
 * So the data is arranged here, deterministically, to show the things the manual
 * actually explains: the four due-date buckets My Work groups by, a spread of
 * priorities, labels on a card face, and one card carrying a file.
 */
async function enrich() {
  process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
  process.env.GCLOUD_PROJECT = PROJECT;
  initializeApp({ projectId: PROJECT });
  const db = getFirestore();

  const users = await db
    .collection('users')
    .where('email', '==', 'faisal@oursabeel.com')
    .get();
  if (users.empty) throw new Error('dev account missing — run scripts/dev.sh web first');
  const uid = users.docs[0].id;

  const boards = await db.collection('boards').where('name', '==', BOARD).get();
  if (boards.empty) throw new Error(`board "${BOARD}" missing — was the seed interrupted?`);
  const boardId = boards.docs[0].id;

  // Labels are org-wide, so create them once and reuse.
  const wantLabels = [
    ['Fundraising', '#83114F'],
    ['Outreach', '#A8B89A'],
    ['Admin', '#C6A15B'],
  ];
  const labelIds = [];
  const existing = await db.collection('labels').get();
  for (const [name, color] of wantLabels) {
    const hit = existing.docs.find((d) => d.data().name === name);
    if (hit) {
      labelIds.push(hit.id);
      continue;
    }
    const ref = await db.collection('labels').add({
      name,
      color,
      createdAt: Date.now(),
      createdBy: uid,
    });
    labelIds.push(ref.id);
  }

  // Dates relative to today, so the buckets stay right whenever this is run.
  const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  //  title                    days  priority   labels  description
  const plan = [
    ['Book the venue', -2, 'urgent', [0],
      'Sayeed Hall is held provisionally until Friday. Confirm the deposit and get the contract signed.'],
    ['Confirm the caterer', 0, 'high', [0, 1],
      'Final head count is 120. Check the vegetarian option and whether they bring their own serving staff.'],
    ['Draft the donor letter', 3, 'medium', [1],
      // Formatted on purpose: the manual's card screenshot is the only place a
      // reader sees what the five elements actually look like.
      'One page, **warm but specific**. Cover:\n\n- what last year funded\n- what this year needs\n- the giving levels we agreed\n\nTone reference: https://example.org/handbook'],
    ['Design the programme', 21, 'low', [2], ''],
    ['Chase outstanding pledges', 5, 'high', [0, 2],
      'Eleven pledges from the spring appeal are still open. Start with the four over $500.'],
  ];

  const cards = await db.collection('cards').where('boardId', '==', boardId).get();
  const byTitle = new Map(cards.docs.map((d) => [d.data().title, d]));
  let touched = 0;
  for (const [title, offset, priority, idx, description] of plan) {
    const hit = byTitle.get(title);
    if (!hit) continue;
    await hit.ref.update({
      assigneeUids: [uid],
      dueDate: day(offset),
      priority,
      labelIds: idx.map((i) => labelIds[i]),
      ...(description ? { description } : {}),
      updatedAt: Date.now(),
      updatedBy: uid,
    });
    touched += 1;
  }
  if (touched < plan.length) {
    throw new Error(`only ${touched}/${plan.length} seeded cards matched — seed changed?`);
  }

  // One real subtask link, so the Subtasks section has something to show and the
  // parent card face carries its "N subtasks" marker. Same board, which is the
  // only shape the app allows.
  const parent = byTitle.get(CARD);
  const child = byTitle.get('Design the programme');
  if (parent && child) {
    await child.ref.update({ parentId: parent.id, updatedAt: Date.now(), updatedBy: uid });
  }

  console.log(`  enriched ${touched} cards (overdue / today / +3d / +5d / +21d) + 1 subtask\n`);
}

await enrich();

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

/**
 * Who a shot is taken AS.
 *
 * Everything is the admin's view unless it is listed here, because that is the
 * view the manual mostly describes. The roster is the exception and has to be:
 * an admin owns every board, so the read-only member list the manual describes
 * for everybody else renders for nobody the admin tour can reach. `omar` is a
 * plain member of the seeded board and an owner of nothing.
 */
const SIGN_IN_AS = { roster: 'omar' };

async function fresh(w, h, { signIn = true, who = 'faisal' } = {}) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  // Confirmations are accepted, and LOGGED — a dialog firing here means a click
  // landed somewhere it should not have.
  p.on('dialog', (d) => {
    console.log('  DIALOG FIRED:', d.message().slice(0, 70));
    void d.accept();
  });
  p.on('pageerror', (e) => console.log('  PAGEERROR:', e.message.slice(0, 90)));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  if (!signIn) return p;
  await p.getByRole('button', { name: who, exact: true }).click();
  await p.getByRole('button', { name: 'More' }).waitFor({ timeout: 90000 });
  return p;
}

/**
 * Reach a tab root, THEN tap the tab.
 *
 * On a phone the bottom bar renders on tab roots only, so a pushed screen has no
 * nav to tap and we have to walk Back first. On a wide layout the rail is always
 * there and this is a no-op.
 */
async function nav(p, label) {
  for (let i = 0; i < 6; i += 1) {
    // A PREFIX, not an exact match — the Alerts tab carries its unread count
    // in its accessible name ("Alerts, 2 unread").
    const tab = p
      .getByRole('button', { name: new RegExp(`^${label}(,|$)`) })
      .first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await p.waitForTimeout(900);
      return;
    }
    const back = p.getByRole('button', { name: 'Back' }).first();
    if (!(await back.isVisible().catch(() => false))) break;
    await back.click();
    await p.waitForTimeout(700);
  }
  throw new Error(`could not reach the "${label}" tab`);
}

async function openBoard(p) {
  await nav(p, 'Boards');
  await p.getByText(BOARD).first().click();
  await p.getByText(CARD).first().waitFor({ timeout: 60000 });
  await p.waitForTimeout(1500);
}

/** Every image the manual pairs. Each gets the page already signed in. */
const SHOTS = {
  boards: async (p) => {
    await nav(p, 'Boards');
  },
  board: openBoard,
  card: async (p) => {
    await openBoard(p);
    await p.getByText(CARD).first().click();
    await p.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 30000 });
  },
  // The formatting row only exists while the description is being EDITED, so
  // the rendered `card` shot cannot show it. This is the only image in the
  // manual that photographs an editor rather than a screen.
  format: async (p) => {
    await openBoard(p);
    await p.getByText(CARD).first().click();
    await p.getByRole('button', { name: 'Edit description' }).click();
    // Wait for the editor itself, not a timeout — it mounts asynchronously and
    // a screenshot taken early catches the read-only text it replaces.
    await p.locator('[contenteditable="true"]').first().waitFor({ timeout: 30000 });
    await p.getByRole('button', { name: 'Bold', exact: true }).first().waitFor({ timeout: 15000 });
    await p.waitForTimeout(700);
  },
  bulk: async (p, tag) => {
    await openBoard(p);
    if (tag === 'wide') {
      // Wide exposes a real checkbox per row; phone has none, by design.
      await p.getByRole('checkbox', { name: `Select ${CARD}` }).click();
      await p.getByRole('checkbox', { name: 'Select Book the venue' }).click();
    } else {
      // Long-press starts a selection. Holding the pointer down is what
      // `onLongPress` listens for — a plain click only opens the card.
      await p.getByText(CARD).first().click({ delay: 900 });
      await p.waitForTimeout(700);
      await p.getByText('Book the venue').first().click();
    }
    await p.getByText(/\d+ selected/).first().waitFor({ timeout: 15000 });
  },
  mywork: async (p) => {
    await nav(p, 'My Work');
  },
  search: async (p) => {
    await nav(p, 'Search');
    await p.waitForTimeout(1200);
  },
  // The filter menu is behind a control and its sections are collapsed, so the
  // plain `search` shot shows neither. An image with no generator goes stale
  // unnoticed, which is why every screen the manual describes gets one.
  searchFilters: async (p) => {
    await nav(p, 'Search');
    await p.getByRole('button', { name: 'Filters', exact: true }).click();
    await p.getByRole('button', { name: /^Labels(:| \(|$)/ }).first().click();
    await p.waitForTimeout(900);
  },
  // Naming a file happens between picking it and the upload starting, so it
  // cannot be photographed from a card at rest.
  attach: async (p) => {
    await openBoard(p);
    await p.getByText(CARD).first().click();
    const chooser = p.waitForEvent('filechooser', { timeout: 30000 });
    await p.getByRole('button', { name: 'Attach a file' }).click();
    await (await chooser).setFiles({
      name: 'Signed lease 2026.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% manual fixture\n%%EOF\n'),
    });
    await p.getByPlaceholder('File name').waitFor({ timeout: 20000 });
    await p.waitForTimeout(700);
  },
  alerts: async (p) => {
    await nav(p, 'Alerts');
    await p.waitForTimeout(1500);
  },
  settings: async (p) => {
    await openBoard(p);
    await p.getByRole('button', { name: 'Board settings' }).click();
    await p.waitForTimeout(1500);
  },
  people: async (p) => {
    await nav(p, 'Boards');
    await p.getByRole('button', { name: 'More' }).click();
    await p.getByRole('button', { name: 'People' }).click();
    await p.waitForTimeout(1500);
  },
  stats: async (p) => {
    await nav(p, 'Boards');
    await p.getByRole('button', { name: 'More' }).click();
    await p.getByRole('button', { name: 'Stats' }).click();
    // The chart derives from a live subscription; screenshotting mid-load gives
    // a spinner, which is not what the manual is describing.
    await p.getByText('in this period', { exact: false }).first().waitFor({ timeout: 30000 });
    await p.waitForTimeout(1200);
  },
  // The Members section of settings, as an OWNER — the Owner switch beside each
  // row, which is the whole of what this release added and what `settings`
  // cannot show: that shot is the top of the same screen, and Members is below
  // the fold at both capture sizes. Scrolled to the heading rather than to a
  // pixel offset, so it survives a column being added to the seed.
  owners: async (p) => {
    await openBoard(p);
    await p.getByRole('button', { name: 'Board settings' }).click();
    const members = p.getByText(/^Members \(/).first();
    await members.waitFor({ timeout: 30000 });
    await members.scrollIntoViewIfNeeded();
    await p.waitForTimeout(900);
  },
  // The member list as somebody who does NOT own the board: owners marked, and
  // no controls at all. Taken as `omar` — see SIGN_IN_AS.
  roster: async (p) => {
    await nav(p, 'Boards');
    await p.getByText(BOARD).first().click();
    await p.getByRole('button', { name: 'Board members' }).click();
    await p.getByText(/^Members \(/).first().waitFor({ timeout: 30000 });
    await p.waitForTimeout(900);
  },
  // Report a problem with a report written but not yet sent: the screen's
  // whole content, and what the manual's section walks through.
  report: async (p) => {
    await nav(p, 'Boards');
    await p.getByRole('button', { name: 'More' }).click();
    await p.getByRole('button', { name: /^Report a problem/ }).click();
    const field = p.getByLabel('What or who are you reporting, and what is wrong?');
    await field.waitFor({ timeout: 30000 });
    await field.fill(
      'The latest comment on "Book the venue" is rude about a volunteer by name. Could it come down?',
    );
    await p.waitForTimeout(600);
  },
  // The breakdown only exists while a bar is SELECTED, so it needs its own
  // shot. The seed can leave a quiet chart with nothing to tap, in which case
  // this photographs the chart alone rather than failing the whole run.
  statsDetail: async (p) => {
    await nav(p, 'Boards');
    await p.getByRole('button', { name: 'More' }).click();
    await p.getByRole('button', { name: 'Stats' }).click();
    await p.getByText('in this period', { exact: false }).first().waitFor({ timeout: 30000 });
    const bar = p.getByLabel(/^[1-9]\d* cards created, /).first();
    if (await bar.isVisible().catch(() => false)) {
      await bar.click();
      await p.waitForTimeout(1200);
    }
  },
};

let made = 0;
for (const [tag, w, h] of VIEWPORTS) {
  for (const [name, drive] of Object.entries(SHOTS)) {
    if (!wanted(name)) continue;
    // A fresh page per shot. Reusing one made a failed step poison every image
    // after it, and the cost is a few seconds.
    const p = await fresh(w, h, { who: SIGN_IN_AS[name] });
    try {
      await drive(p, tag);
      await p.waitForTimeout(600);
      await p.screenshot({ path: `${OUT}/${name}-${tag}.png` });
      console.log(`  ${name}-${tag}.png`);
      made += 1;
    } catch (e) {
      console.error(`  FAILED ${name}-${tag}: ${String(e).split('\n')[0].slice(0, 110)}`);
      process.exitCode = 1;
    } finally {
      await p.close();
    }
  }
}

// The sign-in screen is unauthenticated, so it is captured once, not per pair —
// and it carries the version string, which is exactly why it must be reshot on a
// release rather than left as whatever build it first showed.
if (wanted('signin')) {
  const p = await fresh(1280, 900, { signIn: false });
  await p.getByText('Sign in with Google').waitFor({ timeout: 30000 });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${OUT}/signin.png` });
  console.log('  signin.png');
  made += 1;
  await p.close();
}

// The institute's rules: shown once per account, and every seeded account has
// accepted them. So Omar's acceptance is taken away — the state every account
// was in before the screen existed — and he agrees again after the shot.
if (wanted('rules')) {
  const db = getFirestore();
  const omar = (await db.collection('users').where('email', '==', 'omar@oursabeel.com').get()).docs[0];
  if (!omar) throw new Error('omar missing — run scripts/dev.sh web first');
  await omar.ref.update({ rulesVersion: FieldValue.delete(), rulesAcceptedAt: FieldValue.delete() });
  const p = await fresh(1280, 900, { signIn: false });
  try {
    await p.getByRole('button', { name: 'omar', exact: true }).click();
    await p.getByText(RULES_TITLE, { exact: true }).waitFor({ timeout: 90000 });
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${OUT}/rules.png` });
    console.log('  rules.png');
    made += 1;
  } finally {
    await p.getByRole('button', { name: 'I agree', exact: true }).click();
    await p.getByRole('button', { name: 'More' }).waitFor({ timeout: 60000 });
    await p.close();
  }
}

await browser.close();
console.log(`\n${made} images written to ${OUT}/`);
console.log('pending.png is captured by hand — see the header for why.');
