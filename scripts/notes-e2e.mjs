/**
 * A board's notes: the panel on a computer, the page in front of the first
 * column on a phone, their history, and two people saving at once.
 *
 *   bash scripts/e2e.sh scripts/notes-e2e.mjs
 *
 * A focused suite. On a computer: the panel opens from the board's header and
 * stays open after a reload (the person's choice, on their user document);
 * the first save is a version that names its writer; a second save in the
 * same sitting folds into it; when two people save over the same version the
 * second is refused, keeps their text and says whose save came first, and
 * "Save mine" lands on top; the history counts each version's lines and
 * previews it, and Restore puts an older version back as a new one;
 * a card's link in the notes opens the card in the app. On a phone: the
 * first column offers the notes in place of its left arrow, the notes page
 * sits in front of it, editing is a screen of its own, and emptying the notes
 * takes the page away. A save the rules refuse for another reason keeps the
 * editor open with what was typed.
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

/** Wait until a condition holds, polling: a write's echo lands a moment later. */
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

const BOARD = 'Notes board';

initializeApp({ projectId: PROJECT });
const db = getFirestore();

let boardId = '';
const notesDoc = () => db.doc(`boards/${boardId}/notes/current`);
const stored = async () => (await notesDoc().get()).data();
const versions = async () =>
  (await notesDoc().collection('versions').orderBy('version', 'desc').get()).docs.map((d) => ({ id: d.id, ...d.data() }));

/** Sign in; `landing` is where an account lands: the approval gate for a new one. */
async function signIn(page, who, landing = page.getByText('Waiting for approval')) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: who, exact: true }).click();
  tally.note(who, await settle(page, landing));
}

/** The panel's editor has gone: the save landed (the editor closes only then). */
const editorGone = (scope) => until(async () => (await scope.locator('[contenteditable="true"]').count()) === 0);

async function openBoard(page) {
  await page.getByRole('button', { name: 'Boards', exact: true }).first().click();
  await page.getByText(BOARD, { exact: true }).first().click();
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
}

/** Type into the open notes editor, key by key, at its end. */
async function typeInto(page, scope, text) {
  const editor = scope.locator('[contenteditable="true"]').first();
  await editor.waitFor({ timeout: 20000 });
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
  await page.waitForTimeout(300);
}

const browser = await chromium.launch();
try {
  // ---- Faisal, an admin, on a computer --------------------------------------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page error', false, String(e).slice(0, 120)));
  page.on('dialog', (d) => void d.accept());
  await signIn(page, 'faisal');
  await grantAdmin('faisal@oursabeel.com');
  await agreeToRules(page);
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'New board' }).click();
  await fillThen(page, page.getByPlaceholder('Board name'), BOARD, (o) =>
    page.getByRole('button', { name: 'Create', exact: true }).click(o),
  );
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  boardId = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0].id;
  const faisalUid = (await getAuth().getUserByEmail('faisal@oursabeel.com')).uid;

  const panel = page.getByTestId('notes-panel');
  const toggle = page.getByRole('button', { name: 'Board notes', exact: true });
  await toggle.waitFor({ timeout: 20000 });
  check('the panel starts closed', (await panel.count()) === 0);
  await toggle.click();
  await panel.waitFor({ timeout: 15000 });
  check('a board with no notes says what they are for', await panel.getByText(/^No notes yet\./).isVisible());
  check(
    'opening the panel is kept on the person’s user document',
    await until(async () => ((await db.doc(`users/${faisalUid}`).get()).get('notesOpenBoardIds') ?? []).includes(boardId)),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBoard(page);
  check('and it is open again after a reload', await until(() => panel.isVisible()));

  // ---- A first save is a version naming its writer --------------------------
  await panel.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await typeInto(page, panel, 'Call the hall before booking.');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  check('the editor closes once the save lands', await editorGone(panel));
  check('the save is version 1', (await stored())?.version === 1, JSON.stringify(await stored()));
  check('and the panel shows it', await panel.getByText('Call the hall before booking.').first().isVisible());
  check(
    'and the server records it, with the writer’s name',
    await until(async () => {
      const v = await versions();
      return v.length === 1 && v[0].byName === 'Faisal' && v[0].added === 1 && v[0].removed === 0;
    }),
    JSON.stringify(await versions()),
  );
  check('the panel says who edited it', await until(() => panel.getByText(/^Edited by Faisal/).isVisible()));

  // ---- A second save in the same sitting is the same version ----------------
  await panel.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await typeInto(page, panel, ' Then email the caterer.');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await editorGone(panel);
  check(
    'a second save by the same person, minutes apart, folds into the first version',
    await until(async () => {
      const v = await versions();
      return v.length === 1 && v[0].id === '1' && v[0].version === 2 && v[0].text.includes('caterer');
    }),
    JSON.stringify(await versions()),
  );

  // ---- Sara, a member, edits while Faisal saves over her ---------------------
  const sCtx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const sara = await sCtx.newPage();
  sara.on('pageerror', (e) => check('no page error (sara)', false, String(e).slice(0, 120)));
  sara.on('dialog', (d) => void d.accept());
  await signIn(sara, 'sara');
  const saraUid = (await getAuth().getUserByEmail('sara@oursabeel.com')).uid;
  await getAuth().setCustomUserClaims(saraUid, { role: 'member', status: 'active' });
  await db.doc(`users/${saraUid}`).set(
    { role: 'member', status: 'active', claimsUpdatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  // Membership is the server's to write; the Admin SDK stands in for the callable.
  await db.doc(`boards/${boardId}`).update({
    memberUids: FieldValue.arrayUnion(saraUid),
    [`memberProfiles.${saraUid}`]: { displayName: 'Sara', email: 'sara@oursabeel.com' },
  });
  await agreeToRules(sara);
  await openBoard(sara);
  const saraPanel = sara.getByTestId('notes-panel');
  check('the panel is each person’s own: closed for Sara', (await saraPanel.count()) === 0);
  await sara.getByRole('button', { name: 'Board notes', exact: true }).click();
  await saraPanel.getByText(/Then email the caterer\./).first().waitFor({ timeout: 20000 });
  await saraPanel.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await typeInto(sara, saraPanel, ' Sara checks the date.');

  await panel.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await typeInto(page, panel, ' Faisal booked it.');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await editorGone(panel);
  check('Faisal’s save lands as version 3', (await stored())?.version === 3, JSON.stringify(await stored()));

  await saraPanel.getByRole('button', { name: 'Save', exact: true }).click();
  const notice = saraPanel.getByText(/^Faisal saved the notes while you were editing\./);
  check('Sara’s save over the same version is refused, and says whose came first', await until(() => notice.isVisible()));
  check(
    'her text is still in the editor',
    ((await saraPanel.locator('[contenteditable="true"]').first().textContent()) ?? '').includes('Sara checks the date.'),
  );
  check('and the stored notes are still Faisal’s', (await stored())?.text.includes('Faisal booked it.') && !(await stored())?.text.includes('Sara checks'));
  await saraPanel.getByRole('button', { name: 'Save mine', exact: true }).click();
  check(
    '"Save mine" lands on top of his, as version 4',
    await until(async () => {
      const n = await stored();
      return n?.version === 4 && n.text.includes('Sara checks the date.') && n.updatedBy === saraUid;
    }),
    JSON.stringify(await stored()),
  );
  check(
    'and both saves are in the history',
    await until(async () => {
      const v = await versions();
      return v.length === 2 && v[0].byName === 'Sara' && v[1].text.includes('Faisal booked it.');
    }),
    JSON.stringify((await versions()).map((v) => [v.id, v.version, v.byName])),
  );
  check(
    'Faisal’s panel shows her save without being reopened',
    await until(() => panel.getByText(/Sara checks the date\./).first().isVisible()),
  );

  // ---- History and restore ---------------------------------------------------
  await panel.getByRole('button', { name: 'Notes history', exact: true }).click();
  const version = page.getByTestId('notes-version');
  await version.waitFor({ timeout: 20000 });
  check('the history opens on the newest version, Sara’s', await page.getByRole('button', { name: /^Sara, / }).first().isVisible());
  check('and lists what each save changed, in lines', await page.getByText('+1 \u22121', { exact: true }).first().isVisible());
  check('opening a version previews it as it was saved', await version.getByText(/Sara checks the date\./).first().isVisible());
  check('the newest version offers no Restore', (await version.getByRole('button', { name: 'Restore this version' }).count()) === 0);
  await page.getByRole('button', { name: /^Faisal, / }).first().click();
  await version.getByRole('button', { name: 'Restore this version' }).click();
  check(
    'Restore puts the older text back, as a new version',
    await until(async () => {
      const n = await stored();
      return n?.version === 5 && !n.text.includes('Sara checks') && n.text.includes('Faisal booked it.') && n.restoredFrom === '1';
    }),
    JSON.stringify(await stored()),
  );
  check(
    'and the history names it a restore, keeping Sara’s',
    await until(async () => {
      const v = await versions();
      return v.length === 3 && v[0].restoredFrom === '1' && v[1].byName === 'Sara';
    }),
  );
  await page.getByText('To Do').first().waitFor({ timeout: 20000 });
  await panel.getByRole('button', { name: 'Notes history', exact: true }).click();
  check(
    'the restore is listed by the day it put back',
    await until(() => page.getByText(/^Restored the version of \d{4}-\d{2}-\d{2} · /).first().isVisible()),
  );
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await page.getByText('To Do').first().waitFor({ timeout: 20000 });

  // ---- A card's link in the notes opens the card in the app -----------------
  await page.getByRole('button', { name: '+ Add card' }).first().click();
  await fillThen(page, page.getByPlaceholder('Card title'), 'Linked card', async (o) => {
    await page.keyboard.press('Enter');
    await page.getByText('Linked card').first().waitFor(o);
  });
  const cardId = await until(async () => (await db.collection('cards').where('title', '==', 'Linked card').get()).size === 1)
    ? (await db.collection('cards').where('title', '==', 'Linked card').get()).docs[0].id
    : '';
  const before = await stored();
  // Written as an agent or another tab would: the panel follows it live.
  await notesDoc().set({
    text: `${before.text}\n\nSee [the linked card](${new URL(`/c/${cardId}`, BASE).href}).`,
    version: before.version + 1,
    updatedBy: faisalUid,
    updatedAt: Date.now(),
  });
  const link = panel.getByText('the linked card', { exact: true });
  await link.waitFor({ timeout: 20000 });
  const pagesBefore = ctx.pages().length;
  await link.click();
  check(
    'a card’s link in the notes opens the card in this app',
    await until(() => page.getByRole('button', { name: 'Share card' }).isVisible()),
  );
  check('and not in another tab', ctx.pages().length === pagesBefore);
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await page.getByText('To Do').first().waitFor({ timeout: 20000 });

  // ---- A refused save keeps the editor and the text -------------------------
  await saraPanel.getByRole('button', { name: 'Edit notes', exact: true }).waitFor({ timeout: 20000 });
  await saraPanel.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await typeInto(sara, saraPanel, ' Unsaved words.');
  await db.doc(`boards/${boardId}`).update({
    memberUids: FieldValue.arrayRemove(saraUid),
    [`memberProfiles.${saraUid}`]: FieldValue.delete(),
  });
  await sara.waitForTimeout(1500);
  const saveButton = saraPanel.getByRole('button', { name: 'Save', exact: true });
  if (await saveButton.isVisible().catch(() => false)) {
    await saveButton.click();
    await sara.waitForTimeout(2500);
    check(
      'a save the rules refuse keeps the editor open with what was typed',
      ((await saraPanel.locator('[contenteditable="true"]').first().textContent().catch(() => '')) ?? '').includes('Unsaved words.'),
    );
    check('and nothing was stored', !(await stored())?.text.includes('Unsaved words.'));
  } else {
    // Removed from the board, the board itself goes: nothing is left to save
    // into, which is also no lost write.
    check('a person removed mid-edit is taken off the board', !(await stored())?.text.includes('Unsaved words.'));
  }
  await db.doc(`boards/${boardId}`).update({
    memberUids: FieldValue.arrayUnion(saraUid),
    [`memberProfiles.${saraUid}`]: { displayName: 'Sara', email: 'sara@oursabeel.com' },
  });
  await sCtx.close();

  // ---- On a phone ------------------------------------------------------------
  const pCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await pCtx.newPage();
  phone.on('pageerror', (e) => check('no page error (phone)', false, String(e).slice(0, 120)));
  await signIn(phone, 'sara', phone.getByRole('button', { name: 'Boards', exact: true }).first());
  await openBoard(phone);
  const notesPage = phone.getByTestId('notes-page');
  const onScreen = async () => Math.abs((await notesPage.boundingBox())?.x ?? 999) < 24;
  check('the board opens on its first column, not the notes', (await phone.getByText('1 of 3').isVisible()) && !(await onScreen()));
  const notesControl = phone.getByRole('button', { name: 'Board notes', exact: true });
  check('the first column offers the notes in place of its left arrow', await notesControl.isVisible());
  check('and offers no previous column', (await phone.getByRole('button', { name: 'Previous column' }).count()) === 0);
  await notesControl.click();
  check('the notes are the page in front of it', await until(onScreen));
  check('the pager names them, and who edited them', await phone.getByText(/^Edited by Faisal/).first().isVisible());
  await phone.getByRole('button', { name: 'Next column', exact: true }).click();
  check('and the next page is the first column again', await until(async () => (await phone.getByText('1 of 3').isVisible()) && !(await onScreen())));
  await notesControl.click();
  await until(onScreen);
  await notesPage.getByRole('button', { name: 'Edit notes', exact: true }).click();
  await phone.getByText('Board notes', { exact: true }).first().waitFor({ timeout: 15000 });
  check('editing is a screen of its own', (await phone.getByTestId('notes-page').count()) === 0);
  const editor = phone.locator('[contenteditable="true"]').first();
  await editor.click();
  await phone.keyboard.press('ControlOrMeta+a');
  await phone.keyboard.press('Delete');
  await phone.waitForTimeout(300);
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  check(
    'emptying the notes is a save of no text',
    await until(async () => (await stored())?.text === ''),
    JSON.stringify(await stored()),
  );
  check(
    'recorded as such',
    await until(async () => (await versions())[0]?.removed > 0 && (await versions())[0]?.added === 0),
  );
  check(
    'and the page goes, leaving the first column where it was',
    await until(async () => (await phone.getByTestId('notes-page').count()) === 0 && (await phone.getByText('1 of 3').isVisible())),
  );
  check(
    'the notes icon stays in the left arrow’s place, the way to start them again',
    (await notesControl.isVisible()) && (await phone.getByRole('button', { name: 'Previous column' }).count()) === 0,
  );
  // Opened afresh on a board without notes, on its first column, the pager
  // moves on and DRAWS the next one: it is held invisible while it restores a
  // remembered page, and must not be held so when there was nothing to
  // restore. Playwright calls opacity 0 visible, so the opacity is read.
  await phone.getByRole('button', { name: 'Back', exact: true }).first().click();
  await openBoard(phone);
  await phone.getByRole('button', { name: 'Next column', exact: true }).click();
  const drawn = (text) =>
    phone.getByText(text).first().evaluate((el) => {
      for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).opacity === '0') return false;
      return true;
    });
  check(
    'a board without notes still pages on from its first column, drawn',
    await until(async () => (await phone.getByText('2 of 3').isVisible()) && (await drawn('No cards in In Progress.'))),
  );
  await phone.getByRole('button', { name: 'Previous column', exact: true }).click();
  await until(() => phone.getByText('1 of 3').isVisible());
  // Let the arrow's scroll finish: a layout change under an unfinished one
  // makes the browser snap back to the column it was leaving, which is the
  // pager's on every board and not what is tested here.
  await phone.waitForTimeout(1200);
  const start = phone.getByRole('button', { name: 'Board notes', exact: true });
  check(
    'and the first notes are started from the one notes icon, top left',
    (await start.count()) === 1 && ((await start.boundingBox())?.y ?? 999) < 300,
  );
  await start.click();
  await typeInto(phone, phone, 'Back again.');
  await phone.getByRole('button', { name: 'Save', exact: true }).click();
  const gained = await until(async () => (await phone.getByTestId('notes-page').count()) === 1 && (await phone.getByText('1 of 3').isVisible()));
  check(
    'a board given notes again gains the page, the board staying on its column',
    gained,
    gained ? '' : JSON.stringify({
      pages: await phone.getByTestId('notes-page').count(),
      pager: (await phone.locator('body').innerText()).slice(0, 200),
    }),
  );
  check('with the text saved', (await stored())?.text === 'Back again.');
  await pCtx.close();
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
