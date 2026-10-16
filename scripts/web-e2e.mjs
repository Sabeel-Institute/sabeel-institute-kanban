/**
 * End-to-end verification of the Phase 1 access flow, driven through the real
 * web build against the running emulators.
 *
 * The load-bearing assertion is LIVE UN-GATING: after an admin approves someone,
 * their already-open app must let them in WITHOUT a reload or sign-out. That
 * depends on setUserAccess stamping claimsUpdatedAt and session.ts force-
 * refreshing the ID token — a chain no unit test covers, and the exact thing a
 * user would report as "she approved me and nothing happened".
 *
 * Prerequisites (scripts/e2e.sh does both):
 *   - emulators running (firestore, auth, functions)
 *   - an emulator-mode web build in app/dist-web-emu
 *
 *   node scripts/web-e2e.mjs
 */
import { chromium } from 'playwright';
// The app's own org-timezone date, so this script cannot drift from ORG_TIMEZONE.
import { todayInOrgTz } from '../packages/shared/lib/due.js';
import { PASSWORD_SIGN_IN_EMAIL } from '../packages/shared/lib/constants.js';
import { REPORT_TEXT_MAX } from '../packages/shared/lib/report.js';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { EMULATOR_PORTS, WEB_PORTS } from './lib/ports.mjs';
import { RULES_TITLE, agreeToRules } from './lib/rules.mjs';

const SHOTS = resolve(import.meta.dirname, '..', 'shots');
// The Expo web DEV server, started by e2e.sh. It must be the dev server rather
// than an exported bundle: `expo export` sets __DEV__ to false, which correctly
// strips the emulator dev sign-in — the very control this flow needs to drive.
// That the export strips it is asserted separately at the end.
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${WEB_PORTS.e2e}/`;
const PROD_BUNDLE = resolve(import.meta.dirname, '..', 'app', 'dist-web');
const PROD_PORT = 4181;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

/** Serves the exported PRODUCTION bundle, for the dev-row absence check. */
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const candidate of [join(PROD_BUNDLE, p), join(PROD_BUNDLE, 'index.html')]) {
    try {
      const body = await readFile(candidate);
      res.writeHead(200, {
        'Content-Type': MIME[extname(candidate)] ?? 'application/octet-stream',
      });
      return res.end(body);
    } catch {
      /* fall through to SPA index */
    }
  }
  res.writeHead(404).end('not found');
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  // Detail describes the FAILURE, so it prints only when there is one — the
  // same rule `screens-e2e.mjs` states. On a passing line it reads as the
  // opposite of what happened: `ok  the composer is empty — composer still
  // holds ""` says the check failed to anyone skimming.
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

function grantAdmin(email) {
  return new Promise((res, rej) => {
    const child = spawn(
      'node',
      [resolve(import.meta.dirname, 'grant-admin.mjs'), email],
      {
        env: {
          ...process.env,
          GCLOUD_PROJECT: 'demo-sabeel-kanban',
          FIRESTORE_EMULATOR_HOST: `127.0.0.1:${EMULATOR_PORTS.firestore}`,
          FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${EMULATOR_PORTS.auth}`,
        },
        stdio: 'pipe',
      },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(out))));
  });
}

/**
 * Run a few lines of Admin SDK code against the emulators, as an admin would
 * act in the console: `auth` and `db` are in scope. From the repository root,
 * so firebase-admin resolves as it does for grant-admin.mjs.
 */
function adminRun(body) {
  const code = `
    import { initializeApp } from 'firebase-admin/app';
    import { getAuth } from 'firebase-admin/auth';
    import { FieldValue, getFirestore } from 'firebase-admin/firestore';
    initializeApp({ projectId: 'demo-sabeel-kanban' });
    const auth = getAuth();
    const db = getFirestore();
    ${body}
  `;
  return new Promise((res, rej) => {
    const child = spawn('node', ['--input-type=module', '-e', code], {
      cwd: resolve(import.meta.dirname, '..'),
      env: {
        ...process.env,
        GCLOUD_PROJECT: 'demo-sabeel-kanban',
        FIRESTORE_EMULATOR_HOST: `127.0.0.1:${EMULATOR_PORTS.firestore}`,
        FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${EMULATOR_PORTS.auth}`,
      },
      stdio: 'pipe',
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('exit', (code) => (code === 0 ? res(out) : rej(new Error(out))));
  });
}

/** Confirmation text from the most recent window.confirm, per page. */
const lastConfirm = new WeakMap();
/**
 * Pages whose NEXT confirmation must be declined, then cleared.
 *
 * The handler below accepts everything, which is right for a suite that is
 * mostly proving a flow completes — but it makes "the confirmation is real"
 * untestable, because a control with no dialog behind it passes identically.
 * Declining once, and asserting the state did NOT move, is the only way to tell
 * a genuine gate from a decorative one.
 */
const declineNext = new WeakSet();

/**
 * Wait for a switch to actually READ as on/off, rather than sleeping and hoping.
 *
 * The value comes back from Firestore, so the control flips when the snapshot
 * lands — which on a loaded machine is comfortably longer than any fixed pause
 * worth writing. A fixed pause here failed once in exactly the way that teaches
 * nothing: the write had landed, the other browser had already seen it, and only
 * this assertion was early.
 */
async function switchReads(locator, want, ms = 20000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if ((await locator.getAttribute('aria-checked')) === String(want)) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Run `fn` with this page's next confirmation declined instead of accepted. */
async function decliningConfirm(page, fn) {
  declineNext.add(page);
  try {
    await fn();
  } finally {
    declineNext.delete(page);
  }
}

async function newApp(browser, scheme = 'light', path = '') {
  const ctx = await browser.newContext({
    colorScheme: scheme,
    viewport: { width: 1100, height: 900 },
  });
  const page = await ctx.newPage();

  // Consequential access changes go through window.confirm. Playwright DISMISSES
  // dialogs by default, so without this every approval silently did nothing and
  // the failure looked like a broken button. Record the text too, so the tests
  // can assert a confirmation was actually demanded.
  page.on('dialog', async (d) => {
    lastConfirm.set(page, d.message());
    if (declineNext.has(page)) {
      declineNext.delete(page);
      await d.dismiss();
      return;
    }
    await d.accept();
  });
  page.on('pageerror', (e) => console.error('   page error:', String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      console.error(`   console.${m.type()}:`, m.text());
    }
  });
  // A BOUND ON EVERY WAIT. Outside Playwright's test runner the default action
  // timeout is ZERO — meaning no timeout — so a `click()` on a control that is
  // not there hangs the suite silently and forever, with the last log line
  // pointing at whatever happened to run before it. Explicit timeouts still win;
  // this only puts a floor under the calls that never named one.
  page.setDefaultTimeout(45000);
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  return { ctx, page };
}

/** The last line a few lines of Admin SDK code printed, as JSON. */
async function adminJson(body) {
  return JSON.parse((await adminRun(body)).trim().split('\n').pop());
}

/**
 * Report a problem, the way a person does: More, the item, one field, Send.
 * Returns the page on the report screen with the outcome drawn.
 */
const REPORT_FIELD = 'What or who are you reporting, and what is wrong?';
const REPORT_SENT = 'Sent. An administrator will reply by email within a day.';
async function openReport(page) {
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: /^Report a problem/ }).click();
  await page.getByLabel(REPORT_FIELD).waitFor({ timeout: 20000 });
}

/**
 * Open a card from the board.
 *
 * Two things make a naive click unreliable here. A live board re-renders as
 * snapshots arrive, so Playwright's "element is stable" check can time out on a
 * perfectly good element; and while a selection is active a tap TOGGLES the card
 * instead of opening it (deliberate — see useSelection). So: clear any
 * selection, then retry the click until the card screen actually appears.
 */
/**
 * The comment composer is a CONTENTEDITABLE, not a textarea.
 *
 * Selecting it by placeholder stopped working the moment it became a rich
 * editor — a contenteditable has no placeholder attribute — and reading it with
 * `inputValue()` never will. Both live here so the next editor change is one
 * edit rather than ten, and neither is weakened into an `if (isVisible)` guard:
 * a selector that silently matches nothing is how a broken check passes.
 */
const commentEditor = (page) => page.locator('[data-testid="comment-editor"]');
const editorText = (loc) => loc.innerText();
/** Focus lands INSIDE the editable, which is a div rather than a TEXTAREA. */
const focusIsInEditor = (page) =>
  page.evaluate(
    () => document.activeElement?.closest('[contenteditable="true"]') !== null,
  );

async function openCard(page, title) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const clear = page.getByRole('button', { name: 'Clear selection' });
    if ((await clear.count()) > 0) {
      await clear.first().click().catch(() => {});
      await page.waitForTimeout(400);
    }

    const tile = page.locator(`[data-testid="card-${title}"]`);
    await tile.waitFor({ timeout: 20000 });
    await tile.click({ timeout: 10000, force: attempt > 0 }).catch(() => {});

    // "Opened" is proven by a control unique to the card screen, not by a
    // heading. This used to wait for the text "Card", which CardScreen
    // deliberately removed — the card's own title is the page heading, so a
    // second one was noise. The card then opened correctly, the check failed,
    // and the retry looked for the tile it had just navigated away from.
    const opened = await page
      .getByRole('button', { name: 'Share card' })
      .waitFor({ timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error(`could not open card "${title}"`);
}

/**
 * Pop back to the board list, however deep the stack happens to be. Hard-coding
 * the number of Backs makes every later section brittle to earlier edits.
 */
async function backToBoards(page) {
  for (let i = 0; i < 5; i++) {
    if (await page.getByRole('button', { name: 'New board' }).isVisible().catch(() => false)) {
      return;
    }
    // The NAV first, Back only as a fallback. Back-only walking cannot leave a
    // TAB ROOT — My Work, Search and Alerts dropped their redundant Back when
    // the navigation shell landed — so the loop found nothing to click, broke,
    // and the wait below failed on a perfectly healthy app.
    const boards = page.getByRole('button', { name: 'Boards', exact: true });
    if (await boards.first().isVisible().catch(() => false)) {
      await boards.first().click();
      await page.waitForTimeout(600);
      continue;
    }
    const back = page.getByRole('button', { name: 'Back' });
    if ((await back.count()) === 0) break;
    await back.first().click();
    await page.waitForTimeout(600);
  }
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 20000 });
}

/** On failure, show what the screen actually said — guessing wastes runs. */
const pages = new Map();
async function dumpAll() {
  for (const [label, page] of pages) {
    try {
      const text = await page.locator('body').innerText();
      console.error(`\n--- ${label} showed ---\n${text}\n---`);
      await page.screenshot({ path: join(SHOTS, `p1-FAIL-${label}.png`), fullPage: true });
    } catch (e) {
      console.error(`could not dump ${label}:`, String(e));
    }
  }
}

await new Promise((r) => server.listen(PROD_PORT, r));
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
try {
  // ---- Sign-in screen -----------------------------------------------------
  const { ctx: adminCtx, page: admin } = await newApp(browser);
  pages.set('admin', admin);
  await admin.getByText('Sign in with Google').waitFor({ timeout: 20000 });
  check('sign-in screen renders', true);
  check(
    'dev sign-in row is present in an emulator build',
    await admin.getByText('Dev sign-in (emulator only)').isVisible(),
  );
  await admin.screenshot({ path: join(SHOTS, 'p1-signin-light.png'), fullPage: true });
  await admin.emulateMedia({ colorScheme: 'dark' });
  await admin.waitForTimeout(300);
  await admin.screenshot({ path: join(SHOTS, 'p1-signin-dark.png'), fullPage: true });
  await admin.emulateMedia({ colorScheme: 'light' });

  // ---- Sign in → pending gate --------------------------------------------
  await admin.getByRole('button', { name: 'faisal', exact: true }).click();
  await admin.getByText('Waiting for approval').waitFor({ timeout: 25000 });
  check('a brand-new org account lands on the pending gate', true);
  await admin.screenshot({ path: join(SHOTS, 'p1-pending-light.png'), fullPage: true });

  // ---- LIVE un-gating ------------------------------------------------------
  // No reload, no re-navigation: the open page must react on its own.
  const urlBefore = admin.url();
  await grantAdmin('faisal@oursabeel.com');

  // ---- The institute's rules, before anything that can post ---------------
  // Approval un-gates onto the rules screen, and nothing behind it is mounted:
  // no board list, no New board, no nav. Sampled only once the screen's own
  // title and button have drawn, so "absent" means withheld, not not-yet-loaded.
  await admin.getByText(RULES_TITLE, { exact: true }).waitFor({ timeout: 25000 });
  await admin.getByRole('button', { name: 'I agree', exact: true }).waitFor({ timeout: 10000 });
  check('approval un-gates the OPEN app with no reload, onto the rules screen', admin.url() === urlBefore);
  {
    const said = await admin.locator('body').innerText();
    check(
      'the rules screen says who the app is for, what is not tolerated, and where to report',
      /Kanban is for Sabeel Institute.s staff/.test(said) &&
        /members of your board/.test(said) &&
        /abusive, harassing, hateful, sexual or otherwise objectionable/.test(said) &&
        /Report a problem in More; administrators respond within 24 hours/.test(said),
      said.slice(0, 160),
    );
    check('and states no minimum age', !/\b(age|years old|13|16|18)\b/i.test(said));
    const behind = [];
    for (const name of ['New board', 'More', 'Boards', 'My Work', 'Search']) {
      if (await admin.getByRole('button', { name, exact: true }).isVisible().catch(() => false)) behind.push(name);
    }
    check('an account that has not accepted reaches nothing it could post from', behind.length === 0, behind.join(', '));
  }
  await admin.screenshot({ path: join(SHOTS, 'p1-rules-light.png'), fullPage: true });
  await admin.getByRole('button', { name: 'I agree', exact: true }).click();
  await admin.getByRole('button', { name: 'New board' }).waitFor({ timeout: 25000 });
  check('"I agree" opens the boards', true);
  await admin.screenshot({ path: join(SHOTS, 'p1-home-light.png'), fullPage: true });

  // Accepted once means accepted: a reload comes back to the boards. `load`,
  // not `networkidle`: signed in, the app holds Firestore's listen channel
  // open, so the network never goes idle.
  await admin.reload({ waitUntil: 'load' });
  await admin.getByRole('button', { name: 'New board' }).waitFor({ timeout: 30000 });
  check(
    'after a reload the rules do not come back',
    !(await admin.getByText(RULES_TITLE, { exact: true }).isVisible().catch(() => false)),
  );

  // ---- A second person signs in and waits ---------------------------------
  const { ctx: saraCtx, page: sara } = await newApp(browser);
  pages.set('sara', sara);
  await sara.getByRole('button', { name: 'sara', exact: true }).click();
  await sara.getByText('Waiting for approval').waitFor({ timeout: 25000 });
  check('second account also lands pending', true);

  // ---- Admin sees and approves her ----------------------------------------
  // People lives in the Account menu, not on the nav itself — the navigation
  // shell moved it there and this script was not updated, so the whole suite
  // had been aborting here. CI does not run the e2e, which is why it rotted
  // unnoticed.
  await admin.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('button', { name: 'People' }).click();
  await admin.getByText('People', { exact: true }).waitFor({ timeout: 15000 });
  await admin.getByText('sara@oursabeel.com').waitFor({ timeout: 20000 });
  check('admin sees the pending person in the approval queue', true);
  await admin.screenshot({ path: join(SHOTS, 'p1-users-light.png'), fullPage: true });

  await admin.getByRole('button', { name: 'Approve' }).first().click();
  await admin.waitForTimeout(500);
  const approveConfirm = lastConfirm.get(admin) ?? '';
  check(
    'approving asks for confirmation and says what will happen',
    /approve/i.test(approveConfirm) && /sign in/i.test(approveConfirm),
    approveConfirm.replace(/\n+/g, ' ').slice(0, 90),
  );

  // Her open page must un-gate on its own too.
  //
  // Asserted as "the gate is gone AND the app shell is up" rather than by
  // matching the word Boards: since the navigation shell landed, that text is
  // both a nav item and a page heading, so it matches twice and the strict
  // locator throws. This phrasing also says what un-gating actually means.
  await sara.getByText('Waiting for approval').waitFor({ state: 'detached', timeout: 25000 });
  await agreeToRules(sara);
  await sara.getByRole('button', { name: 'More' }).waitFor({ timeout: 15000 });
  check('approved member un-gates live, through the rules', true);

  // Look for People where it actually lives — INSIDE the Account menu. This
  // used to probe a top-level button that exists for nobody, so it passed
  // without testing anything, which for an access check is worse than no test.
  await sara.getByRole('button', { name: 'More' }).click();
  // Sign out is in the menu for everyone, so it proves the sheet is open
  // without matching the nav button that opened it.
  await sara.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 15000 });
  check(
    'a member finds Report a problem in More',
    await sara.getByRole('button', { name: /^Report a problem/ }).isVisible().catch(() => false),
  );
  const saraSeesPeople = await sara
    .getByRole('button', { name: 'People' })
    .isVisible()
    .catch(() => false);
  check('a member does NOT get admin tools', !saraSeesPeople);
  // Stats is manager-and-above. Checked in the same breath as People because
  // both are gated in the More sheet and a member reaching either would be the
  // same mistake.
  const saraSeesStats = await sara
    .getByRole('button', { name: 'Stats' })
    .isVisible()
    .catch(() => false);
  check('a member does NOT see Stats', !saraSeesStats);
  // The version belongs to everyone, and is the whole point of putting it here.
  const saraSeesBuild = await sara
    .getByText(/Sabeel Kanban · v\d/)
    .isVisible()
    .catch(() => false);
  check('the running version is visible in the More menu', saraSeesBuild);
  await sara.getByRole('button', { name: 'Cancel' }).first().click();
  await sara.screenshot({ path: join(SHOTS, 'p1-member-home-light.png'), fullPage: true });

  // Back to the board list so the Phase 2 flow starts from a known place.
  await admin.getByRole('button', { name: 'Back' }).first().click();
  await admin.getByRole('button', { name: 'New board' }).waitFor({ timeout: 15000 });

  // ---- Boards (Phase 2) ---------------------------------------------------
  await admin.getByRole('button', { name: 'New board' }).click();
  await admin.getByPlaceholder('Board name').fill('Fundraising 2026');
  await admin.getByRole('button', { name: 'Create', exact: true }).click();
  await admin.getByText('Fundraising 2026').first().waitFor({ timeout: 20000 });
  check('a manager can create a board and lands on it', true);

  // Default columns exist so a new board is usable immediately.
  await admin.getByText('To Do').first().waitFor({ timeout: 15000 });
  await admin.getByText('In Progress').first().waitFor({ timeout: 15000 });
  await admin.getByText('Done').first().waitFor({ timeout: 15000 });
  check('a new board starts with the three default columns', true);
  await admin.screenshot({ path: join(SHOTS, 'p2-board-light.png'), fullPage: true });

  // Board settings: add a column, add a label, add a member.
  await admin.getByRole('button', { name: 'Board settings' }).click();
  await admin.getByText('Board settings').waitFor({ timeout: 15000 });
  await admin.getByPlaceholder('New column name').fill('Blocked');
  await admin.getByRole('button', { name: 'Add column' }).click();
  await admin.getByText('Blocked').first().waitFor({ timeout: 15000 });
  check('a manager can add a column', true);

  await admin.getByPlaceholder('New label name').fill('urgent');
  await admin.getByRole('button', { name: 'Add label' }).click();
  await admin.getByText('urgent').first().waitFor({ timeout: 15000 });
  check('a manager can add a label', true);

  // Labels are ORG-WIDE, and this screen is per-board — which is exactly the
  // misreading the copy has to head off.
  check(
    'board settings says labels are shared by every board',
    await admin
      .getByText(/Labels are shared by every board/)
      .first()
      .isVisible()
      .catch(() => false),
  );

  // Renaming keeps the id, so anything already carrying the label follows the
  // change rather than losing it. (A card gets it further down; this proves the
  // control itself.)
  await admin.getByRole('button', { name: 'Rename label urgent' }).click();
  await admin.getByRole('button', { name: 'Save name for label urgent' }).waitFor({ timeout: 15000 });
  await admin.getByLabel('New name for label urgent').fill('urgent-fix');
  await admin.getByRole('button', { name: 'Save name for label urgent' }).click();
  check(
    'a manager can rename a label',
    await admin
      .getByText('urgent-fix')
      .first()
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false),
  );

  // Sara is active by now, so she should be addable to the board.
  // "Add someone" is the section-heading ICON (its accessible name carries the
  // count); the picker below only appears once it is pressed.
  await admin.getByRole('button', { name: /^Add someone/ }).click();
  await admin.getByText('Add someone').waitFor({ timeout: 15000 });
  // Each candidate is one pressable row named "Add <person> to this board" —
  // not a bare "Add" button beside a name.
  await admin.getByRole('button', { name: /^Add .* to this board$/ }).first().click();
  await admin.getByText('Members (2)').waitFor({ timeout: 20000 });
  check('a manager can add a member to a board', true);
  await admin.screenshot({ path: join(SHOTS, 'p2-settings-light.png'), fullPage: true });

  // The member's OPEN app must now show the board, with no reload.
  await sara.getByText('Fundraising 2026').first().waitFor({ timeout: 25000 });
  check('a member sees a board live once added, with no reload', true);
  await sara.screenshot({ path: join(SHOTS, 'p2-member-boards-light.png'), fullPage: true });

  // ---- Board authority is per-board (Phase 2) -----------------------------
  // Sara is a member of this board. Board authority is a property OF THE BOARD
  // now, so nothing about her org role decides what follows.
  await sara.getByText('Fundraising 2026').first().click();
  await sara.getByText('To Do').first().waitFor({ timeout: 15000 });

  const saraSeesSettings = await sara
    .getByRole('button', { name: 'Board settings' })
    .isVisible()
    .catch(() => false);
  check('a non-owner gets no Board settings button', !saraSeesSettings);

  // But she does get a way in — the roster, read-only. The control SAYS which
  // one it is, because "Board settings" opening a member list would be a button
  // that does not describe what it does.
  await sara.getByRole('button', { name: 'Board members' }).click();
  await sara.getByText('Board members').first().waitFor({ timeout: 15000 });
  check('a non-owner reaches a read-only roster instead', true);
  check(
    'the roster names the owner, so there is somebody to ask',
    await sara.getByText('Owner', { exact: true }).first().isVisible().catch(() => false),
  );
  check(
    'and offers no owner toggle',
    !(await sara
      .getByRole('switch', { name: /^Owner of this board/ })
      .first()
      .isVisible()
      .catch(() => false)),
  );
  check(
    'nor a way to add anyone',
    !(await sara
      .getByRole('button', { name: /^Add someone/ })
      .isVisible()
      .catch(() => false)),
  );
  await sara.screenshot({ path: join(SHOTS, 'p2-member-roster-light.png'), fullPage: true });
  await sara.getByRole('button', { name: 'Back' }).first().click();
  await sara.getByText('To Do').first().waitFor({ timeout: 15000 });

  // Promotion. A declined confirmation must leave the board exactly as it was —
  // otherwise the dialog is decoration and a mistap is a silent grant.
  //
  // The admin is ALREADY on Board settings — that is where they added Sara — and
  // stays there through to the end of this section, because the Cards phase
  // below opens with a Back that expects exactly that.
  const saraOwnerToggle = admin
    .getByRole('switch', { name: /^Owner of this board: sara/i })
    .first();
  await saraOwnerToggle.waitFor({ timeout: 15000 });
  check('every member row carries an owner toggle', true);

  await decliningConfirm(admin, async () => {
    await saraOwnerToggle.click();
    await admin.waitForTimeout(1200);
  });
  check(
    'promoting asks first, and says what it grants',
    /will be able to change this board/.test(lastConfirm.get(admin) ?? ''),
    lastConfirm.get(admin) ?? '(no dialog)',
  );
  check(
    'a declined promotion grants nothing',
    (await saraOwnerToggle.getAttribute('aria-checked')) === 'false',
  );

  await saraOwnerToggle.click();
  check('an accepted one does', await switchReads(saraOwnerToggle, true));
  await admin.screenshot({ path: join(SHOTS, 'p2-owners-light.png'), fullPage: true });

  // Live, with no reload: this is a board write, so her open app sees it.
  await sara.getByRole('button', { name: 'Board settings' }).waitFor({ timeout: 25000 });
  check('an owner gets board administration, live', true);
  await sara.getByRole('button', { name: 'Board settings' }).click();
  await sara.getByRole('button', { name: 'Archive board' }).waitFor({ timeout: 15000 });
  check('and the whole screen, not a roster', true);

  // The creator's row is protected: an owner cannot demote the person who made
  // the board, and cannot remove them from it either. Only an admin can.
  //
  // Asserted on `aria-disabled` rather than Playwright's isDisabled(): these are
  // react-native-web Pressables, not form controls, so the DOM property does not
  // exist and only the ARIA state carries the answer.
  const creatorToggle = sara
    .getByRole('switch', { name: /^Owner of this board: faisal/i })
    .first();
  const removeCreator = sara
    .getByRole('button', { name: /^Remove faisal from this board$/i })
    .first();
  check(
    'an owner cannot demote the creator of the board',
    (await creatorToggle.getAttribute('aria-disabled')) === 'true',
  );
  check(
    'nor remove them from the board',
    (await removeCreator.getAttribute('aria-disabled')) === 'true',
  );

  /**
   * A NON-ADMIN OWNER CAN REACH THE DIRECTORY. Impossible until 2026-08-20, and
   * the reason `listAddableUsers` and `addBoardMember` became callables.
   *
   * `firestore.rules` allows `list` on `users/` to admins alone, so Sara's query
   * was refused and the panel read "Only admins can browse the full directory" —
   * while the board WRITE was permitted the whole time. `docs/PERMISSIONS.md`
   * promised owners "add and remove members"; she could only remove.
   *
   * Asserted as WHICH EMPTY STATE she gets, not by adding somebody, because this
   * suite seeds only two people and both are on the board by now — so "nobody
   * available" is the truthful answer here. That is exactly what makes it a good
   * probe: the old failure and the new success differ precisely in this string,
   * and the message she now gets is one only a SUCCESSFUL directory query can
   * produce. A non-admin owner actually adding someone is covered against a real
   * candidate in functions/test/integration/boardOwnership.test.ts.
   *
   * WAITED for, not sampled: the panel says nothing until the callable
   * answers, so a single isVisible() raced it and failed on a slow machine —
   * and the apology check, sampled in that same silence, passed whatever the
   * answer was going to be. The answer comes first; both read it.
   */
  const emptyState = await sara
    .getByText(/Nobody available to add/i)
    .waitFor({ timeout: 15000 })
    .then(() => true, () => false);
  check('she gets the real empty state instead, which only a successful lookup gives', emptyState);
  const adminOnlyApology = await sara
    .getByText(/Only admins can browse the full directory/i)
    .isVisible()
    .catch(() => false);
  check('an owner is no longer told the directory is admins-only', !adminOnlyApology);

  await sara.getByRole('button', { name: 'Back' }).first().click();
  await sara.getByText('To Do').first().waitFor({ timeout: 15000 });

  // Demote her again, so the rest of the suite runs with her as a plain member.
  await saraOwnerToggle.click();
  check('the revocation lands', await switchReads(saraOwnerToggle, false));
  check(
    'revoking asks too — it is not a one-way door',
    /no longer be able to change it/.test(lastConfirm.get(admin) ?? ''),
  );
  await sara.getByRole('button', { name: 'Board members' }).waitFor({ timeout: 25000 });
  check('and the demotion reaches her open app', true);

  const saraSeesNewBoard = await sara
    .getByRole('button', { name: 'New board' })
    .isVisible()
    .catch(() => false);
  check('a member cannot create boards', !saraSeesNewBoard);

  /**
   * REMOVING SOMEBODY, through the button rather than the callable.
   *
   * The callable carries more invariants than anything else here — it unassigns,
   * unsubscribes, clears the profile AND clears ownership in one batch, and
   * refuses to touch the board's creator — and until now nothing clicked it. It
   * also produces the one board-read failure an ordinary person can cause: being
   * removed while you have the board open.
   *
   * Sara has no cards yet at this point in the flow, so this is safe to undo,
   * and it is undone immediately below because the rest of the suite needs her.
   */
  await admin.getByRole('button', { name: /^Remove sara from this board$/i }).click();
  await admin.getByText(/^Remove this person from the board\?/).waitFor({ timeout: 20000 });
  check('removing asks first', true);
  // The count arrives from `countMemberAssignments`, so WAIT for the settled
  // sentence rather than reading the "Checking how many cards…" placeholder that
  // is on screen the instant the dialog opens.
  await admin
    .getByText(/They are (not assigned to any cards|assigned to \d+ card)/)
    .waitFor({ timeout: 25000 });
  check('and says how many cards they will be unassigned from', true);
  await admin.getByRole('button', { name: 'Remove', exact: true }).click();
  await admin.getByText('Members (1)').waitFor({ timeout: 25000 });
  check('the roster shrinks', true);

  /**
   * Her open board now refuses to load, and must NOT claim the board is missing:
   * it is there, she just cannot see it any more.
   *
   * Asserted on the SENTENCE rather than the heading. Removal fails the board
   * document listener and the cards query at the same moment, and whichever
   * lands first picks the branch that renders — so the heading is a race while
   * this line is not, because both branches reach it through `LoadError`.
   */
  await sara.getByText(/no longer have access to this board/).waitFor({ timeout: 25000 });
  check('a removed member is told they lost access, not that the board is gone', true);
  check(
    'and never sees the old "connection problem" advice, which would never come good',
    !(await sara
      .getByText(/usually a connection problem/)
      .isVisible()
      .catch(() => false)),
  );
  // …and NOT with a red bar across the whole app on top of it. The global
  // listener banner clears only when a listener with the same label next
  // succeeds, and after a removal there will never be one — so before this was
  // suppressed for permission-denied it sat there until sign-out, on every
  // screen, for something the screen in front of her already explains.
  check(
    'and without an app-wide error banner that nothing could ever clear',
    !(await sara
      .getByText(/Live data error/)
      .first()
      .isVisible()
      .catch(() => false)),
  );
  await sara.screenshot({ path: join(SHOTS, 'p2-removed-light.png'), fullPage: true });

  // Put her back, or every phase after this one has nobody to mention.
  await admin.getByRole('button', { name: /^Add someone/ }).click();
  await admin.getByRole('button', { name: /^Add .* to this board$/ }).first().click();
  await admin.getByText('Members (2)').waitFor({ timeout: 25000 });
  await sara.getByRole('button', { name: 'All boards' }).click();
  await sara.getByText('Fundraising 2026').first().waitFor({ timeout: 25000 });
  check('re-adding restores the board to their list', true);
  // Back INTO the board: the phases below assume she is watching it, and this
  // detour is only here to exercise the removal.
  await sara.getByText('Fundraising 2026').first().click();
  await sara.getByText('To Do').first().waitFor({ timeout: 25000 });

  // ---- Cards (Phase 3) ----------------------------------------------------
  await admin.getByRole('button', { name: 'Back' }).first().click();
  await admin.getByText('To Do').first().waitFor({ timeout: 20000 });

  // Add three cards to the first column.
  //
  // Typed with real keystrokes rather than fill(): fill() sets the value and
  // fires one input event, which a controlled React input can miss, leaving the
  // component's state empty while the DOM looks correct — the submit then
  // silently no-ops on an empty title. Enter matches how people actually add
  // cards anyway.
  for (const title of ['Fix signup flow', 'Draft newsletter', 'Book venue']) {
    await admin.getByRole('button', { name: '+ Add card' }).first().click();
    const input = admin.getByPlaceholder('Card title');
    await input.waitFor({ timeout: 10000 });
    await input.click();
    await input.pressSequentially(title, { delay: 10 });
    await input.press('Enter');
    await admin.getByText(title).waitFor({ timeout: 20000 });
  }
  check('cards can be created and appear live', true);

  // ESCAPE CLOSES THE COMPOSER AND DISCARDS THE TITLE.
  //
  // Unique to the wide web board: it is a raw DOM <input> with its own
  // onKeyDown, and Escape is its ONLY dismiss — that composer has no Cancel
  // button at all. Nothing tested it, so an extraction could quietly drop the
  // handler and leave people with a composer they cannot close without
  // reloading.
  //
  // Discarding is asserted separately from closing, because a composer that
  // closed while keeping the text would reopen with a stale title and silently
  // create the wrong card on the next Add.
  await admin.getByRole('button', { name: '+ Add card' }).first().click();
  const escInput = admin.getByPlaceholder('Card title');
  await escInput.waitFor({ timeout: 10000 });
  await escInput.click();
  await escInput.pressSequentially('abandoned title', { delay: 10 });
  await escInput.press('Escape');
  check(
    'Escape closes the add-card composer',
    await escInput
      .waitFor({ state: 'detached', timeout: 10000 })
      .then(() => true)
      .catch(() => false),
  );

  await admin.getByRole('button', { name: '+ Add card' }).first().click();
  const reopened = admin.getByPlaceholder('Card title');
  await reopened.waitFor({ timeout: 10000 });
  check(
    'Escape discards what was typed',
    (await reopened.inputValue()) === '',
    `reopened holding ${JSON.stringify(await reopened.inputValue())}`,
  );
  await reopened.press('Escape');
  await admin.waitForTimeout(300);
  check(
    'the abandoned title never became a card',
    (await admin.locator('[data-testid="card-abandoned title"]').count()) === 0,
  );

  await admin.screenshot({ path: join(SHOTS, 'p3-board-cards-light.png'), fullPage: true });

  // Cards land in creation order (each appended after the last).
  const order = await admin.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid^="card-"]')];
    return tiles.map((t) => t.getAttribute('data-testid'));
  });
  check(
    'new cards append in order',
    order.slice(0, 3).join('|') ===
      'card-Fix signup flow|card-Draft newsletter|card-Book venue',
    order.join(' , '),
  );

  // Drag the third card into the second column.
  //
  // Playwright's dragTo() synthesises MOUSE events, which do not trigger the
  // HTML5 drag-and-drop API at all — the handlers this board actually uses. So
  // dispatch the real drag events with a shared DataTransfer, the way a browser
  // does.
  await admin.evaluate(() => {
    const card = document.querySelector('[data-testid="card-Book venue"]');
    // The column PANEL is the outermost div whose text begins with the column
    // name — the one carrying the drop handler.
    const target = [...document.querySelectorAll('div')]
      .filter((d) => d.textContent?.trimStart().startsWith('In Progress'))
      .sort((a, b) => b.textContent.length - a.textContent.length)[0];
    if (!card || !target) throw new Error('drag source or target not found');

    const dt = new DataTransfer();
    const fire = (el, type) =>
      el.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
      );

    fire(card, 'dragstart');
    fire(target, 'dragover');
    fire(target, 'drop');
    fire(card, 'dragend');
  });
  await admin.waitForTimeout(2500);

  const movedIntoDoing = await admin.evaluate(() => {
    // The column panel containing "In Progress" should now hold the card.
    const panels = [...document.querySelectorAll('div')].filter((d) =>
      d.textContent?.startsWith('In Progress'),
    );
    return panels.some((p) => p.querySelector('[data-testid="card-Book venue"]') !== null);
  });
  check('a card can be dragged to another column', movedIntoDoing);
  await admin.screenshot({ path: join(SHOTS, 'p3-board-dragged-light.png'), fullPage: true });

  // The member's open board must reflect the move without a reload.
  await sara.getByText('Book venue').first().waitFor({ timeout: 25000 });
  check('another person sees new and moved cards live', true);

  // A column with cards cannot be deleted.
  await admin.getByRole('button', { name: 'Delete column To Do' }).click();
  await admin.getByText(/still has \d+ card/).waitFor({ timeout: 15000 });
  check('deleting a non-empty column is refused, with a reason', true);
  await admin.screenshot({
    path: join(SHOTS, 'p3-column-delete-blocked-light.png'),
    fullPage: true,
  });
  await admin.getByRole('button', { name: 'Dismiss' }).click();

  // Archiving removes a card from the board.
  await admin.getByRole('button', { name: 'Archive Draft newsletter' }).click();
  await admin
    .getByText('Draft newsletter')
    .waitFor({ state: 'detached', timeout: 20000 });
  check('a card can be archived off the board', true);

  // ---- Auto-scroll while dragging -----------------------------------------
  // The HTML5 drag API does not scroll a container when the pointer reaches its
  // edge, so without explicit handling a card can only be dropped somewhere
  // already visible. This drags to the right-hand edge and asserts the board
  // actually moved — the check whose absence let this ship broken.
  await admin.evaluate(async () => {
    const row = document.querySelector('[data-testid="board-columns"]');
    if (!row) throw new Error('columns row not found');

    // Enough columns to make the row genuinely scrollable.
    row.style.maxWidth = '600px';
    const card = document.querySelector('[data-testid="card-Fix signup flow"]');
    if (!card) throw new Error('drag source not found');

    const dt = new DataTransfer();
    const fire = (el, type, x, y) =>
      el.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: x,
          clientY: y,
        }),
      );

    const rect = row.getBoundingClientRect();
    fire(card, 'dragstart', rect.left + 50, rect.top + 50);

    // Park the pointer in the right-hand edge zone and let rAF run.
    const edgeX = rect.right - 10;
    const midY = rect.top + rect.height / 2;
    window.__scrollBefore = row.scrollLeft;
    for (let i = 0; i < 30; i++) {
      fire(row, 'dragover', edgeX, midY);
      await new Promise((r) => requestAnimationFrame(r));
    }
    window.__scrollAfter = row.scrollLeft;
    fire(card, 'dragend', edgeX, midY);
  });

  const scroll = await admin.evaluate(() => ({
    before: window.__scrollBefore,
    after: window.__scrollAfter,
    max:
      document.querySelector('[data-testid="board-columns"]').scrollWidth -
      document.querySelector('[data-testid="board-columns"]').clientWidth,
  }));
  check(
    'the board auto-scrolls horizontally when dragging to its edge',
    scroll.max > 0 && scroll.after > scroll.before,
    `scrollLeft ${scroll.before} → ${scroll.after} (max ${scroll.max})`,
  );

  // And it must STOP at the limit rather than looping forever.
  await admin.evaluate(() => {
    const row = document.querySelector('[data-testid="board-columns"]');
    row.style.maxWidth = '';
    row.scrollLeft = 0;
  });

  // ---- Bulk actions (Phase 7) ---------------------------------------------
  // Put three cards in Blocked, then clear the column in one gesture — the
  // reason multi-select exists, since a column cannot be deleted while it holds
  // cards.
  for (const title of ['Bulk one', 'Bulk two', 'Bulk three']) {
    await admin.getByRole('button', { name: '+ Add card' }).last().click();
    const input = admin.getByPlaceholder('Card title');
    await input.waitFor({ timeout: 10000 });
    await input.click();
    await input.pressSequentially(title, { delay: 10 });
    await input.press('Enter');
    await admin.getByText(title).waitFor({ timeout: 20000 });
  }

  await admin.getByRole('checkbox', { name: 'Select Bulk one' }).click();
  // Shift-click extends the range, so three cards come from two clicks.
  await admin
    .getByRole('checkbox', { name: 'Select Bulk three' })
    .click({ modifiers: ['Shift'] });
  await admin.getByText('3 selected').waitFor({ timeout: 15000 });
  check('shift-click selects a range', true);
  await admin.screenshot({ path: join(SHOTS, 'p7-bulk-selected-light.png'), fullPage: true });

  // The bulk bar is icons now; the accessible name carries the word.
  await admin.getByRole('button', { name: 'Move selected cards' }).click();
  await admin.getByLabel('Destination column').selectOption({ label: 'Done' });
  await admin.waitForTimeout(2000);

  const movedTogether = await admin.evaluate(() => {
    const panel = [...document.querySelectorAll('div')]
      .filter((d) => d.textContent?.trimStart().startsWith('Done'))
      .sort((a, b) => b.textContent.length - a.textContent.length)[0];
    return ['Bulk one', 'Bulk two', 'Bulk three'].every(
      (t) => panel?.querySelector(`[data-testid="card-${t}"]`) !== null,
    );
  });
  check('a bulk move takes the whole selection to one column', movedTogether);

  // And the emptied column can now be deleted, which was the point.
  await admin.getByRole('button', { name: 'Delete column Blocked' }).click();
  // Deleting a column is a TWO-step inline confirm — the ✕ only opens
  // "Delete the column “Blocked”?", and the destructive action is the button
  // inside it. Without this the ✕ never detaches and the wait below times out
  // against a perfectly healthy app.
  await admin.getByRole('button', { name: 'Delete column', exact: true }).click();
  // Assert the column's own delete control is gone, not that the WORD Blocked
  // has left the page — it also appears in the move panel's column dropdown, so
  // a text match resolves to something that never detaches.
  await admin
    .getByRole('button', { name: 'Delete column Blocked' })
    .waitFor({ state: 'detached', timeout: 20000 });
  check('a column emptied by a bulk move can then be deleted', true);

  // Bulk archive clears them off the board in one batch.
  await admin.getByRole('checkbox', { name: 'Select Bulk one' }).click();
  await admin
    .getByRole('checkbox', { name: 'Select Bulk three' })
    .click({ modifiers: ['Shift'] });
  await admin.getByRole('button', { name: 'Archive selected cards' }).click();
  await admin.getByText('Bulk two').waitFor({ state: 'detached', timeout: 20000 });
  check('a bulk archive clears the selection off the board', true);

  // ---- My Work: the cross-board collection-group query (Phase 6) ----------
  // Assign a card to sara, then confirm it appears on HER cross-board view —
  // which is the collection-group query, the assignee read-rule, and the
  // board-name resolution all working together.
  await openCard(admin, 'Fix signup flow');
  await admin.getByText('Assignees').waitFor({ timeout: 20000 });
  // Assignees live behind a compact picker so the section does not grow with the
  // board. Open it, then assign everyone available — the list is ordered by
  // display name, so picking only "the first" would not reliably include the
  // person whose My Work we check next.
  const openPicker = admin.getByRole('button', { name: /^Assign someone/ });
  await openPicker.waitFor({ timeout: 25000 });
  await openPicker.click();

  for (let i = 0; i < 5; i++) {
    const option = admin.getByRole('button', { name: /^Assign \w/ });
    if ((await option.count()) === 0) break;
    await option.first().click();
    await admin.waitForTimeout(1200);
  }
  await admin.getByRole('button', { name: 'Done', exact: true }).click().catch(() => {});

  // Assigned people are listed with an unassign control; that is the
  // confirmation. It is named "Unassign <person>" — an icon action carrying the
  // person's name — not a bare "Remove".
  await admin
    .getByRole('button', { name: /^Unassign / })
    .first()
    .waitFor({ timeout: 20000 });
  check('the assignee picker lists assigned people and hides the rest', true);
  // Due date is a real <input type="date"> now, not preset buttons.
  const dueInput = admin.getByLabel('Due date');
  await dueInput.waitFor({ timeout: 15000 });
  // The ORG timezone's today, not UTC's, and not a timezone written out here.
  // `toISOString()` rolls over hours early and the assertion below then fails
  // because the card groups under "Next 7 days" — a real flake that only appears
  // late in the evening and reads as a regression.
  //
  // Restating the zone was the SAME bug one level up: this said America/New_York
  // and stayed saying it when ORG_TIMEZONE moved to Chicago, so between 23:00
  // and midnight Central the test wrote tomorrow's date and could never pass.
  // `todayInOrgTz` is the app's own function, so the two cannot drift again.
  const orgToday = todayInOrgTz();
  await dueInput.fill(orgToday);
  await admin.waitForTimeout(1500);
  check('a card can be assigned and given a due date', true);

  // The column is editable from the card detail — no trip back to the board.
  // It is a dropdown, not a dialog listing every column: on a board with many
  // columns that list was taller than the screen.
  const columnSelect = admin.getByLabel('Column');
  await columnSelect.waitFor({ timeout: 15000 });
  check(
    'the card column is a compact dropdown, not a list of every column',
    (await columnSelect.evaluate((el) => el.tagName)) === 'SELECT',
  );
  await columnSelect.selectOption({ label: 'Done' });
  await admin.waitForTimeout(2000);
  const movedFromDetail =
    (await columnSelect.inputValue()) ===
    (await columnSelect.evaluate((el) => {
      const opt = [...el.options].find((o) => o.textContent.trim() === 'Done');
      return opt ? opt.value : '';
    }));
  check('a card can change column from its detail view', movedFromDetail);
  // Put it back so later assertions still find it in To Do.
  await columnSelect.selectOption({ label: 'To Do' });
  await admin.waitForTimeout(2000);

  // ---- Labels are ORG-WIDE ------------------------------------------------
  // The renamed label from board settings must be offered on this card without
  // anything having added it to this board, because there is no such thing as
  // adding a label to a board any more.
  check(
    'a label made in board settings is offered on a card',
    await admin
      .getByRole('button', { name: 'Label urgent-fix' })
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  // The `+` is the one label affordance a plain member gets, since board
  // settings is manager-only. Creating from here applies it to the card too.
  await admin.getByRole('button', { name: 'New label' }).click();
  await admin.getByPlaceholder('Label name').fill('cross-board');
  await admin.getByRole('button', { name: 'Add label' }).click();
  check(
    'a label added from a card is applied to that card',
    await admin
      .getByRole('button', { name: 'Label cross-board' })
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  await admin.screenshot({ path: join(SHOTS, 'p5-card-detail-light.png'), fullPage: true });

  // ---- Saving the TITLE must not discard an unsaved DESCRIPTION -----------
  //
  // The card screen holds a draft per editor and both can be open at once. They
  // used to share ONE dirty flag, so saving the title cleared it, re-armed the
  // seeding effect, and silently overwrote an unsaved description with the
  // server's copy — a long description lost with no error and nothing to undo.
  // Two separate flags fixed it, which works only while everyone remembers why.
  //
  // Nothing has ever tested it. This is that test, and it is deliberately
  // written against the arrangement it describes rather than after any
  // refactor: a test written afterwards encodes whatever was built and cannot
  // report that the behaviour changed.
  await admin.getByRole('button', { name: 'Edit description' }).click();
  const descBox = admin.locator('[contenteditable="true"]').first();
  await descBox.waitFor({ timeout: 20000 });
  await descBox.click();
  await descBox.pressSequentially('unsaved draft text', { delay: 10 });

  await admin.getByRole('button', { name: 'Edit title' }).click();
  const titleBox = admin.getByLabel('Card title');
  await titleBox.waitFor({ timeout: 20000 });
  await titleBox.fill('Fix signup flow renamed');
  await admin.getByRole('button', { name: 'Save', exact: true }).first().click();
  await admin.waitForTimeout(1500);

  check(
    'saving the title leaves an unsaved description untouched',
    (await editorText(descBox)).includes('unsaved draft text'),
    await editorText(descBox).catch(() => '(editor gone)'),
  );

  // The check above proves the description SURVIVED. It says nothing about
  // whether the title save actually landed — an editor that silently dropped
  // the write would pass it. Assert the commit too, or "leaves the description
  // untouched" is satisfied by a title editor that does nothing at all.
  // EXACT, because the activity log on this same screen now reads
  // `… renamed it to “Fix signup flow renamed” · just now`. That is one Hint
  // element whose whole text is longer, so only the title node matches exactly.
  // `Title` is a plain Text with no header role, so getByRole('heading') would
  // match nothing here and the check would fail for the wrong reason.
  check(
    'saving the title actually renames the card',
    await admin
      .getByText('Fix signup flow renamed', { exact: true })
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  // Put it back so later steps see the title they expect.
  await admin.getByRole('button', { name: 'Edit title' }).click();
  await admin.getByLabel('Card title').fill('Fix signup flow');
  await admin.getByRole('button', { name: 'Save', exact: true }).first().click();
  await admin.waitForTimeout(1200);
  await admin.getByRole('button', { name: 'Cancel' }).first().click();
  await admin.waitForTimeout(800);

  // ---- A renamed title reaches the BOARD TILE ------------------------------
  //
  // The card screen and the board tile read the card through different live
  // queries. Renaming updates the heading from the card's own document, so the
  // check above passes even if the board never hears about it. Done here, with
  // the description editor closed, so the round trip cannot disturb the draft
  // the test above depends on.
  await admin.getByRole('button', { name: 'Edit title' }).click();
  await admin.getByLabel('Card title').fill('Fix signup flow renamed');
  await admin.getByRole('button', { name: 'Save', exact: true }).first().click();
  await admin.waitForTimeout(1200);

  await admin.getByRole('button', { name: 'Back' }).first().click();
  check(
    'a renamed card shows its new title on the board',
    await admin
      .locator('[data-testid="card-Fix signup flow renamed"]')
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  // Back into the card and restore the name every later section expects.
  await openCard(admin, 'Fix signup flow renamed');
  await admin.getByRole('button', { name: 'Edit title' }).click();
  await admin.getByLabel('Card title').fill('Fix signup flow');
  await admin.getByRole('button', { name: 'Save', exact: true }).first().click();
  await admin.waitForTimeout(1200);

  // ---- Comments, mentions and activity (Phases 8-9) ----------------------
  // Still on the card detail screen from the assignment above.
  const commentBox = commentEditor(admin);
  await commentBox.waitFor({ timeout: 20000 });
  await commentBox.click();
  await commentBox.pressSequentially('Kicking this off, cc @', { delay: 10 });

  // Rows are named "Mention <person>". NOT wrapped in an `if (isVisible)` like
  // this block used to be: a guard like that turns a broken selector into a
  // silently skipped test, which is how the old `(@` selector would have gone on
  // "passing" after the rows were relabelled.
  const rows = admin.getByRole('button', { name: /^Mention / });
  await rows.first().waitFor({ timeout: 20000 });
  const labels = await rows.evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label') ?? ''),
  );
  check('typing @ lists people to mention', labels.length >= 2, `${labels.length} offered`);

  // ArrowDown then Enter must pick the SECOND row, which is the only thing that
  // proves the highlight moved rather than Enter just taking the top match.
  // Bail cleanly rather than throwing on labels[1]: a stack trace here would
  // abort the run and lose the forty-odd checks after it, turning one seed
  // change into a total blackout.
  if (labels.length < 2) throw new Error(`need 2+ mention candidates, got ${labels.length}`);
  const wanted = labels[1].replace(/^Mention\s+/, '').split(/\s+/)[0].toLowerCase();
  await admin.keyboard.press('ArrowDown');
  await admin.keyboard.press('Enter');
  await admin.waitForTimeout(500);
  const afterArrow = await editorText(commentBox);
  check(
    'arrow keys move the highlight and Enter accepts it',
    afterArrow.includes(`@${wanted}`),
    afterArrow,
  );

  // Escape closes a list you did not want, without touching the text.
  await commentBox.click();
  await commentBox.pressSequentially(' @', { delay: 10 });
  await rows.first().waitFor({ timeout: 15000 });
  const beforeEsc = await editorText(commentBox);
  await admin.keyboard.press('Escape');
  await admin.waitForTimeout(400);
  check('Escape dismisses the list', (await rows.count()) === 0);
  check('and leaves what was typed alone', (await editorText(commentBox)) === beforeEsc);

  // Typing again brings it back — Escape must not disable it for good.
  await commentBox.pressSequentially('s', { delay: 10 });
  check(
    'typing after Escape reopens the list',
    await rows
      .first()
      .waitFor({ timeout: 15000 })
      .then(() => true)
      .catch(() => false),
  );

  // Look at the popover on WEB, not just Android — `position: absolute` with
  // `bottom: '100%'` is the one part of this that could render differently under
  // react-native-web.
  await admin.screenshot({ path: join(SHOTS, 'p8-mention-popover-light.png') });

  // Tab accepts as well as Enter. Verified rather than assumed because the user
  // manual promises it, and because preventDefault has to stop Tab doing its
  // normal job of moving focus out of the box.
  const beforeTab = await editorText(commentBox);
  await admin.keyboard.press('Tab');
  await admin.waitForTimeout(500);
  const afterTab = await editorText(commentBox);
  check('Tab accepts the highlighted person', afterTab !== beforeTab, afterTab);
  check(
    'and Tab does not move focus out of the box',
    await focusIsInEditor(admin),
  );

  // Clicking AWAY closes the list — a draft left ending in "@sa" used to leave
  // it floating over the card indefinitely.
  await commentBox.click();
  await commentBox.pressSequentially(' @', { delay: 10 });
  await rows.first().waitFor({ timeout: 15000 });
  // react-native-web renders headings as plain divs, so getByRole('heading')
  // matches nothing. Click a section title by TEXT — "Subtasks" is inert and,
  // unlike the Danger zone heading, nowhere near Archive or Delete.
  await admin.getByText('Subtasks').first().click();
  await admin.waitForTimeout(700);
  check('clicking away closes the mention list', (await rows.count()) === 0);

  // …and this is the pair that matters. Closing on blur is only safe because it
  // is DEFERRED: a click fires mousedown → blur → click, so an immediate close
  // would destroy the row being clicked and the pick would silently never
  // happen. These two checks have to move together.
  await commentBox.click();
  await commentBox.pressSequentially(' @', { delay: 10 });
  await rows.first().waitFor({ timeout: 15000 });
  await rows.first().click();
  await admin.waitForTimeout(400);
  const focused = await focusIsInEditor(admin);
  check('picking a mention keeps focus in the comment box', focused);
  // And typing actually continues into the same box.
  await admin.keyboard.type('please take a look');

  await admin.getByRole('button', { name: 'Comment', exact: true }).click();
  await admin.getByText('Kicking this off').waitFor({ timeout: 20000 });
  check('a comment can be posted', true);

  // Wait rather than sample: the caption renders once the comment round-trips.
  const mentionRecorded = await admin
    .getByText('mentioned', { exact: false })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('an @mention resolves to a person on the card', mentionRecorded);

  // The activity log is written by a trigger, so it lags slightly.
  await admin.getByText('created this card').waitFor({ timeout: 25000 });
  check('activity records card creation', true);
  await admin.getByText('assigned', { exact: false }).first().waitFor({ timeout: 25000 });
  check('activity records assignment', true);
  await admin.screenshot({ path: join(SHOTS, 'p8-card-comments-light.png'), fullPage: true });

  // ---- Editing a comment --------------------------------------------------
  //
  // Untested until now, on either surface. The edit box is a SECOND RichEditor
  // with its own seed, and the list allows exactly one row in edit mode — both
  // properties held only by the arrangement of state in Comments.tsx, so both
  // are asserted here before that arrangement changes.
  await admin.getByRole('button', { name: 'Edit comment' }).first().click();
  const editBox = admin.locator('[data-testid="comment-edit-editor"]');
  await editBox.waitFor({ timeout: 20000 });
  await editBox.click();
  await admin.keyboard.press('End');
  await admin.keyboard.type(' — revised');
  await admin.getByRole('button', { name: 'Save', exact: true }).first().click();

  const edited = await admin
    .getByText('revised', { exact: false })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('a comment can be edited', edited);
  check(
    'an edited comment is marked as edited',
    await admin
      .getByText('edited', { exact: false })
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  // ONE row at a time. `editing` is a single comment id, so opening a second
  // edit box must close the first. Nothing else states that invariant.
  //
  // A second comment is posted first, deliberately: guarding this with
  // `if (count >= 2)` would skip silently on a card with one comment, and a
  // check that can quietly not run is the failure mode this file exists to
  // avoid.
  await commentBox.click();
  await admin.keyboard.type('second comment');
  await admin.getByRole('button', { name: 'Comment', exact: true }).click();
  await admin.getByText('second comment').waitFor({ timeout: 20000 });

  // THE COMPOSER EMPTIES ITSELF, which is what `composerKey` is for.
  //
  // `RichEditor` is uncontrolled — it seeds once at mount — so clearing `draft`
  // does nothing visible on its own; bumping the key to remount it is the only
  // reset there is. Untested until now, and the failure is quiet: the next
  // comment starts with the previous one still in the box.
  check(
    'the comment composer is empty after posting',
    (await editorText(commentBox)).trim() === '',
    `composer still holds ${JSON.stringify((await editorText(commentBox)).slice(0, 60))}`,
  );

  const editButtons = admin.getByRole('button', { name: 'Edit comment' });
  check('two comments are present to test one-at-a-time', (await editButtons.count()) === 2);
  await editButtons.nth(0).click();
  await admin.waitForTimeout(600);
  await admin.getByRole('button', { name: 'Edit comment' }).first().click();
  await admin.waitForTimeout(600);
  check(
    'only one comment can be in edit mode at a time',
    (await admin.locator('[data-testid="comment-edit-editor"]').count()) === 1,
  );
  await admin.getByRole('button', { name: 'Cancel' }).first().click();
  await admin.waitForTimeout(500);

  // ---- Subtasks: create and unlink -----------------------------------------
  //
  // No suite has ever touched these; `web-e2e` only clicked the section
  // heading. A subtask is a real card carrying `parentId`, so this asserts the
  // write as well as the row.
  //
  // KEYED ON THE ROW'S OWN CONTROL, never on the title text. Adding a subtask
  // writes `added <title> as a subtask` into the activity log on this same
  // screen (packages/shared/src/activity.ts:174), and that entry correctly
  // survives the unlink — so `getByText(title)` matches after the row is gone,
  // and matched something before the row existed. The unlink button's label
  // exists only while the row does.
  const subtaskRow = admin.getByRole('button', {
    name: 'Unlink subtask Draft the agenda',
  });

  await admin.getByLabel('New subtask title').fill('Draft the agenda');
  await admin.getByRole('button', { name: 'Add subtask' }).click();
  check(
    'a subtask can be created from the card',
    await subtaskRow
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  await subtaskRow.click();
  check(
    'a subtask row goes away when unlinked',
    await subtaskRow
      .waitFor({ state: 'detached', timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  // UNLINK IS NOT DELETE. It clears `parentId`; the card lives on. Proved
  // without leaving the screen: an unparented card on this board becomes
  // linkable again, so it must be offered by the picker.
  await admin.getByRole('button', { name: 'Link an existing card' }).click();
  check(
    'an unlinked subtask still exists as a card',
    await admin
      .getByRole('button', { name: 'Link Draft the agenda as a subtask' })
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );
  // The picker's own Cancel is the last one on screen. That is positional, so
  // it is verified rather than assumed: if the click lands elsewhere the picker
  // stays open and this fails, instead of leaving the suite in a state later
  // checks would trip over for unrelated-looking reasons.
  await admin.getByRole('button', { name: 'Cancel' }).last().click();
  check(
    'the link picker closes again',
    await admin
      .getByRole('button', { name: 'Link Draft the agenda as a subtask' })
      .waitFor({ state: 'detached', timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  // Sara sees the comment on her side, live.
  await sara.getByRole('button', { name: 'Back' }).first().click();
  await sara.getByRole('button', { name: 'My work' }).click();
  await sara.getByText('My work').first().waitFor({ timeout: 20000 });
  await sara.getByText('Fix signup flow').waitFor({ timeout: 25000 });
  check('My Work shows a card assigned on another board', true);

  // WAIT for live content, never sample it. The board name is resolved by a
  // separate lookup and the grouping renders on its own snapshot, so a single
  // instant `isVisible()` wins on a fast machine and loses on a slower CI
  // runner — the exact race that made the attachments suite flake in CI.
  const showsBoardName = await sara
    .getByText('Fundraising 2026')
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('My Work names the board, resolved with no extra reads', showsBoardName);

  const showsToday = await sara
    .getByText('Today', { exact: false })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('My Work groups by due state', showsToday);
  await sara.screenshot({ path: join(SHOTS, 'p6-mywork-light.png'), fullPage: true });

  // ---- Subscribing to a card's comments -----------------------------------
  // Sara subscribes to a card she is NOT assigned to. The whole point of the
  // feature is hearing about a conversation on work that is not yours.
  // NOT backToBoards() — that waits for the "New board" button, which a MEMBER
  // never sees (asserted a few checks above). Navigate by the rail instead.
  await sara.getByRole('button', { name: 'Boards', exact: true }).first().click();
  await sara.getByText('Fundraising 2026').first().waitFor({ timeout: 20000 });
  await sara.getByText('Fundraising 2026').first().click();
  await openCard(sara, 'Book venue');

  /**
   * THE THREE PLACES A NON-OWNER MUST NOT BE OFFERED PERMANENT DELETION.
   *
   * The rules refuse all three, and the rules suites prove that — but a control
   * that is shown and then fails is a different bug from one the server bounces,
   * and it is the bug that actually shipped: the label pencil and bin sat inside
   * the owner-gated panel and stayed there when curation narrowed to admins.
   * Nothing found that until somebody looked at a screenshot. So each of these
   * is checked on screen, with the admin's own view as the positive control —
   * absence proves nothing if the control is absent for everyone.
   */
  check(
    'a member gets no permanent delete on a card',
    !(await sara
      .getByRole('button', { name: 'Delete permanently' })
      .isVisible()
      .catch(() => false)),
  );
  check(
    'and no warning sentence hinting at one',
    !(await sara
      .getByText(/Deleting is permanent/)
      .isVisible()
      .catch(() => false)),
  );

  await sara.getByRole('button', { name: 'Subscribe to comments' }).click();
  check(
    'subscribing flips the control to unsubscribe',
    await sara
      .getByRole('button', { name: 'Unsubscribe from comments' })
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  await sara.getByRole('button', { name: 'My work' }).click();
  await sara.getByText('My work').first().waitFor({ timeout: 20000 });
  // POSITIVE CONTROL FIRST. Waiting only for the page title and then sampling
  // for absence is the check that passes because nothing has rendered yet — so
  // wait for a card that MUST be in the Assigned list before asserting that the
  // subscribed one is not.
  await sara.getByText('Fix signup flow').first().waitFor({ timeout: 20000 });
  // The Assigned list must NOT contain it — she is not assigned to it, and the
  // two lists answering different questions is the reason there are two.
  check(
    'a subscribed card is absent from Assigned',
    !(await sara.getByText('Book venue').first().isVisible().catch(() => false)),
  );
  await sara.getByRole('button', { name: /^Subscribed \(1\)/ }).click();
  check(
    'and present under Subscribed',
    await sara
      .getByText('Book venue')
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false),
  );

  // The SAME class of bug Search had: opening a card unmounts the screen, so the
  // Assigned/Subscribed choice died with it and Back landed you on Assigned. My
  // Work is the phone's default landing surface, so this is the most-hit version.
  await sara.getByText('Book venue').first().click();
  await sara.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 20000 });
  await sara.getByRole('button', { name: 'Back' }).first().click();
  await sara.waitForTimeout(1200);
  check(
    'My Work stays on Subscribed after opening a card and coming back',
    await sara
      .getByText('Book venue')
      .first()
      .isVisible()
      .catch(() => false),
  );

  // The admin comments; Sara hears about it even though it is not her card.
  await backToBoards(admin);
  await admin.getByText('Fundraising 2026').first().click();
  await openCard(admin, 'Book venue');

  // THE POSITIVE CONTROL for the three absence checks above and below. Same
  // card, same screen; only the authority differs.
  check(
    'an owner does get permanent delete on the same card',
    await admin
      .getByRole('button', { name: 'Delete permanently' })
      .isVisible()
      .catch(() => false),
  );

  const venueBox = commentEditor(admin);
  await venueBox.waitFor({ timeout: 20000 });
  await venueBox.click();
  await venueBox.pressSequentially('caterer confirmed', { delay: 10 });
  await admin.getByRole('button', { name: 'Comment', exact: true }).click();
  await admin.getByText('caterer confirmed').waitFor({ timeout: 20000 });

  // ---- Notifications inbox (Phase 10) -------------------------------------
  // Sara was @mentioned and assigned, so her inbox should hold entries written
  // by the triggers — not by any client.
  // My Work is a TAB ROOT, so it has no Back — the navigation shell dropped the
  // redundant Back from the tab roots (My work / Search / Alerts) and you move
  // between them with the nav itself. Clicking Alerts is the whole journey.
  await sara.getByRole('button', { name: /^Alerts/ }).click();
  await sara.getByText('Notifications').first().waitFor({ timeout: 20000 });
  await sara.getByText('mentioned you', { exact: false }).waitFor({ timeout: 25000 });
  check('an @mention lands in the recipient inbox', true);

  // The subscription notification — a comment on a card that is not hers, and
  // on which she was not mentioned. Nothing but the subscription explains it.
  check(
    'a comment on a subscribed card reaches the subscriber',
    await sara
      .getByText('commented on', { exact: false })
      .first()
      .waitFor({ timeout: 25000 })
      .then(() => true)
      .catch(() => false),
  );

  // A DIFFERENT notification from the mention waited on above, written by a
  // different trigger, so it arrives on its own schedule.
  const assignedEntry = await sara
    .getByText('assigned you', { exact: false })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('an assignment lands in the inbox too', assignedEntry);
  await sara.screenshot({ path: join(SHOTS, 'p10-inbox-light.png'), fullPage: true });

  // Preferences are per-event and per-board.
  await sara.getByRole('button', { name: 'Settings' }).click();
  await sara.getByText('What you are told about').first().waitFor({ timeout: 15000 });

  /*
   * The panel must always say SOMETHING about this device — exactly one of the
   * four states, never none and never two. Browser-independent on purpose:
   * headless Chromium reports permission as 'denied' and the full browser
   * reports 'default', so asserting a particular message would hold under only
   * one of them. What must hold under both is that the section exists at all —
   * without this the run merely screenshots whatever renders, and the whole
   * control could vanish with every check still green.
   */
  // One literal for the message the re-read check waits for, shared with the
  // list below rather than written twice: two copies of the same string in one
  // file is two places for it to drift from the app.
  const UNSUPPORTED = 'Notifications can\u2019t be set up on this device.';
  const deviceStates = [
    'Notifications are not enabled on this device.',
    'Notifications are enabled on this device.',
    'Notifications are blocked for this app on this device.',
    UNSUPPORTED,
  ];
  const deviceShown = [];
  for (const m of deviceStates) {
    if (await sara.getByText(m, { exact: false }).first().isVisible().catch(() => false)) {
      deviceShown.push(m);
    }
  }
  check(
    'the panel says exactly one thing about this device',
    deviceShown.length === 1,
    `saw ${deviceShown.length}: ${deviceShown.join(' | ') || '(none)'}`,
  );

  /*
   * The panel must CORRECT ITSELF when the permission changes outside the app.
   *
   * Found on an Android device and invisible to every suite: the only advice a
   * blocked device gets is **Open settings**, which leaves the app — and coming
   * back left the screen still reading "blocked", beside the same button back
   * to the setting just fixed. `dumpsys` said granted the whole time. This app
   * renders one screen per route, so returning from an external activity
   * remounts nothing and re-runs no effect.
   *
   * Driven here the way a browser drives it: grant the permission on the
   * context, then dispatch `visibilitychange`, which is exactly what
   * react-native-web's AppState listens for — it emits `currentState` with no
   * diffing, so one event is a faithful return-to-front.
   *
   * The DESTINATION is browser-independent even though the starting state is
   * not (headless Chromium reports 'denied', a full browser 'default'): once
   * permission is granted, an emulator-backed run can never file a token, so
   * 'unsupported' is the only honest answer either way.
   */
  // Guard the guard. If the panel already reads the message we are waiting for,
  // the check below passes without anything having happened — which is the
  // failure mode this whole file exists to avoid. It is reachable: with no
  // EXPO_PUBLIC_FCM_VAPID_KEY every state collapses to 'unsupported', which is
  // how CI ran until e2e.sh started supplying a fake one.
  check(
    'the device panel starts somewhere a re-read could move it from',
    deviceShown[0] !== UNSUPPORTED,
    `panel already reads "${UNSUPPORTED}" — the re-read check below would prove nothing`,
  );

  // The permission is CHANGED UNDER THE PAGE, which is the only way to pose the
  // question here: headless Chromium reports `Notification.permission` as
  // 'denied' and will not move it — `context.grantPermissions(['notifications'])`
  // updates the permission manager and leaves the getter saying 'denied'
  // (measured, not assumed). Stubbing the getter is honest for what is under
  // test: the subject is OUR re-read, not Chromium's permission store, and the
  // question is whether the panel catches up when the answer changes while the
  // app is away. Mutation-checked — drop the AppState subscription from
  // useCheckOnForeground and this goes red.
  await sara.evaluate(() => {
    // Explicit, because the failure to avoid is a silent one: without
    // Notification the defineProperty throws a TypeError about an undefined
    // object, and the check below then fails for a reason unrelated to what it
    // is about.
    if (typeof window.Notification === 'undefined') {
      throw new Error('no window.Notification to stub — the re-read check cannot run');
    }
    Object.defineProperty(window.Notification, 'permission', {
      configurable: true,
      get: () => 'granted',
    });
  });
  await sara.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const reRead = await sara
    .getByText(UNSUPPORTED, { exact: false })
    .first()
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check(
    'the device panel re-reads when the app returns to the front',
    reRead,
    `panel never moved to "${UNSUPPORTED}" after the permission changed`,
  );

  const movedDefaultOff = await sara
    .getByText('A card assigned to you was moved')
    .first()
    .isVisible();
  check('the high-frequency event is listed and defaults off', movedDefaultOff);
  await sara.screenshot({ path: join(SHOTS, 'p10-notify-settings-light.png'), fullPage: true });

  await sara.getByRole('button', { name: 'Inbox' }).click();
  await sara.getByRole('button', { name: 'Mark all read' }).click();
  // Wait for the marker to GO, rather than sleeping and hoping it has. A fixed
  // sleep is a race with a nicer face on it.
  const stillUnread = await sara
    .getByText('· unread', { exact: false })
    .first()
    .waitFor({ state: 'detached', timeout: 20000 })
    .then(() => false)
    .catch(() => true);
  check('mark all read clears the inbox badge', !stillUnread);

  // ---- Mark one back to unread -------------------------------------------
  // The point of the feature: everything is read, and one item gets flagged to
  // come back to. It must NOT re-push, but that is a server property and is
  // pinned in functions/test/integration/notifications.test.ts — what this
  // checks is the round trip a person actually performs.
  const markUnread = sara.getByRole('button', { name: /^Mark unread: / }).first();
  await markUnread.waitFor({ timeout: 20000 });
  const flaggedName = (await markUnread.getAttribute('aria-label')) ?? '';
  await markUnread.click();

  const backToUnread = await sara
    .getByText('· unread', { exact: false })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('one entry can be put back to unread', backToUnread);

  // The control flipped with the state — one control showing what it will do,
  // not two buttons. Same row, so it must now offer the opposite verb.
  const flipped = await sara
    .getByRole('button', { name: flaggedName.replace('Mark unread: ', 'Mark read: ') })
    .first()
    .isVisible()
    .catch(() => false);
  check('the row action flips to "Mark read" once unread', flipped);

  // ---- Unread-only filter -------------------------------------------------
  await sara.getByRole('button', { name: 'Show unread only' }).click();
  const onlyUnread = await sara
    .waitForFunction(
      () => {
        const rows = document.querySelectorAll('[aria-label^="Dismiss: "]').length;
        const unread = (document.body.textContent || '').split('· unread').length - 1;
        return rows > 0 && rows === unread;
      },
      undefined,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  check('the unread filter lists only unread entries', onlyUnread);

  // Visible AND removable in one tap — a filter that cannot be cleared is a
  // trap, and this one hides everything else on the screen.
  await sara.getByRole('button', { name: 'Show all alerts' }).click();
  const restored = await sara
    .waitForFunction(
      () => document.querySelectorAll('[aria-label^="Dismiss: "]').length > 1,
      undefined,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  check('clearing the unread filter brings the rest back', restored);

  // ---- Search (Phase 11) --------------------------------------------------
  // Walk back to the board list rather than assuming how deep the stack is —
  // earlier sections leave the admin on a card or a board depending on flow.
  await backToBoards(admin);
  await admin.getByRole('button', { name: 'Search' }).click();
  const searchBox = admin.getByPlaceholder('Search cards across your boards');
  await searchBox.waitFor({ timeout: 20000 });
  await searchBox.click();
  await searchBox.pressSequentially('signup', { delay: 15 });
  await admin.getByText('Fix signup flow').first().waitFor({ timeout: 25000 });
  check('search finds a card by title across boards', true);

  // A description-only match proves it is not just filtering titles.
  await searchBox.fill('');
  await searchBox.pressSequentially('venue', { delay: 15 });
  await admin.getByText('Book venue').first().waitFor({ timeout: 20000 });
  check('search matches on card content', true);

  // Archived cards are hidden until asked for — the archive is a separate place.
  await searchBox.fill('');
  await searchBox.pressSequentially('Draft newsletter', { delay: 15 });
  // The empty state reads "Nothing to show" — the heading doubles as the count,
  // so there is no separate "No matches" line any more.
  await admin.getByText('Nothing to show').waitFor({ timeout: 20000 });
  check('archived cards are excluded from search by default', true);

  // Archived is a FILTER CHIP now. Its accessible name carries the state —
  // "Archived filter, off" / ", on" — so match the prefix, and the state is
  // assertable rather than assumed.
  await admin.getByRole('button', { name: 'Archived filter, off' }).click();
  await admin
    .getByRole('button', { name: 'Archived filter, on' })
    .waitFor({ timeout: 15000 });
  await admin.getByText('Draft newsletter').first().waitFor({ timeout: 20000 });
  check('archived cards are findable when explicitly included', true);
  await admin.screenshot({ path: join(SHOTS, 'p11-search-light.png'), fullPage: true });

  // ---- Filtering search by label ------------------------------------------
  // The picker offers only labels not already chosen, and a card matches ANY of
  // them — so a second label must WIDEN the result, not empty it.
  await searchBox.fill('');
  // The archived-search check above leaves the Archived chip ON, and it is
  // exclusive rather than additive — leaving it would filter labels against the
  // archive alone, where none of these labels live.
  await admin.getByRole('button', { name: 'Archived filter, on' }).click();
  await admin
    .getByRole('button', { name: 'Archived filter, off' })
    .waitFor({ timeout: 15000 });
  await admin.waitForTimeout(600);

  // The result count is a plain div (see above), and reads "Nothing to show"
  // rather than "0 cards" when empty.
  const resultCount = async () => {
    if (await admin.getByText('Nothing to show').isVisible().catch(() => false)) return 0;
    const label = await admin
      .getByText(/^\d+ (cards?|match(es)?)$/)
      .first()
      .textContent();
    return Number((label ?? '').replace(/\D/g, '') || '0');
  };

  const allCount = await resultCount();
  /**
   * Labels are picked from the Filters sheet now, not a dropdown.
   *
   * Board and label were the two UNBOUNDED lists; left as their own dropdowns
   * they would have been five stacked controls above the results. Whatever they
   * select still comes back as a removable chip, which is what the rest of this
   * section drives.
   */
  /**
   * A section header, and ONLY that section header.
   *
   * The name is not fixed: a header carries its own state, so `Board` becomes
   * `Board: Fundraising 2026` and `Labels` becomes `Labels (2)` once something
   * is picked. A bare `/^Board/` therefore looks right and is not — it also
   * matches the **Boards nav tab** in the rail behind the modal, which is what
   * `.first()` then clicked, and the backdrop swallowed it. Anchoring on what
   * can legitimately FOLLOW the name is what separates them.
   */
  const sectionHeader = (name) => new RegExp(`^${name}(:| \\(|$)`);

  /**
   * Open Filters, expand a section, pick a row, close again.
   *
   * Three steps rather than one, and each is load-bearing. Sections are
   * COLLAPSED on open — one expanded section is all that fits inside the
   * sheet's bounded height on a phone — so the row is not in the DOM until the
   * header is clicked. And the sheet now STAYS OPEN across picks, because
   * multi-select otherwise means reopening it once per value; that leaves a
   * full-screen modal over the chip row, so every assertion after this one
   * would either time out or, worse, match the sheet's own row and pass while
   * proving nothing.
   */
  const pickInFilters = async (section, name) => {
    await admin.getByRole('button', { name: 'Filters', exact: true }).click();
    await admin.getByRole('button', { name: sectionHeader(section) }).first().click();
    // A string is matched exactly; a RegExp is for the priority chips, whose
    // accessible name carries their on/off state and so cannot be fixed.
    await admin
      .getByRole('button', typeof name === 'string' ? { name, exact: true } : { name })
      .first()
      .click();
    await admin.getByRole('button', { name: 'Done', exact: true }).click();
    await admin.waitForTimeout(700);
  };

  /**
   * A priority chip INSIDE the sheet.
   *
   * Its announced name is deliberately not just the word: the same word appears
   * as the active-filter chip behind the sheet, and two controls answering to
   * one name is ambiguous for a screen reader and for this locator alike.
   */
  const priorityChip = (word) => new RegExp(`^${word} priority filter,`);
  // `cross-board` is the one actually applied to a card, further up.
  await pickInFilters('Labels', 'Filter by cross-board');
  await admin.waitForTimeout(800);
  const oneLabel = await resultCount();
  check(
    'picking a label narrows the results',
    oneLabel > 0 && oneLabel < allCount,
    `${oneLabel} of ${allCount}`,
  );

  // `urgent-fix` is on NO card, which is what makes this discriminating: under
  // "any" the result is unchanged, under "all" it would collapse to zero. This
  // is the check that fails if the semantics are ever flipped.
  await pickInFilters('Labels', 'Filter by urgent-fix');
  await admin.waitForTimeout(300);
  const twoLabels = await resultCount();
  check(
    'a second label matches ANY of them rather than all',
    twoLabels === oneLabel && twoLabels > 0,
    `${twoLabels} with two labels vs ${oneLabel} with one`,
  );

  // Each pick is a chip; tapping it drops the label again.
  await admin.getByRole('button', { name: 'urgent-fix' }).first().click();
  await admin.waitForTimeout(800);
  const afterDrop = await resultCount();
  check('removing a label chip leaves the rest filtering', afterDrop === oneLabel);
  await admin.getByRole('button', { name: 'cross-board' }).first().click();
  await admin.waitForTimeout(600);
  check(
    'and clearing every chip returns to the full list',
    (await resultCount()) === allCount,
  );

  // ---- Search survives opening a card, and can be cleared -----------------
  // The reported bug: opening a card from Search and pressing Back came back to
  // an empty screen. App.tsx swaps screens by route, so SearchScreen UNMOUNTS
  // and every useState in it died — the filters now live outside the component.
  // Filter to ONE board first, so there is certainly something to open. The
  // earlier attempt combined text + Urgent + board and matched nothing, so the
  // click had no card to find — a test that fails for a reason unrelated to the
  // thing it is testing.
  await pickInFilters('Board', 'Filter to Fundraising 2026');
  check(
    'search can be filtered to a single board',
    await admin.getByRole('button', { name: 'Fundraising 2026' }).first().isVisible(),
  );

  const onBoard = await resultCount();
  check('the board filter leaves something to look at', onBoard > 0, `${onBoard} cards`);

  // Type a term taken from a card that IS showing, so the search is guaranteed
  // to match rather than depending on fixture wording.
  const firstTile = admin.locator('[data-testid^="card-"]').first();
  await firstTile.waitFor({ timeout: 20000 });
  const tileTitle = ((await firstTile.getAttribute('data-testid')) ?? '').replace(/^card-/, '');
  const term = tileTitle.split(' ')[0];
  await searchBox.fill(term);
  await admin.waitForTimeout(700);
  const beforeOpen = await resultCount();

  // Open it, then come straight back — the reported bug.
  await admin.locator('[data-testid^="card-"]').first().click();
  await admin.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 20000 });
  await admin.getByRole('button', { name: 'Back' }).first().click();
  await admin.waitForTimeout(1200);

  const textKept = await searchBox.inputValue();
  const boardKept = await admin
    .getByRole('button', { name: 'Fundraising 2026' })
    .first()
    .isVisible()
    .catch(() => false);
  check(
    'going back from a card restores the search text AND the chips',
    textKept === term && boardKept,
    `text "${textKept}" (wanted "${term}"), board chip ${boardKept}`,
  );
  check('and the results with it', (await resultCount()) === beforeOpen);

  // Which is exactly why there has to be a way out.
  await admin.getByRole('button', { name: 'Clear all filters' }).click();
  await admin.waitForTimeout(800);
  check(
    'clear-all empties the text and every chip',
    (await searchBox.inputValue()) === '' &&
      !(await admin
        .getByRole('button', { name: 'Fundraising 2026' })
        .first()
        .isVisible()
        .catch(() => false)),
  );
  check(
    'and the control disappears once there is nothing to clear',
    !(await admin
      .getByRole('button', { name: 'Clear all filters' })
      .isVisible()
      .catch(() => false)),
  );

  // ---- Priority is a MULTI-select now, and it counts 'None' ---------------
  // It used to be two chips, Urgent and High, which turned each other off — so
  // "the things that matter" could not be asked for at all.
  {
    /**
     * Give two cards a priority FIRST.
     *
     * Every fixture card is `none` until something sets one, and against that
     * data every assertion below is vacuously true: "urgent or high widens the
     * result" holds trivially when both are zero, and "None narrows" cannot
     * hold at all when None is everything. A discriminating test needs cards on
     * both sides of the filter.
     */
    // Taken from what is actually on screen rather than hardcoded: by this point
    // in the run cards have been renamed, archived and moved between boards, and
    // a fixed title is a test that fails for a reason unrelated to its subject.
    const visible = await admin
      .locator('[data-testid^="card-"]')
      .evaluateAll((els) =>
        els.map((e) => (e.getAttribute('data-testid') ?? '').replace(/^card-/, '')),
      );
    const setPriority = async (title, priority) => {
      await admin.locator(`[data-testid="card-${title}"]`).first().click();
      await admin.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 20000 });
      await admin.getByRole('button', { name: `Priority ${priority}` }).click();
      await admin.waitForTimeout(600);
      await admin.getByRole('button', { name: 'Back' }).first().click();
      // Search re-fetches on mount, so give it the round trip before counting.
      await admin.waitForTimeout(1500);
    };
    await setPriority(visible[0], 'urgent');
    await setPriority(visible[1], 'high');
    const total = await resultCount();

    await pickInFilters('Priority', priorityChip('Urgent'));
    const urgent = await resultCount();
    check('one priority narrows the results', urgent > 0 && urgent < total, `${urgent} of ${total}`);

    await pickInFilters('Priority', priorityChip('High'));
    const urgentOrHigh = await resultCount();
    check(
      'a second priority WIDENS the result rather than replacing the first',
      urgentOrHigh > urgent && urgentOrHigh < total,
      `${urgent} urgent, ${urgentOrHigh} urgent-or-high, ${total} in all`,
    );
    // Both picks read back as their own removable chip.
    // The active-filter chips say what tapping them DOES, and name their facet:
    // the label set is org-wide, so a label called `Urgent` would otherwise answer
    // to exactly the name the priority chip beside it does.
    const chips = await admin
      .getByRole('button', { name: /^Remove the (Urgent|High) priority filter$/ })
      .count();
    check('each chosen priority is its own chip', chips === 2, `${chips} chips`);

    await admin.getByRole('button', { name: 'Clear all filters' }).click();
    await admin.waitForTimeout(600);
    // 'None' is a VALUE — cards with no priority set — not the absence of a
    // filter, so it must narrow like any other, and must EXCLUDE the two cards
    // just given one.
    await pickInFilters('Priority', priorityChip('None'));
    const none = await resultCount();
    check(
      'None narrows to cards with no priority',
      none > 0 && none === total - urgentOrHigh,
      `${none} with no priority, ${total} in all, ${urgentOrHigh} prioritised`,
    );
    await admin.getByRole('button', { name: 'Clear all filters' }).click();
    await admin.waitForTimeout(600);
  }

  // ---- Two clear controls, two names --------------------------------------
  // With something active, BOTH exist: the screen's `filter-alt-off` icon and
  // the sheet's own button, because the screen's is behind the modal and a
  // sheet you can filter from but not un-filter from is a trap. They must not
  // answer to ONE name — a screen reader would read the same name for two
  // controls, and `getByRole(…, { name })` would resolve to whichever came
  // first instead of failing honestly.
  {
    await pickInFilters('Priority', priorityChip('Urgent'));
    await admin.getByRole('button', { name: 'Filters', exact: true }).click();
    const collided = await admin.getByRole('button', { name: 'Clear all filters' }).count();
    check('the sheet does not duplicate the screen’s clear-filters name', collided === 1, `${collided} controls`);
    // And it clears, which is the only reason it is in there.
    await admin.getByRole('button', { name: 'Clear all', exact: true }).click();
    await admin.waitForTimeout(500);
    await admin.getByRole('button', { name: 'Done', exact: true }).click();
    await admin.waitForTimeout(700);
    check(
      'clearing from inside the sheet removes the chips outside it',
      !(await admin
        .getByRole('button', { name: 'Remove the Urgent priority filter' })
        .isVisible()
        .catch(() => false)),
    );
  }

  // ---- Assigned to --------------------------------------------------------
  // The filter has existed in @sabeel/shared since Phase 11 and had no control.
  // The people offered come from the BOARDS' member profiles, not `users/*`,
  // which only admins may list.
  {
    await admin.getByRole('button', { name: 'Filters', exact: true }).click();
    await admin.getByRole('button', { name: sectionHeader('Assigned to') }).first().click();
    const anyone = await admin
      .getByRole('button', { name: 'Filter to Anyone' })
      .isVisible()
      .catch(() => false);
    check('the assignee section offers a way back to everyone', anyone);
    // Narrowing the list by typing is what makes it usable on a big board.
    await admin.getByPlaceholder('Filter people').fill('zzz-nobody');
    const noMatch = await admin
      .getByText('Nothing matches.')
      .isVisible()
      .catch(() => false);
    check('typing narrows the people list, and says when nothing matches', noMatch);
    await admin.getByRole('button', { name: 'Done', exact: true }).click();
    await admin.waitForTimeout(400);
  }

  // ---- Sorting by last activity -------------------------------------------
  // Newest and oldest must be exact reverses of each other over the same set.
  {
    const titles = async () => {
      const ids = await admin.locator('[data-testid^="card-"]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid')),
      );
      return ids;
    };
    // On web `Select` is a real <select> (Select.web.tsx), so this is
    // selectOption rather than two clicks — and its accessible name is the
    // control's label, not the current value.
    const sort = admin.getByLabel('Sort');
    await sort.selectOption('newest');
    await admin.waitForTimeout(700);
    const newest = await titles();
    await sort.selectOption('oldest');
    await admin.waitForTimeout(700);
    const oldest = await titles();
    check(
      'oldest-first is the exact reverse of newest-first',
      newest.length > 1 && JSON.stringify(newest) === JSON.stringify([...oldest].reverse()),
      `${newest.length} cards`,
    );

    // Clearing FILTERS must not reorder the list. `hasActiveFilters` — the one
    // condition the clear control appears on — deliberately ignores the sort,
    // because reordering a list is not narrowing it; a clear that also put the
    // order back would be doing something its name does not say, from a control
    // that appeared for another reason entirely.
    await pickInFilters('Priority', priorityChip('Urgent'));
    await admin.getByRole('button', { name: 'Clear all filters' }).click();
    await admin.waitForTimeout(700);
    check(
      'clearing the filters leaves the chosen order alone',
      (await sort.inputValue()) === 'oldest',
      `sort is ${await sort.inputValue()}`,
    );

    // Back to the default, so nothing after this inherits an order.
    await sort.selectOption('best');
    await admin.waitForTimeout(500);
  }

  // ---- The label set is not scoped to a board -----------------------------
  // The whole claim of global labels, and the only way to prove it is a board
  // that has never been near the labels: a brand-new one, whose settings are
  // never opened, must offer the labels made on the first board.
  await backToBoards(admin);
  await admin.getByRole('button', { name: 'New board' }).click();
  await admin.getByPlaceholder('Board name').fill('Second Board');
  // Same control names the board and card sections above already prove work:
  // "Create" exactly, and Enter to submit a card title (the fill-then-click
  // route leaves the component's state empty — see the note at card creation).
  await admin.getByRole('button', { name: 'Create', exact: true }).click();
  await admin.getByText('Second Board').first().waitFor({ timeout: 20000 });
  await admin.getByRole('button', { name: '+ Add card' }).first().click();
  const secondTitle = admin.getByPlaceholder('Card title');
  await secondTitle.waitFor({ timeout: 10000 });
  await secondTitle.click();
  await secondTitle.pressSequentially('Elsewhere entirely', { delay: 10 });
  await secondTitle.press('Enter');
  await admin.getByText('Elsewhere entirely').waitFor({ timeout: 20000 });
  // The helper, not a bare text click: a live board re-renders as snapshots
  // arrive and a plain click loses the stability check.
  await openCard(admin, 'Elsewhere entirely');

  const offeredHere = await admin
    .getByRole('button', { name: 'Label cross-board' })
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('a label made on one board is offered on a different board', offeredHere);
  check(
    'and so is the renamed one, under its new name',
    await admin
      .getByRole('button', { name: 'Label urgent-fix' })
      .isVisible()
      .catch(() => false),
  );

  await backToBoards(admin);

  // ---- Domain enforcement, from a real client -----------------------------
  // Sara's session is finished with — close it so this last context is not
  // competing with three live Firestore sessions for the dev server.
  await saraCtx.close();
  pages.delete('sara');

  const { ctx: badCtx, page: bad } = await newApp(browser);
  // Give it room to boot before interacting: a click that races the first render
  // reads as a mystery failure rather than a slow start.
  await bad.getByText('Sign in with Google').waitFor({ timeout: 40000 });
  const intruderButton = bad.getByRole('button', { name: 'intruder@gmail.com' });
  await intruderButton.waitFor({ timeout: 30000 });
  await intruderButton.click();

  // Two outcomes are both CORRECT here, and which one you get is a race with the
  // trigger:
  //
  //  - the client keeps a valid ID token, so the app is not signed out and must
  //    explain itself — after a grace period it shows "Wrong account";
  //  - or onUserCreate deletes the account before signInWithCredential finishes,
  //    the sign-in itself fails, and the user is left on the sign-in screen.
  //
  // Asserting only the first made this abort intermittently, which is worse than
  // a missing assertion: a suite that fails for a known-benign reason teaches
  // everyone to re-run it, and the next real failure gets waved through too.
  const rejected = await Promise.race([
    bad
      .getByText('Wrong account')
      .waitFor({ timeout: 40000 })
      .then(() => 'explained')
      .catch(() => null),
    bad
      .getByText('Sign in with Google')
      .waitFor({ timeout: 40000 })
      .then(() => 'signed out')
      .catch(() => null),
  ]);
  check(
    'a non-org account is rejected server-side and never gets in',
    rejected !== null,
    rejected ?? 'neither outcome appeared',
  );

  const reachedAGate = await bad
    .getByText('Waiting for approval')
    .isVisible()
    .catch(() => false);
  check('a rejected account never reaches the approval queue', !reachedAGate);
  await bad.screenshot({ path: join(SHOTS, 'p1-wrong-domain-light.png'), fullPage: true });

  // ---- An existing account meets the rules once, wherever it was going -----
  // Every account made before the rules screen has no acceptance on its user
  // document, which is how the release will find them. Sara's is taken away
  // here to match, and she then follows a link to a card on her board: the
  // rules come first with the card nowhere on screen, the card opens behind
  // "I agree", and signing out and in does not bring the rules back.
  const target = await adminJson(`
    const u = (await db.collection('users').where('email', '==', 'sara@oursabeel.com').get()).docs[0];
    await u.ref.update({ rulesVersion: FieldValue.delete(), rulesAcceptedAt: FieldValue.delete() });
    const boards = await db.collection('boards').where('memberUids', 'array-contains', u.id).get();
    let card = null;
    for (const b of boards.docs) {
      if (b.data().archived) continue;
      const c = await db.collection('cards').where('boardId', '==', b.id).where('archived', '==', false).limit(1).get();
      if (!c.empty) { card = { id: c.docs[0].id, title: c.docs[0].data().title }; break; }
    }
    console.log(JSON.stringify({ uid: u.id, card }));
  `);
  if (!target.card) throw new Error('Sara is on no board with a live card to link to');
  {
    const { ctx, page } = await newApp(browser, 'light', `c/${target.card.id}`);
    pages.set('linked', page);
    await page.getByRole('button', { name: 'sara', exact: true }).click();
    await page.getByText(RULES_TITLE, { exact: true }).waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: 'I agree', exact: true }).waitFor({ timeout: 10000 });
    const early = {
      card: await page.getByRole('button', { name: 'Share card' }).isVisible().catch(() => false),
      composer: await commentEditor(page).isVisible().catch(() => false),
      nav: await page.getByRole('button', { name: 'More' }).isVisible().catch(() => false),
    };
    check(
      'an existing account sees the rules once, before the card its link names',
      !early.card && !early.composer && !early.nav,
      JSON.stringify(early),
    );
    await page.getByRole('button', { name: 'I agree', exact: true }).click();
    const opened = await page
      .getByRole('button', { name: 'Share card' })
      .waitFor({ timeout: 30000 })
      .then(() => true, () => false);
    check('and the card opens once she agrees', opened && (await page.getByText(target.card.title).first().isVisible()));
    const accepted = await adminJson(`
      const d = (await db.doc('users/${target.uid}').get()).data();
      console.log(JSON.stringify({ v: d.rulesVersion, at: typeof d.rulesAcceptedAt?.toMillis }));
    `);
    check('her acceptance is recorded by the server, with its version and time', accepted.v === 1 && accepted.at === 'function', JSON.stringify(accepted));

    // ---- Report a problem -------------------------------------------------
    await openReport(page);
    const field = page.getByLabel(REPORT_FIELD);
    const send = page.getByRole('button', { name: 'Send', exact: true });
    check('Report a problem is one field, capped at the limit', (await field.getAttribute('maxlength')) === String(REPORT_TEXT_MAX));
    check('with nothing written, Send is off', (await send.getAttribute('aria-disabled')) === 'true');
    const REPORT_TEXT = `The last comment on "${target.card.title}" calls Omar names.\nPlease take it down.`;
    await field.fill(REPORT_TEXT);
    await page.screenshot({ path: join(SHOTS, 'p13-report-light.png'), fullPage: true });
    // Back, and back again: an unsent report is not lost.
    await page.getByRole('button', { name: 'Back' }).first().click();
    await page.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 20000 });
    await openReport(page);
    check('an unsent report survives Back', (await page.getByLabel(REPORT_FIELD).inputValue()) === REPORT_TEXT);
    await send.click();
    const sent = await page.getByText(REPORT_SENT).waitFor({ timeout: 30000 }).then(() => true, () => false);
    check('Send says it went, and when to expect an answer', sent);
    check('and the field clears', (await field.inputValue()) === '');
    await page.screenshot({ path: join(SHOTS, 'p13-report-sent-light.png'), fullPage: true });
    const stored = await adminJson(`
      const r = await db.collection('reports').where('uid', '==', '${target.uid}').get();
      console.log(JSON.stringify(r.docs.map((d) => d.data())));
    `);
    const r0 = stored[0] ?? {};
    check(
      'exactly one report is kept, with who sent it, what they wrote, and where from',
      stored.length === 1 &&
        r0.text === REPORT_TEXT &&
        r0.email === 'sara@oursabeel.com' &&
        r0.role === 'member' &&
        r0.platform === 'web' &&
        /^\d+\.\d+\.\d+ \(/.test(r0.appVersion ?? '') &&
        r0.mail?.status === 'skipped',
      JSON.stringify(stored).slice(0, 200),
    );

    // Signed out and in again: straight to the app, no rules.
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'sara', exact: true }).click();
    await page.getByRole('button', { name: 'More' }).waitFor({ timeout: 40000 });
    check(
      'after signing out and in, the rules do not come back',
      !(await page.getByText(RULES_TITLE, { exact: true }).isVisible().catch(() => false)),
    );
    await ctx.close();
    pages.delete('linked');
  }

  // ---- The email door: one address, a member (Faisal, 2026-10-15) ----------
  // "should only accept that one email" and "Just a member", and "The sign in
  // page shouldn't indicate its a special thing for a reviewer". Both accounts
  // are made the way an admin makes one, through the Admin SDK — no blocking
  // function runs for that — and approved as members. The one address may sign
  // in; the other is refused at the door, and says so exactly like a wrong
  // password. The one address is given ORGANIZER claims, which only the Admin
  // SDK can do (setUserAccess refuses it), so "no New board" below is the
  // member lock holding and not merely what its claims say.
  const DOOR_PASSWORD = 'correct-horse-battery-staple';
  await adminRun(`
    const make = async (email, role) => {
      const u = await auth.createUser({ email, password: ${JSON.stringify(DOOR_PASSWORD)}, emailVerified: true, displayName: email.split('@')[0] });
      for (let i = 0; i < 80 && !(await db.doc('users/' + u.uid).get()).exists; i++) await new Promise((r) => setTimeout(r, 250));
      await auth.setCustomUserClaims(u.uid, { role, status: 'active' });
      await db.doc('users/' + u.uid).update({ role, status: 'active' });
    };
    await make(${JSON.stringify(PASSWORD_SIGN_IN_EMAIL)}, 'organizer');
    await make('door-other@oursabeel.com', 'member');
  `);

  const doorTry = async (email, password) => {
    const { ctx, page } = await newApp(browser);
    await page.getByText('Sign in with Google').waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    return { ctx, page };
  };
  const NO_MATCH = 'That email and password do not match an account.';

  {
    const { ctx, page } = await newApp(browser);
    await page.getByText('Sign in with Google').waitFor({ timeout: 40000 });
    const said = await page.locator('body').innerText();
    check('the sign-in page offers a plain email sign-in', await page.getByRole('button', { name: 'Sign in with email' }).isVisible());
    check('and nothing on it speaks of reviewers', !/review/i.test(said), said.match(/.{0,30}review.{0,30}/i)?.[0] ?? '');
    await ctx.close();
  }
  {
    const { ctx, page } = await doorTry('door-other@oursabeel.com', DOOR_PASSWORD);
    const refused = await page.getByText(NO_MATCH).waitFor({ timeout: 30000 }).then(() => true, () => false);
    check('a password account at any other address is refused, in the words of a wrong password', refused);
    await ctx.close();
  }
  {
    const { ctx, page } = await doorTry(PASSWORD_SIGN_IN_EMAIL, 'not-the-password');
    const refused = await page.getByText(NO_MATCH).waitFor({ timeout: 30000 }).then(() => true, () => false);
    check('the one address with a wrong password is refused the same way', refused);
    await ctx.close();
  }
  {
    // By keyboard alone, as on a phone, where the keyboard covers Sign in:
    // the address field has focus on opening, Return moves to the password,
    // and Return there signs in.
    const { ctx, page } = await newApp(browser);
    await page.getByText('Sign in with Google').waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: 'Sign in with email' }).click();
    const emailField = page.getByPlaceholder('Email');
    const passwordField = page.getByPlaceholder('Password');
    await passwordField.waitFor({ timeout: 20000 });
    const hints = `${await emailField.getAttribute('enterkeyhint')} / ${await passwordField.getAttribute('enterkeyhint')}`;
    check('the address field offers Next and the password Go', hints === 'next / go', hints);
    const focused = (field) => field.evaluate((el) => el === document.activeElement);
    check('the address field has focus on opening', await focused(emailField));
    await page.keyboard.type(PASSWORD_SIGN_IN_EMAIL);
    await page.keyboard.press('Enter');
    check('Return in the address field moves to the password', await focused(passwordField));
    await page.keyboard.type(DOOR_PASSWORD);
    await page.keyboard.press('Enter');
    // A new account, so the rules first, as for anyone.
    await agreeToRules(page);
    // Read off the LOADED Boards screen: its empty state, which is drawn in the
    // same render as New board and from the same session, and words itself by
    // role. Not the word "Boards" — the nav rail says it while the screen is
    // still a spinner, and a New board check there passes for an organizer too.
    const MEMBER_EMPTY = 'You are not on any boards yet.';
    const settled = await page
      .getByText(/^(No boards yet\.|You are not on any boards yet\.)/)
      .waitFor({ timeout: 40000 })
      .then(() => true, () => false);
    check(
      'the one address signs in with its password, Return in the password submitting',
      settled && !(await page.getByText('Sign in with Google').isVisible().catch(() => false)),
    );
    const asMember = await page.getByText(MEMBER_EMPTY, { exact: false }).isVisible().catch(() => false);
    const canCreate = await page.getByRole('button', { name: 'New board' }).isVisible().catch(() => false);
    check('and is a member whatever its claims say: no New board', settled && asMember && !canCreate);
    await page.screenshot({ path: join(SHOTS, 'p1-email-door-member.png'), fullPage: true });

    // The review account may report, as the member it is.
    await openReport(page);
    await page.getByLabel(REPORT_FIELD).fill('Checking that a report reaches the institute.');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const reviewerSent = await page.getByText(REPORT_SENT).waitFor({ timeout: 30000 }).then(() => true, () => false);
    const reviewerReports = await adminJson(`
      const r = await db.collection('reports').where('email', '==', ${JSON.stringify(PASSWORD_SIGN_IN_EMAIL)}).get();
      console.log(JSON.stringify(r.docs.map((d) => d.data().role)));
    `);
    check(
      'the review account can report, and is recorded as a member',
      reviewerSent && reviewerReports.length === 1 && reviewerReports[0] === 'member',
      JSON.stringify(reviewerReports),
    );
    await ctx.close();
  }

  // ---- Archived boards can be found and restored (Phase 2) ---------------
  // Archiving is the SAFE alternative to deleting, so it must be reversible.
  // It was not: the board list filters archived boards out and Restore lives
  // inside board settings, reachable only from the board itself.
  await backToBoards(admin);
  await admin.getByText('Fundraising 2026').first().click();
  await admin.getByText('To Do').first().waitFor({ timeout: 25000 });
  await admin.getByRole('button', { name: 'Board settings' }).click();
  await admin.getByText('Board settings').first().waitFor({ timeout: 20000 });
  await admin.getByRole('button', { name: 'Archive board' }).click();
  await admin.getByRole('button', { name: 'New board' }).waitFor({ timeout: 25000 });
  await admin.waitForTimeout(1500);

  const archivedChip = admin.getByRole('button', { name: /^Archived \(/ });
  check(
    'an archived board leaves the active list and appears under Archived',
    await archivedChip.isVisible().catch(() => false),
  );

  await archivedChip.click();
  await admin.waitForTimeout(800);
  check(
    'the archived board is reachable again',
    await admin.getByText('Fundraising 2026').first().isVisible().catch(() => false),
  );

  await admin.getByText('Fundraising 2026').first().click();
  await admin.getByText('To Do').first().waitFor({ timeout: 25000 });
  await admin.getByRole('button', { name: 'Board settings' }).click();
  await admin.getByRole('button', { name: 'Restore board' }).click();
  await admin.waitForTimeout(2000);
  await admin.getByRole('button', { name: 'Back' }).first().click();
  await admin.getByText('To Do').first().waitFor({ timeout: 25000 });
  await backToBoards(admin);
  await admin.waitForTimeout(1200);
  check(
    'restoring returns it to the active list and hides the Archived section',
    !(await archivedChip.isVisible().catch(() => false)),
  );

  // Attachments have their own focused suite, so a stale check in the long
  // access/board flow above cannot block them:
  //   bash scripts/e2e.sh scripts/attachments-e2e.mjs

  // ---- Stats --------------------------------------------------------------
  // The admin has spent this whole run creating boards, cards and comments, so
  // the counters must have something in them. That is the real assertion: not
  // "the screen renders" but "the triggers actually counted the work this
  // script just did".
  await backToBoards(admin);
  await admin.getByRole('button', { name: 'More' }).click();
  await admin.getByRole('button', { name: 'Stats' }).click();
  await admin.getByText('Stats', { exact: true }).first().waitFor({ timeout: 20000 });

  // A bar's accessible label carries its value, which is also how a screen
  // reader gets anything at all out of a chart. Match a NON-ZERO one: most
  // columns in a sixty-day window are legitimately empty, so `.first()` finds a
  // quiet day and proves nothing.
  const bar = admin.getByLabel(/^[1-9]\d* cards created, /).first();
  await bar.waitFor({ timeout: 20000 });
  const barLabel = (await bar.getAttribute('aria-label')) ?? '';
  check(
    'stats counted the cards this run created',
    /^[1-9]\d* cards created, /.test(barLabel),
    barLabel.slice(0, 60),
  );

  // Tapping a bar reads it out. This is what lets the per-bar numbers disappear
  // when bars get thin, so it has to actually work.
  await bar.click();
  await admin.waitForTimeout(300);
  const readout = await admin
    .getByText(/^\d+ cards created · /)
    .first()
    .isVisible()
    .catch(() => false);
  check('tapping a bar shows its exact figure', readout);

  // Period is a segmented icon control, not chips — each segment is a radio
  // carrying the word its icon replaces.
  for (const mode of ['Weekly', 'Monthly', 'Daily']) {
    await admin.getByRole('radio', { name: mode, exact: true }).click();
    await admin.waitForTimeout(250);
  }
  check('bucketing switches without reloading', true);

  await admin.getByRole('button', { name: 'Comments filter, off' }).click();
  await admin.waitForTimeout(250);
  check(
    'switching metric redraws the chart',
    await admin
      .getByLabel(/^[1-9]\d* comments, /)
      .first()
      .isVisible()
      .catch(() => false),
  );

  // The board filter must offer the boards this run made, and narrow to one.
  await admin.getByRole('button', { name: /^Board filter/ }).click();
  await admin.getByRole('button', { name: 'Fundraising 2026' }).click();
  await admin.waitForTimeout(600);
  check(
    'stats can be narrowed to a single board',
    await admin
      .getByRole('button', { name: /^Board filter, currently Fundraising 2026/ })
      .isVisible()
      .catch(() => false),
  );
  await admin.screenshot({ path: join(SHOTS, 'p12-stats-light.png'), fullPage: true });

  // ---- Dark mode ----------------------------------------------------------
  // Re-emulate the colour scheme on the page we already have, rather than
  // opening a fourth context and signing in again. The theme follows the OS
  // signal, so this exercises exactly the same code path — and avoids four
  // concurrent sessions competing for the dev server.
  await backToBoards(admin);
  await admin.emulateMedia({ colorScheme: 'dark' });
  await admin.waitForTimeout(600);
  await admin.screenshot({ path: join(SHOTS, 'p2-boards-dark.png'), fullPage: true });

  await admin.getByText('Fundraising 2026').first().click();
  await admin.getByText('To Do', { exact: false }).first().waitFor({ timeout: 20000 });
  await admin.screenshot({ path: join(SHOTS, 'p2-board-dark.png'), fullPage: true });
  check('dark theme renders the board flows', true);

  await admin.emulateMedia({ colorScheme: 'light' });

  // ---- Production-safety: the dev sign-in must NOT survive an export --------
  // `expo export` sets __DEV__ false, which is one of the two conditions gating
  // the emulator sign-in. Asserting it here means the safety property is tested
  // rather than assumed, every run — this is the row that must never reach a
  // release APK or Hosting.
  const prodCtx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const prod = await prodCtx.newPage();
  await prod.goto(`http://127.0.0.1:${PROD_PORT}/`, { waitUntil: 'networkidle' });
  await prod.getByText('Sign in with Google').waitFor({ timeout: 20000 });
  const devRowInProd = await prod
    .getByText('Dev sign-in (emulator only)')
    .isVisible()
    .catch(() => false);
  check('exported production bundle has NO dev sign-in row', !devRowInProd);
  await prod.screenshot({ path: join(SHOTS, 'p1-signin-production.png'), fullPage: true });
  await prodCtx.close();

  await adminCtx.close();
  await badCtx.close();
} catch (e) {
  console.error('\nE2E aborted:', e instanceof Error ? e.message : String(e));
  await dumpAll();
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error('FAILED:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
