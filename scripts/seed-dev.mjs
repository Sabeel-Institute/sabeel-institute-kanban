// Seed the emulators with something worth looking at, by driving the UI.
//
// Deliberately NOT direct Firestore writes: going through the app exercises the
// same callables and rules a real user hits, so a seed that succeeds is also
// evidence the flow works. It also means the seed cannot drift from the schema.
//
// Usage: npm run seed  (emulators + `npm run dev:web` must already be running)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { PORTS } from './lib/emulators.mjs';
import { RULES_TITLE } from './lib/rules.mjs';

const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORTS.web}/`;

// Seed the shapes that BREAK layouts, not just tidy ones. Every phone-layout bug
// filmed so far needed one of these two and the seed had neither, so the board
// looked fine locally and wrong on a real board:
//
//   - a column name too long for the phone pager, which used to paint over the
//     "Previous column" arrow;
//   - a column with more cards than fit on one screen, which is what exposed a
//     content-sized list on web (last card clipped, "+ Add card" unreachable,
//     nothing scrolling).
const LONG_COLUMN = 'Fundraising Strategy & Community Outreach';
const COLUMNS = [LONG_COLUMN, 'Blocked', 'Review', 'Ready to ship', 'Waiting on donor', 'Parked'];
const CARDS = [
  'Book the venue',
  'Confirm the caterer',
  'Draft the donor letter',
  'Design the programme',
  'Chase outstanding pledges',
  'Brief the volunteers',
  'Confirm exact ask based on rental vs. property',
  'Set total dollar target for the fundraiser',
  'Approve suggested giving levels and what each enables',
  'Reserve the overflow parking',
  'Order the printed programmes',
  'Line up the sound system',
  'Write the thank-you letter template',
  'Reconcile the pledge spreadsheet',
];

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return page;
}

const browser = await chromium.launch();

/**
 * Did this account land on the approval gate, or is it already through?
 *
 * A first sign-in can stop on the app's "Still setting up your account" (a
 * profile write the emulator's listener missed; lib/signin.mjs), and is then
 * answered with the app's own Try again, as a person would.
 */
async function signIn(page, who) {
  await page.getByRole('button', { name: who, exact: true }).click();
  const gate = page.getByText('Waiting for approval');
  const through = page.getByText('Boards', { exact: true });
  const slow = page.getByText('Still setting up your account', { exact: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await gate.or(through).or(slow).first().waitFor({ timeout: 60000 }).catch(() => {});
    if (!(await slow.isVisible().catch(() => false))) break;
    console.log(`  ${who}: "Still setting up your account" — pressing the app's Try again`);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await slow.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  }
  return gate.isVisible().catch(() => false);
}

/**
 * Agree to the institute's rules if this account is being asked to.
 *
 * Every account sees the rules screen once, after approval. A re-run against a
 * seeded emulator finds them already accepted, so this waits for whichever
 * comes first, the rules or the app, and agrees only to the first. (The
 * browser suites use the strict `agreeToRules`; a seed has to be re-runnable.)
 */
async function agreeIfAsked(page) {
  const rules = page.getByText(RULES_TITLE, { exact: true });
  const app = page.getByRole('button', { name: 'More' });
  await Promise.race([
    rules.waitFor({ timeout: 40000 }).catch(() => {}),
    app.waitFor({ timeout: 40000 }).catch(() => {}),
  ]);
  if (await rules.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'I agree', exact: true }).click();
    await app.waitFor({ timeout: 40000 });
  }
}

// The first account has to be granted out of band — there is no admin yet to
// approve it. That is the same bootstrap a real deployment goes through.
//
// Every step below is skipped if it has already happened, so the seed can be
// re-run against an emulator that is partly populated (an interrupted run, or a
// session where you already signed in) without erroring or duplicating.
const admin = await open(browser);
if (await signIn(admin, 'faisal')) {
  execFileSync('bash', ['scripts/grant-admin.sh', 'faisal@oursabeel.com'], {
    stdio: 'inherit',
  });
}
await agreeIfAsked(admin);
await admin.getByRole('button', { name: 'New board' }).waitFor({ timeout: 40000 });

// Two colleagues sign in and wait, then get approved — and, their pages still
// open, agree to the rules the approval brings up.
const colleagues = [];
for (const who of ['sara', 'omar']) {
  const p = await open(browser);
  await signIn(p, who);
  colleagues.push(p);
}
// Section/account actions live in the app-wide nav now: People is inside the
// Account menu (bottom of the left rail on wide, where this seed runs).
await admin.getByRole('button', { name: 'More' }).click();
await admin.getByRole('button', { name: 'People' }).click();
// Wait for the QUEUE, not for the word "People".
//
// "People" is the Account-menu item AND the screen heading, so it is on screen
// before the user list has loaded. The loop below then sampled an empty list,
// broke on its first pass, and left every seeded run with two PENDING accounts
// and a one-person board — which is what every manual figure and every local
// hand-test has been showing since the People screen moved into the nav. The
// approve click itself was never broken; the wait in front of it was.
await admin
  .getByRole('button', { name: 'Approve' })
  .first()
  .waitFor({ timeout: 25000 })
  // A re-run against a seeded emulator has nobody left to approve.
  .catch(() => undefined);
for (;;) {
  const approve = admin.getByRole('button', { name: 'Approve' }).first();
  if (!(await approve.isVisible().catch(() => false))) break;
  await approve.click();
  await admin.waitForTimeout(1500);
}
await admin.getByRole('button', { name: 'Back' }).first().click();
for (const p of colleagues) await agreeIfAsked(p);

/**
 * Fill a field and act on it, re-filling if the value is wiped underneath us.
 *
 * These are controlled React inputs, and the previous write's Firestore snapshot
 * lands asynchronously. The sequence that fails: fill "Blocked", the snapshot
 * from the PREVIOUS column add arrives, React re-renders from state that does
 * not have the new text, the field goes empty, and the add button — which is
 * gated on the text — disables. The click then waits on a permanently disabled
 * control and times out 30s later pointing at the BUTTON, which reads as "the
 * button is broken".
 *
 * Checking the value once immediately after filling is NOT enough: that check
 * passes, and the wipe happens after it. So this retries the whole
 * fill-then-confirm-enabled cycle, which is robust whatever the cause.
 *
 * Used for every controlled input here — board name, column, label, card title.
 */
async function fillThen(page, placeholder, value, act) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.getByPlaceholder(placeholder).fill(value);
    try {
      await act({ timeout: 4000 });
      return;
    } catch {
      // Either the value was wiped or the control is still busy from the
      // previous write. Both are answered by filling again and retrying.
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`"${placeholder}" would not accept ${JSON.stringify(value)} — the field kept being cleared`);
}

// A board with MANY columns — the case that shows whether the layout holds up.
//
// Wait for the board LIST to actually render before deciding whether the board
// exists. Sampling it immediately reports "not found" while the live query is
// still in flight, so every re-run created another duplicate board — which is
// how five "Fundraising 2026" boards appeared in one session.
await admin.getByRole('button', { name: 'New board' }).waitFor({ timeout: 30000 });
await admin.waitForTimeout(2500);
const existing = admin.getByText('Fundraising 2026').first();
if (await existing.isVisible().catch(() => false)) {
  await existing.click();
} else {
  await admin.getByRole('button', { name: 'New board' }).click();
  await fillThen(admin, 'Board name', 'Fundraising 2026', (o) =>
    admin.getByRole('button', { name: 'Create', exact: true }).click(o),
  );
}
await admin.getByText('To Do').first().waitFor({ timeout: 30000 });

await admin.getByRole('button', { name: 'Board settings' }).click();
await admin.getByText('Board settings').waitFor({ timeout: 25000 });
for (const name of COLUMNS) {
  if (await admin.getByText(name).first().isVisible().catch(() => false)) continue;
  await fillThen(admin, 'New column name', name, (o) =>
    admin.getByRole('button', { name: 'Add column' }).click(o),
  );
  await admin.getByText(name).first().waitFor({ timeout: 25000 });
}
// Let the column writes settle: the settings controls disable while one is in
// flight, and firing the next click into a disabled button just times out.
await admin.waitForTimeout(2000);
for (const label of ['urgent', 'donor-facing']) {
  if (await admin.getByText(label).first().isVisible().catch(() => false)) continue;
  try {
    // Wait for the control to be ENABLED, not merely present. The settings
    // controls disable while a write is in flight, so the second label's click
    // landed on a disabled button and timed out — which is why every seeded
    // board had "urgent" and not "donor-facing", warned about it, and carried
    // on. Same trap as the column loop above, which is why that one has a
    // blanket sleep; waiting on the actual state is the better version.
    const add = admin.getByRole('button', { name: 'Add label' });
    await add.waitFor({ state: 'visible', timeout: 15000 });
    for (let i = 0; i < 30 && (await add.isDisabled().catch(() => false)); i += 1) {
      await admin.waitForTimeout(500);
    }
    await fillThen(admin, 'New label name', label, (o) => add.click(o));
    await admin.getByText(label).first().waitFor({ timeout: 25000 });
  } catch {
    // Labels are decoration for a dev seed; a board without them is still
    // worth testing, so this must not abort the run.
    console.warn(`could not seed label "${label}" — continuing`);
  }
}
// Everyone available gets added, so assignment and @mentions have real targets.
//
// Each candidate is one pressable row named "Add <person> to this board" — NOT a
// bare "Add" button, which is what this looked for until 2026-07-27. Since the
// member picker became an icon + rows, the loop found nothing, broke on its
// first pass and silently seeded a board with no members.
await admin
  .getByRole('button', { name: /^Add someone/ })
  .click()
  .catch(() => undefined);
for (;;) {
  const add = admin.getByRole('button', { name: /^Add .* to this board$/ }).first();
  if (!(await add.isVisible().catch(() => false))) break;
  await add.click();
  await admin.waitForTimeout(1200);
}
await admin.getByRole('button', { name: 'Back' }).first().click();
await admin.getByText('To Do').first().waitFor({ timeout: 30000 });

for (const title of CARDS) {
  if (await admin.getByText(title).first().isVisible().catch(() => false)) continue;
  await admin.getByRole('button', { name: '+ Add card' }).first().click();
  await fillThen(admin, 'Card title', title, async () => {
    await admin.keyboard.press('Enter');
    await admin.getByText(title).first().waitFor({ timeout: 4000 });
  });
  await admin.getByText(title).first().waitFor({ timeout: 25000 });
}

// One card carries an attachment, so the manual's card figure shows the
// Attachments section with something in it rather than an empty state.
try {
  await admin.getByText('Draft the donor letter').first().click();
  await admin.getByRole('button', { name: 'Attach a file' }).waitFor({ timeout: 25000 });
  const chooser = admin.waitForEvent('filechooser', { timeout: 20000 });
  await admin.getByRole('button', { name: 'Attach a file' }).click();
  await (await chooser).setFiles({
    name: 'donor-letter-draft.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% seeded for the manual\n%%EOF\n'),
  });
  // Picking a file opens the naming sheet — the document is the upload's
  // authorization and cannot be updated afterwards, so the name is chosen here
  // or not at all. Accept what the picker gave.
  const nameField = admin.getByPlaceholder('File name');
  await nameField.waitFor({ timeout: 20000 });
  await admin.getByRole('button', { name: 'Upload', exact: true }).click();
  await admin.getByText(/PDF ·/).waitFor({ timeout: 40000 });
  await admin.getByRole('button', { name: 'Back' }).first().click();
  await admin.getByText('To Do').first().waitFor({ timeout: 25000 });
} catch (e) {
  console.warn('could not seed an attachment — continuing:', String(e).slice(0, 120));
}

await browser.close();
console.log(`Seeded: 3 people, 1 board, ${COLUMNS.length + 3} columns, ${CARDS.length} cards.`);
console.log(`Open ${BASE} and use the dev sign-in row.`);
