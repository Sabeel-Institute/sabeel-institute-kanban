/**
 * A board's colour in the Boards list, picked from its stripe.
 *
 *   bash scripts/e2e.sh scripts/board-colours-e2e.mjs
 *
 * A focused suite: an owner clicks a board's stripe on a computer and picks
 * from the popover beside it; the stripe takes the colour and keeps it after
 * a reload; Escape and a click elsewhere close the popover without a change;
 * a clone starts in its source's colour; on a phone-width screen the stripe
 * opens a dialog, and No colour takes the colour off; a member who does not
 * own the board sees the stripe and has nothing to press; an archived board
 * keeps its stripe and offers no way to change it.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { PORTS, PROJECT } from './lib/emulators.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { agreeToRules } from './lib/rules.mjs';

const tally = tryAgainTally();
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORTS.web}/`;
process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

const grantAdmin = (email) =>
  new Promise((res, rej) => {
    const c = spawn('node', [resolve(import.meta.dirname, 'grant-admin.mjs'), email], {
      env: { ...process.env },
      stdio: 'pipe',
    });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`grant-admin exited ${code}`))));
  });

/** Fill a controlled field and act, again if a snapshot wiped it: see lanes-e2e.mjs. */
async function fillThen(page, locator, value, act) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await locator.fill(value);
    try {
      await act({ timeout: 4000 });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`would not accept ${JSON.stringify(value)}`);
}

const BOARD = 'Colour board';
const CLONE = 'Colour board copy';
// The theme's blue (palette.ts `boardBlue`), as a browser reports it.
const BLUE = 'rgb(62, 107, 138)';
const VIOLET = 'rgb(107, 76, 138)';

initializeApp({ projectId: PROJECT });
const db = getFirestore();

const stripeButton = (page, board) => page.getByRole('button', { name: new RegExp(`^Colour of ${board}: `) });
const stripeLabel = (page, board) => stripeButton(page, board).first().getAttribute('aria-label');
const stripeInk = (page, board) =>
  page
    .getByTestId(`stripe:${board}`)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
/** Wait until a condition holds, polling: a write's echo lands a moment later. */
async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}
const storedColour = async () =>
  (await db.collection('boards').where('name', '==', BOARD).get()).docs[0]?.get('color');

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page error', false, String(e).slice(0, 120)));
  page.on('dialog', (d) => void d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'faisal', exact: true }).click();
  tally.note('faisal', await settle(page, page.getByText('Waiting for approval')));
  await grantAdmin('faisal@oursabeel.com');
  await agreeToRules(page);
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 30000 });

  const boards = async (p = page) => {
    await p.getByRole('button', { name: 'Boards', exact: true }).first().click();
    await p.getByRole('button', { name: 'New board' }).waitFor({ timeout: 20000 });
  };

  await page.getByRole('button', { name: 'New board' }).click();
  await fillThen(page, page.getByPlaceholder('Board name'), BOARD, (o) =>
    page.getByRole('button', { name: 'Create', exact: true }).click(o),
  );
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  await boards();
  await stripeButton(page, BOARD).first().waitFor({ timeout: 20000 });
  check('an owner’s uncoloured board offers its stripe', (await stripeLabel(page, BOARD)) === `Colour of ${BOARD}: none`);

  // ---- On a computer: the popover beside the stripe ------------------------------
  await stripeButton(page, BOARD).first().click();
  const popover = page.getByRole('dialog', { name: `Colour of ${BOARD}` });
  await popover.waitFor({ timeout: 10000 });
  const [stripeBox, popBox] = [await stripeButton(page, BOARD).first().boundingBox(), await popover.boundingBox()];
  // The stripe runs the card's full height, so clear of the stripe is clear
  // of the card: the board's name stays in sight while it is coloured.
  const clearOfCard = popBox.y >= stripeBox.y + stripeBox.height - 1 || popBox.y + popBox.height <= stripeBox.y + 1;
  check(
    'a click on the stripe opens a popover at the card, not over it, and not a dialog over the page',
    clearOfCard && Math.abs(popBox.x - stripeBox.x) < 20 &&
      (await page.getByRole('button', { name: 'Close', exact: true }).count()) === 0,
    JSON.stringify({ stripeBox, popBox }),
  );
  await popover.getByRole('button', { name: 'Blue', exact: true }).click();
  check('picking closes it', await until(async () => (await popover.count()) === 0));
  check(
    'and the stripe takes the colour',
    await until(async () => (await stripeLabel(page, BOARD)) === `Colour of ${BOARD}: Blue` && (await stripeInk(page, BOARD)) === BLUE),
    `${await stripeLabel(page, BOARD)} ${await stripeInk(page, BOARD)}`,
  );
  check('stored by its key', await until(async () => (await storedColour()) === 'blue'), String(await storedColour()));
  await page.reload({ waitUntil: 'load' });
  await stripeButton(page, BOARD).first().waitFor({ timeout: 30000 });
  check('and kept after a reload', (await stripeLabel(page, BOARD)) === `Colour of ${BOARD}: Blue`);

  await stripeButton(page, BOARD).first().click();
  await popover.waitFor({ timeout: 10000 });
  // Opened on Blue, the third of nine stops (eight colours and No colour):
  // twelve Tabs go round once and land on the sixth, Red. Focus that stuck,
  // or left, would be on something else.
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  const focusedName = await popover.evaluate((el) =>
    el.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null,
  );
  check('Tab goes round the colours and stays in the popover', focusedName === 'Red', String(focusedName));
  await page.keyboard.press('Escape');
  check('Escape closes the popover', await until(async () => (await popover.count()) === 0));
  await stripeButton(page, BOARD).first().click();
  await popover.waitFor({ timeout: 10000 });
  await page.getByText('Boards', { exact: true }).first().click();
  check('a click elsewhere closes it', await until(async () => (await popover.count()) === 0));
  check('and neither changes the colour', (await storedColour()) === 'blue', String(await storedColour()));

  // ---- The picker shows the board as it is now -----------------------------------
  // Someone else colours the board while the popover is open: it marks the
  // new colour, and picking the one it marked is no change at all.
  const boardRef = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0].ref;
  await stripeButton(page, BOARD).first().click();
  await popover.waitFor({ timeout: 10000 });
  await boardRef.update({ color: 'green' });
  check(
    'a colour picked elsewhere meanwhile is the one the open popover marks',
    await until(async () => (await popover.getByRole('button', { name: 'Green', exact: true }).getAttribute('aria-pressed')) === 'true'),
  );
  await popover.getByRole('button', { name: 'Blue', exact: true }).click();
  check('and picking from it still saves', await until(async () => (await storedColour()) === 'blue'), String(await storedColour()));

  // ---- Press and hold, and a right-click, are still Clone ------------------------
  await page.getByText(BOARD, { exact: true }).first().click({ button: 'right' });
  const cloneName = page.getByLabel('Name of the clone');
  check('a right-click on the card still offers Clone', await cloneName.waitFor({ timeout: 15000 }).then(() => true, () => false));
  await cloneName.fill(CLONE);
  await page.getByRole('button', { name: 'Clone', exact: true }).click();
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  await boards();
  check(
    'a clone starts in its source’s colour',
    await until(async () => (await stripeLabel(page, CLONE)) === `Colour of ${CLONE}: Blue`),
    String(await stripeLabel(page, CLONE).catch(() => 'no stripe')),
  );
  await stripeButton(page, CLONE).first().click({ button: 'right' });
  check(
    'a right-click on the stripe is the card’s right-click: Clone',
    await cloneName.waitFor({ timeout: 15000 }).then(() => true, () => false),
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // ---- A member who does not own it: the stripe, and nothing to press -------------
  const sCtx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const sara = await sCtx.newPage();
  sara.on('pageerror', (e) => check('no page error (sara)', false, String(e).slice(0, 120)));
  await sara.goto(BASE, { waitUntil: 'networkidle' });
  await sara.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await sara.getByRole('button', { name: 'sara', exact: true }).click();
  tally.note('sara', await settle(sara, sara.getByText('Waiting for approval')));
  const saraUid = (await getAuth().getUserByEmail('sara@oursabeel.com')).uid;
  await getAuth().setCustomUserClaims(saraUid, { role: 'member', status: 'active' });
  await db.doc(`users/${saraUid}`).set(
    { role: 'member', status: 'active', claimsUpdatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  const boardDoc = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0];
  // Membership is the server's to write; the Admin SDK stands in for the callable.
  await boardDoc.ref.update({
    memberUids: FieldValue.arrayUnion(saraUid),
    [`memberProfiles.${saraUid}`]: { displayName: 'Sara', email: 'sara@oursabeel.com' },
  });
  await agreeToRules(sara);
  await sara.getByText(BOARD, { exact: true }).first().waitFor({ timeout: 30000 });
  check(
    'a member who does not own the board sees its colour',
    await until(async () => (await stripeInk(sara, BOARD)) === BLUE),
    String(await stripeInk(sara, BOARD).catch(() => 'no stripe')),
  );
  check('and has no stripe to press', (await stripeButton(sara, BOARD).count()) === 0);
  await sCtx.close();

  // ---- A refused write is said on the board's own card ------------------------------
  // A board stored in a shape the rules refuse on every update (thirteen
  // lanes, one past LANES_MAX) stands in for any refusal: the write goes, the
  // rules say no, and the card must say so where the person is looking.
  const lanes = Array.from({ length: 13 }, (_, i) => ({ id: `ln${i}`, name: `Lane ${i}` }));
  await boardDoc.ref.update({ lanes });
  await stripeButton(page, BOARD).first().click();
  await popover.waitFor({ timeout: 10000 });
  await popover.getByRole('button', { name: 'Red', exact: true }).click();
  const refused = page.getByText(/^That was not allowed\./).first();
  const shown = await refused.waitFor({ timeout: 20000 }).then(() => true, () => false);
  await page.screenshot({ path: 'shots/board-colours-refused.png' }).catch(() => {});
  const [said, card] = [await refused.boundingBox().catch(() => null), await stripeButton(page, BOARD).first().boundingBox()];
  check(
    'a refused colour is said on the board’s own card, in sight',
    shown && said && card && said.y >= card.y && said.y + said.height <= card.y + card.height + 1 &&
      said.y + said.height <= 950,
    JSON.stringify({ said, card }),
  );
  check(
    'and the stripe goes back to the colour it had',
    await until(async () => (await stripeLabel(page, BOARD)) === `Colour of ${BOARD}: Blue`),
    String(await stripeLabel(page, BOARD)),
  );
  check('and nothing is stored', (await storedColour()) === 'blue', String(await storedColour()));
  // Another board coloured after the refusal: its card says nothing, and the
  // refused board's message stays on that board alone.
  const clonePopover = page.getByRole('dialog', { name: `Colour of ${CLONE}` });
  await stripeButton(page, CLONE).first().click();
  await clonePopover.waitFor({ timeout: 10000 });
  await clonePopover.getByRole('button', { name: 'Violet', exact: true }).click();
  await until(async () => (await stripeLabel(page, CLONE)) === `Colour of ${CLONE}: Violet`);
  check(
    'a second board coloured meanwhile carries no message, and the refusal stays on its own board',
    (await refused.count()) === 1 &&
      (await page.getByRole('button', { name: 'Dismiss', exact: true }).count()) === 1,
  );
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  check('Dismiss takes the message away', await until(async () => (await refused.count()) === 0));
  await boardDoc.ref.update({ lanes: FieldValue.delete() });

  // ---- A phone-width screen: the stripe opens a dialog -----------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  const fingerWide = async () => ((await stripeButton(page, BOARD).first().boundingBox())?.width ?? 0) >= 44;
  check(
    'on a phone the stripe’s target is a finger wide',
    await until(fingerWide),
    JSON.stringify(await stripeButton(page, BOARD).first().boundingBox()),
  );
  await stripeButton(page, BOARD).first().click();
  const close = page.getByRole('button', { name: 'Close', exact: true });
  check('a tap opens the colours in a dialog', await close.waitFor({ timeout: 10000 }).then(() => true, () => false));
  check(
    'which says whose colour it is and marks the current one',
    (await page.getByText(`Colour of ${BOARD}`, { exact: true }).count()) > 0 &&
      (await page.getByRole('button', { name: 'Blue', exact: true }).getAttribute('aria-pressed')) === 'true',
  );
  await page.getByRole('button', { name: 'No colour', exact: true }).click();
  check('No colour takes it off', await until(async () => (await storedColour()) === undefined), String(await storedColour()));
  check('and the dialog closes', await until(async () => (await close.count()) === 0));
  check(
    'leaving the empty stripe an owner aims at',
    await until(async () => (await stripeLabel(page, BOARD)) === `Colour of ${BOARD}: none`),
  );

  // ---- Archived: the stripe stays, the control goes ---------------------------------
  await page.setViewportSize({ width: 1280, height: 950 });
  // Back in the wide layout: the stripe's target is a mouse's again.
  await until(async () => ((await stripeButton(page, CLONE).first().boundingBox())?.width ?? 99) < 44);
  // Archived from under an open popover (by someone else, here the Admin
  // SDK): the board leaves the list, and its popover goes with it.
  await stripeButton(page, CLONE).first().click();
  await clonePopover.waitFor({ timeout: 10000 });
  const cloneRef = (await db.collection('boards').where('name', '==', CLONE).get()).docs[0].ref;
  await cloneRef.update({ archived: true });
  check('a board archived from under its open popover closes it', await until(async () => (await clonePopover.count()) === 0));
  // And it stays closed when the board comes back: nobody asked for it again.
  // Restored, the board is listed (a positive signal) before the absence is read.
  await cloneRef.update({ archived: false });
  await stripeButton(page, CLONE).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  check('and stays closed when the board is restored', (await clonePopover.count()) === 0);
  await cloneRef.update({ archived: true });
  await until(async () => (await stripeButton(page, CLONE).count()) === 0);
  await page.getByRole('button', { name: /^Archived \(/ }).click();
  await page.getByText(CLONE, { exact: true }).first().waitFor({ timeout: 15000 });
  check(
    'an archived board keeps its colour',
    await until(async () => (await stripeInk(page, CLONE)) === VIOLET),
    String(await stripeInk(page, CLONE).catch(() => 'no stripe')),
  );
  check('and offers no way to change it', (await stripeButton(page, CLONE).count()) === 0);
  await ctx.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`  ${tally.summary()}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
process.exit(0);
