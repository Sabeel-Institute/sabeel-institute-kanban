/**
 * A board's details, driven as an owner and read as a member.
 *
 *   bash scripts/e2e.sh scripts/details-e2e.mjs
 *
 * A focused suite: fields of every type added on the Details page, values set,
 * refused and cleared, fields renamed, reordered and removed with their
 * values, the board's history naming each change, the limit of twenty, and a
 * member who reads every value and is offered no editor. What the stored
 * document holds is read back with the Admin SDK, not assumed from the screen.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { RULES_VERSION } from '@sabeel/shared';
import { PORTS, PROJECT } from './lib/emulators.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { agreeToRules } from './lib/rules.mjs';

const tally = tryAgainTally();
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORTS.web}/`;

process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;
initializeApp({ projectId: PROJECT });
const db = getFirestore();

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

const BOARD = 'Details Program';
const browser = await chromium.launch();
const dialogs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page error', false, String(e).slice(0, 120)));
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.accept();
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'faisal', exact: true }).click();
  tally.note('faisal', await settle(page, page.getByText('Waiting for approval')));
  await grantAdmin('faisal@oursabeel.com');
  await agreeToRules(page);
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 30000 });

  await page.getByRole('button', { name: 'New board' }).click();
  await fillThen(page, page.getByPlaceholder('Board name'), BOARD, (o) =>
    page.getByRole('button', { name: 'Create', exact: true }).click(o),
  );
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  const boardId = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0].id;
  const stored = async () => (await db.doc(`boards/${boardId}`).get()).data();
  /**
   * The stored board once `ok` holds of it, or as it last was. The page
   * changes on Firestore's local write, before the server has it, so a read
   * taken the moment the screen changes can be one write behind.
   */
  const storedOnce = async (ok, ms = 15000) => {
    const until = Date.now() + ms;
    let data = await stored();
    while (!ok(data) && Date.now() < until) {
      await page.waitForTimeout(300);
      data = await stored();
    }
    return data;
  };

  await page.getByRole('button', { name: 'Board settings' }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  check(
    'a board with no details says so, and offers an owner a way to add them',
    await page
      .getByText('No details yet.')
      .waitFor({ timeout: 15000 })
      .then(() => page.getByRole('button', { name: 'Add details' }).isVisible()),
  );

  // ---- Fields of every type ----------------------------------------------------
  await page.getByRole('button', { name: 'Add details' }).click();
  const typeSelect = page.getByLabel('Type', { exact: true });
  const addField = async (typeLabel, name) => {
    await typeSelect.selectOption({ label: typeLabel });
    const label = name ?? typeLabel.split(' (')[0];
    if (name) {
      await fillThen(page, page.getByPlaceholder('Field name, such as Teachers'), name, (o) =>
        page.getByRole('button', { name: 'Add field' }).click(o),
      );
    } else {
      await page.getByRole('button', { name: 'Add field' }).click();
    }
    await page.getByRole('button', { name: `Remove field ${label}` }).waitFor({ timeout: 20000 });
  };
  await addField('Text', 'Teachers');
  await addField('Number', 'Fee');
  await addField('Date', 'Orientation');
  await addField('Link', 'Zoom link');
  await addField('Start date (read by other screens)');
  await addField('End date (read by other screens)');
  const offered = await typeSelect.locator('option').allTextContents();
  check(
    'Start date and End date are offered only until the board has one',
    offered.join(',') === 'Text,Number,Date,Link',
    offered.join(','),
  );
  check(
    'Start date and End date keep their names',
    (await page.getByRole('button', { name: 'Rename field Start date' }).count()) === 0 &&
      (await page.getByRole('button', { name: 'Rename field Teachers' }).count()) === 1,
  );
  await fillThen(page, page.getByPlaceholder('Field name, such as Teachers'), 'teachers', (o) =>
    page.getByRole('button', { name: 'Add field' }).click(o),
  );
  check(
    'a second field of the same name, in other capitals, is refused',
    await page
      .getByText('There is already a field with that name.')
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false),
  );
  await page.getByPlaceholder('Field name, such as Teachers').fill('');
  {
    const want = JSON.stringify([
      ['Teachers', 'text'],
      ['Fee', 'number'],
      ['Orientation', 'date'],
      ['Zoom link', 'link'],
      ['Start date', 'start'],
      ['End date', 'end'],
    ]);
    const shape = (d) => JSON.stringify((d.fields ?? []).map((f) => [f.name, f.type]));
    const data = await storedOnce((d) => shape(d) === want);
    check('every type is stored, with its own id', shape(data) === want, shape(data));
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // ---- Values -------------------------------------------------------------------
  const setValue = async (field, value) => {
    await page.getByRole('button', { name: `Edit ${field}` }).click();
    await page.getByLabel(field, { exact: true }).fill(value);
    await page.getByRole('button', { name: `Save ${field}` }).click();
  };
  await setValue('Teachers', 'Sara and Omar');
  await page.getByText('Sara and Omar').waitFor({ timeout: 15000 });
  await setValue('Fee', '1,200');
  await page.getByText('1200', { exact: true }).waitFor({ timeout: 15000 });
  {
    const data = await storedOnce((d) => d.details?.[d.fields[1].id] === '1200');
    check('a number is kept without its commas', data.details?.[data.fields[1].id] === '1200');
  }

  await setValue('Fee', 'a lot');
  check(
    'a number that is not one is refused, and the field stays open',
    (await page.getByText('Enter a number, such as 120 or 7.5.').isVisible()) &&
      (await page.getByLabel('Fee', { exact: true }).isVisible()),
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await setValue('Zoom link', 'javascript:alert(1)');
  check(
    'a link that is not http or https is refused',
    await page
      .getByText('Enter a web address starting with http:// or https://.')
      .isVisible(),
  );
  await page.getByLabel('Zoom link', { exact: true }).fill('https://meet.example.org/details');
  await page.getByRole('button', { name: 'Save Zoom link' }).click();
  check(
    'a link is shown as one',
    await page
      .getByRole('link', { name: 'Zoom link: https://meet.example.org/details' })
      .waitFor({ timeout: 15000 })
      .then(() => true, () => false),
  );

  await page.getByLabel('Start date', { exact: true }).fill('2027-06-21');
  await page.getByLabel('Orientation', { exact: true }).fill('2027-06-14');
  const idOf = async (name) => (await stored()).fields.find((f) => f.name === name).id;
  const startId = await idOf('Start date');
  const orientationId = await idOf('Orientation');
  const values = (
    await storedOnce((d) => d.details?.[startId] === '2027-06-21' && d.details?.[orientationId] === '2027-06-14')
  ).details;
  check(
    'a date is stored as YYYY-MM-DD',
    values[startId] === '2027-06-21' && values[orientationId] === '2027-06-14',
    JSON.stringify(values),
  );

  // Typed as a person types it, a key at a time, into the year of a date
  // already set: the field passes through 0002, 0020 and 0202 on the way to
  // 2028. One write, of the date meant, and nothing in between. (`fill` sets
  // the whole value at once, which is how writing every keystroke went unseen.)
  await page.getByLabel('Start date', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('2028', { delay: 150 });
  await page.keyboard.press('Enter');
  const typed = await storedOnce((d) => d.details?.[startId] === '2028-06-21');
  await page.waitForTimeout(3000);
  const midway = (await db.collection(`boards/${boardId}/activity`).get()).docs
    .map((d) => d.data())
    .filter((e) => e.type === 'detailChanged' && /^0/.test(e.to ?? ''));
  check(
    'typing a year writes the date meant and nothing in between',
    typed.details[startId] === '2028-06-21' && midway.length === 0,
    `${typed.details[startId]}; midway ${midway.map((e) => e.to).join(',')}`,
  );
  await page.getByLabel('Start date', { exact: true }).fill('2027-06-21');
  await page.getByLabel('Orientation', { exact: true }).focus();
  await storedOnce((d) => d.details?.[startId] === '2027-06-21');

  await setValue('Teachers', '   ');
  const teachersId = await idOf('Teachers');
  check(
    'clearing a value removes it, and the field says Not set',
    !(teachersId in (await storedOnce((d) => !(teachersId in d.details))).details) &&
      (await page.getByText('Not set').first().isVisible()),
  );
  check(
    'the list says how many are filled in',
    await page
      .getByText('4 of 6 filled in')
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false),
  );

  // ---- Fields: rename, reorder, remove ---------------------------------------
  await page.getByRole('button', { name: 'Edit fields' }).click();
  await page.getByRole('button', { name: 'Rename field Teachers' }).click();
  await page.getByLabel('Rename Teachers').fill('Instructors');
  await page.getByRole('button', { name: 'Save field name' }).click();
  await page.getByRole('button', { name: 'Rename field Instructors' }).waitFor({ timeout: 15000 });

  // An HTML5 drag, one event per task: see lanes-e2e.mjs.
  const fire = (selector, type) =>
    page.evaluate(
      ([sel, t]) => {
        window.__dt ??= new DataTransfer();
        document
          .querySelector(sel)
          .dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
        if (t === 'dragend') window.__dt = undefined;
      },
      [selector, type],
    );
  await fire('[aria-label="Remove field Zoom link"]', 'dragstart');
  await page.waitForTimeout(250);
  await fire('[aria-label="Remove field Instructors"]', 'dragover');
  await page.waitForTimeout(250);
  await fire('[aria-label="Remove field Instructors"]', 'drop');
  await fire('[aria-label="Remove field Zoom link"]', 'dragend');
  const reordered = await storedOnce((d) => d.fields[0].name === 'Zoom link');
  check(
    'fields are reordered by dragging',
    reordered.fields[0].name === 'Zoom link',
    reordered.fields.map((f) => f.name).join(','),
  );

  dialogs.length = 0;
  const feeId = await idOf('Fee');
  await page.getByRole('button', { name: 'Remove field Fee' }).click();
  await page.getByRole('button', { name: 'Remove field Fee' }).waitFor({ state: 'detached', timeout: 15000 });
  const after = await storedOnce((d) => !d.fields.some((f) => f.id === feeId) && !(feeId in d.details));
  check(
    'removing a field asks first, naming the value that goes with it',
    /Remove “Fee”\?[\s\S]*“1200”/.test(dialogs.join('|')),
    dialogs.join(' | '),
  );
  check(
    'and takes its value with it, in the same write',
    !after.fields.some((f) => f.id === feeId) && !(feeId in after.details),
    JSON.stringify(after.details),
  );

  // A value with no field, as two owners editing the fields at once could
  // leave: the next write of the fields takes it away.
  await db.doc(`boards/${boardId}`).update({ 'details.fld_ghost': 'left behind' });
  await page.getByRole('button', { name: 'Rename field Instructors' }).click();
  await page.getByLabel('Rename Instructors').fill('Tutors');
  await page.getByRole('button', { name: 'Save field name' }).click();
  const swept = await storedOnce((d) => !('fld_ghost' in d.details) && d.fields.some((f) => f.name === 'Tutors'));
  check(
    'a value left with no field is cleared by the next write of the fields',
    !('fld_ghost' in swept.details) && swept.fields.some((f) => f.name === 'Tutors'),
    JSON.stringify(swept.details),
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await page.getByRole('button', { name: 'History', exact: true }).click();
  for (const line of [
    / added the field “Teachers” ·/,
    / set “Fee” to “1200” ·/,
    / cleared “Teachers” ·/,
    / renamed the field “Teachers” to “Instructors” ·/,
    / reordered the details ·/,
    / removed the field “Fee” ·/,
  ]) {
    check(
      `the board's history says it: ${line.source.trim()}`,
      await page.getByText(line).first().waitFor({ timeout: 25000 }).then(() => true, () => false),
    );
  }

  // ---- At most twenty -------------------------------------------------------------
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `fld_m${i}`, name: `Field ${i + 1}`, type: 'text' }));
  await db.doc(`boards/${boardId}`).update({ fields: many, details: {} });
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: 'Edit fields' }).click();
  check(
    'a board with twenty fields offers no twenty-first, and says why',
    (await page
      .getByText('A board can have at most 20 details.')
      .waitFor({ timeout: 15000 })
      .then(() => true, () => false)) &&
      (await page.getByRole('button', { name: 'Add field' }).count()) === 0,
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await db.doc(`boards/${boardId}`).update({
    fields: [
      { id: 'fld_t', name: 'Teachers', type: 'text' },
      { id: 'fld_s', name: 'Start date', type: 'start' },
    ],
    details: { fld_t: 'Sara and Omar', fld_s: '2027-06-21' },
  });
  await ctx.close();

  // ---- A member reads them --------------------------------------------------------
  const mctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const mpage = await mctx.newPage();
  await mpage.goto(BASE, { waitUntil: 'networkidle' });
  await mpage.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await mpage.getByRole('button', { name: 'omar', exact: true }).click();
  tally.note('omar', await settle(mpage, mpage.getByText('Waiting for approval')));
  const omar = (await db.collection('users').where('email', '==', 'omar@oursabeel.com').get()).docs[0];
  await omar.ref.update({
    role: 'member',
    status: 'active',
    rulesVersion: RULES_VERSION,
    rulesAcceptedAt: FieldValue.serverTimestamp(),
  });
  await getAuth().setCustomUserClaims(omar.id, { role: 'member', status: 'active' });
  // Stamped after the claims, as setUserAccess does: the open session reads
  // this as the cue to fetch its new token.
  await omar.ref.update({ claimsUpdatedAt: FieldValue.serverTimestamp() });
  await db.doc(`boards/${boardId}`).update({
    memberUids: FieldValue.arrayUnion(omar.id),
    [`memberProfiles.${omar.id}`]: { displayName: 'Omar', email: 'omar@oursabeel.com' },
  });
  await mpage.getByText(BOARD).first().waitFor({ timeout: 40000 });
  await mpage.getByText(BOARD).first().click();
  await mpage.getByRole('button', { name: 'About this board' }).click();
  await mpage.getByText('Sara and Omar').waitFor({ timeout: 20000 });
  check(
    'a member reads every value, Details first',
    (await mpage.getByText('21 Jun 2027').isVisible()) &&
      (await mpage.getByRole('button', { name: 'Details', exact: true }).getAttribute('aria-current')) === 'page',
  );
  check(
    'and is offered no editor at all',
    (await mpage.getByRole('button', { name: 'Edit fields' }).count()) === 0 &&
      (await mpage.getByRole('button', { name: /^Edit / }).count()) === 0 &&
      (await mpage.getByLabel('Start date', { exact: true }).count()) === 0,
  );
  await mctx.close();
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
