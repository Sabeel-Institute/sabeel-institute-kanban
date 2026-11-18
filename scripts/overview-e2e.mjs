/**
 * The overview, driven as an admin and as a member would.
 *
 *   bash scripts/e2e.sh scripts/overview-e2e.mjs
 *
 * A focused suite. The boards are written straight to the emulator, four with
 * lanes chosen so each order puts them differently, and three the overview
 * must leave out: a template, an archived board and a board without lanes.
 * Then: the entry shows only for someone with a listed board; each order,
 * either way, and the one chosen remembered; boards with the same lanes under
 * one heading, and a board whose lane is renamed under one of its own; a
 * finished card is not late; hide and show; and a member seeing only their
 * own boards, with hiding being each person's own. What a phone draws at each
 * width is the sweep's (`screens-e2e.mjs`).
 *
 * The page is read for its structure: each group, in order, and the rows in
 * it (`structure`).
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

function grantAdmin(email) {
  return new Promise((res, rej) => {
    const child = spawn('node', [resolve(import.meta.dirname, 'grant-admin.mjs'), email], {
      env: { ...process.env },
      stdio: 'pipe',
    });
    child.on('exit', (c) => (c === 0 ? res() : rej(new Error(`grant-admin exited ${c}`))));
  });
}

/** Each group on the page, in order, as the names of its rows, in order. */
function structure(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="overview-group"]')].map((g) =>
      [...g.querySelectorAll('[data-testid^="overview-row:"]')].map((r) =>
        r.getAttribute('data-testid').slice('overview-row:'.length),
      ),
    ),
  );
}
const flat = (groups) => groups.flat().join(', ');

/** The page's structure once it reads `want`, or what it read last. */
async function settled(page, want, timeout = 20000) {
  const until = Date.now() + timeout;
  let got;
  for (;;) {
    got = await structure(page);
    if (JSON.stringify(got) === JSON.stringify(want) || Date.now() > until) return got;
    await page.waitForTimeout(300);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A row's words, as a screen reader hears it. */
const rowLabel = (page, name) => page.getByTestId(`overview-row:${name}`).getAttribute('aria-label');

const PS = ['Planning', 'Supplies'];

async function board(id, name, laneNames, over, members) {
  const lanes = laneNames.map((n, i) => ({ id: `${id}_l${i}`, name: n }));
  await db.doc(`boards/${id}`).set({
    name,
    description: '',
    archived: false,
    columns: [
      { id: 'c_todo', name: 'To Do' },
      { id: 'c_done', name: 'Done' },
    ],
    columnIds: ['c_todo', 'c_done'],
    lanesOn: true,
    lanes,
    doneColumnId: 'c_done',
    fields: [{ id: 'f_start', name: 'Start date', type: 'start' }],
    details: {},
    memberUids: members.map((m) => m.uid),
    boardOwnerUids: [members[0].uid],
    memberProfiles: Object.fromEntries(members.map((m) => [m.uid, { displayName: m.name, email: m.email }])),
    activeCardCount: 0,
    createdBy: members[0].uid,
    ...over,
  });
}

async function card(boardId, n, lane, columnId, dueDate, by) {
  await db.doc(`cards/${boardId}_card${n}`).set({
    boardId,
    title: `Card ${n}`,
    description: '',
    columnId,
    laneId: `${boardId}_l${lane}`,
    rank: `m${n}`,
    priority: 'none',
    assigneeUids: [],
    subscriberUids: [],
    labelIds: [],
    archived: false,
    commentCount: 0,
    ...(dueDate ? { dueDate } : {}),
    createdAt: Date.now(),
    createdBy: by,
    updatedAt: Date.now(),
    updatedBy: by,
  });
}

async function signIn(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check(`no page error (${who})`, false, String(e).slice(0, 120)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: who, exact: true }).click();
  tally.note(who, await settle(page, page.getByText('Waiting for approval')));
  return { ctx, page };
}

const overviewButton = (page) => page.getByRole('button', { name: 'Overview', exact: true });

const browser = await chromium.launch();
try {
  // ---- An admin with no board yet ---------------------------------------------------
  const { page } = await signIn(browser, 'faisal');
  await grantAdmin('faisal@oursabeel.com');
  await agreeToRules(page);
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 30000 });
  const faisal = (await db.collection('users').where('email', '==', 'faisal@oursabeel.com').get()).docs[0];
  const F = { uid: faisal.id, name: 'Faisal', email: 'faisal@oursabeel.com' };

  // A board whose lanes were switched OFF keeps them (lanesOn false, lanes
  // there), which is what tells "lanes switched on" from "has lanes". While it
  // is the admin's only board, the overview is not offered. Absent means
  // something only once the list has answered: its row is waited for first.
  await board('ov_plain', 'Plain Board', PS, { lanesOn: false, createdAt: 7000 }, [F]);
  const answered = await page
    .getByText('Plain Board', { exact: true })
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true, () => false);
  check(
    'someone whose only board has its lanes switched off is offered no overview',
    answered && (await overviewButton(page).count()) === 0,
    answered ? 'the icon is there' : 'the board list never answered',
  );

  // Omar signs in now, so his uid can go on the boards he is to be on.
  const { ctx: octx, page: opage } = await signIn(browser, 'omar');
  const omar = (await db.collection('users').where('email', '==', 'omar@oursabeel.com').get()).docs[0];
  const O = { uid: omar.id, name: 'Omar', email: 'omar@oursabeel.com' };

  // Start dates, creation times and lateness each order the four differently:
  //   start:   Beta (Mar), Delta (May), Alpha (Jul), Gamma (none)
  //   created: Gamma, Alpha, Delta, Beta
  //   late:    Gamma (2020), Delta (2024), Alpha (2025), Beta (none late)
  // Alpha and Beta share their lanes, so they share a heading.
  await board('ov_alpha', 'Alpha Camp', PS, { details: { f_start: '2027-07-01' }, createdAt: 2000 }, [F, O]);
  await board('ov_beta', 'Beta Course', PS, { details: { f_start: '2027-03-01' }, createdAt: 4000 }, [O]);
  await board('ov_gamma', 'Gamma Circle', ['Prep', 'Teach'], { createdAt: 1000 }, [F, O]);
  await board('ov_delta', 'Delta Retreat', [...PS, 'Wrap-up'], { details: { f_start: '2027-05-01' }, createdAt: 3000 }, [F]);
  await board('ov_tmpl', 'Template Program', PS, { template: true, createdAt: 5000 }, [F, O]);
  await board('ov_old', 'Old Program', PS, { archived: true, createdAt: 6000 }, [F, O]);
  // Alpha: a finished card long past its date (not late), and a late one.
  await card('ov_alpha', 0, 0, 'c_done', '2020-01-01', F.uid);
  await card('ov_alpha', 1, 1, 'c_todo', '2025-06-01', F.uid);
  await card('ov_beta', 0, 0, 'c_todo', null, F.uid);
  await card('ov_gamma', 0, 0, 'c_todo', '2020-01-01', F.uid);
  await card('ov_delta', 0, 2, 'c_todo', '2024-01-01', F.uid);

  await overviewButton(page).waitFor({ timeout: 20000 }).catch(() => {});
  check('a board with lanes brings the overview into the Boards header', await overviewButton(page).isVisible());
  await overviewButton(page).click();
  await page.getByRole('heading', { name: 'Overview' }).or(page.getByText('Overview', { exact: true })).first().waitFor();

  // ---- Who is listed ----------------------------------------------------------------
  const START = [['Beta Course', 'Alpha Camp'], ['Delta Retreat'], ['Gamma Circle']];
  let got = await settled(page, START);
  check('the boards with lanes are listed, start date first, the same lanes under one heading', same(got, START), flat(got));
  check(
    'an admin sees a board they were not added to',
    got.flat().includes('Beta Course'),
  );
  check(
    'a template, an archived board and a board without lanes are left out',
    (await page.getByText('Template Program').count()) === 0 &&
      (await page.getByText('Old Program').count()) === 0 &&
      (await page.getByText('Plain Board').count()) === 0,
  );

  // ---- What a row says --------------------------------------------------------------
  await page.waitForFunction(
    () => ![...document.querySelectorAll('[data-testid^="overview-row:"]')].some((r) => /: loading$/.test(r.getAttribute('aria-label') || '')),
    null,
    { timeout: 20000 },
  );
  const alpha = await rowLabel(page, 'Alpha Camp');
  check(
    'a row names each lane and its state',
    alpha?.startsWith('Alpha Camp, Starts 1 Jul 2027: ') &&
      alpha.includes('Planning, all finished;') &&
      alpha.includes('Supplies, a card is late, 0 of 1 finished'),
    alpha ?? 'no label',
  );
  check(
    'a finished card is not late, however old its date',
    !/Planning, a card is late/.test(alpha ?? ''),
  );
  check(
    'one mark a lane',
    (await page.getByTestId('overview-row:Delta Retreat').getByTestId('overview-mark').count()) === 3,
  );

  // ---- Each order, either way ------------------------------------------------------------
  const order = page.getByLabel('Order', { exact: true });
  const reverse = page.getByRole('button', { name: 'Reverse the order' });
  await reverse.click();
  const START_BACK = [['Alpha Camp', 'Beta Course'], ['Delta Retreat'], ['Gamma Circle']];
  got = await settled(page, START_BACK);
  check('start date, reversed: latest first, and no start date still last', same(got, START_BACK), flat(got));
  check('the reverse control says it is on', (await reverse.getAttribute('aria-pressed')) === 'true');
  await reverse.click();

  await order.selectOption({ label: 'Date created' });
  const CREATED = [['Gamma Circle'], ['Alpha Camp', 'Beta Course'], ['Delta Retreat']];
  got = await settled(page, CREATED);
  check('date created: oldest first', same(got, CREATED), flat(got));
  await reverse.click();
  const CREATED_BACK = [['Beta Course', 'Alpha Camp'], ['Delta Retreat'], ['Gamma Circle']];
  got = await settled(page, CREATED_BACK);
  check('date created, reversed: newest first', same(got, CREATED_BACK), flat(got));
  await reverse.click();

  await order.selectOption({ label: 'Most overdue' });
  const LATE = [['Gamma Circle'], ['Delta Retreat'], ['Alpha Camp', 'Beta Course']];
  got = await settled(page, LATE);
  check('most overdue: the latest card first', same(got, LATE), flat(got));
  await reverse.click();
  const LATE_BACK = [['Beta Course', 'Alpha Camp'], ['Delta Retreat'], ['Gamma Circle']];
  got = await settled(page, LATE_BACK);
  check('most overdue, reversed', same(got, LATE_BACK), flat(got));

  const stored = async () => (await db.doc(`users/${F.uid}`).get()).data();
  // The page moves on the local write, before the server has it: a stored
  // read waits until it holds what is expected, or gives up and shows what it
  // read.
  const storedWhen = async (ok) => {
    let data = await stored();
    for (let i = 0; i < 60 && !ok(data); i += 1) {
      await page.waitForTimeout(250);
      data = await stored();
    }
    return data;
  };
  let prefs = await storedWhen((d) => d.overviewSort === 'late' && d.overviewReverse === true);
  check('the order is kept for the person', prefs.overviewSort === 'late' && prefs.overviewReverse === true);
  await page.reload({ waitUntil: 'load' });
  await overviewButton(page).waitFor({ timeout: 30000 }).catch(() => {});
  if (await overviewButton(page).isVisible()) await overviewButton(page).click();
  got = await settled(page, LATE_BACK);
  // LATE_BACK happens to draw as the default order does, so the controls are
  // read too: they show what was kept, not what an overview with nothing
  // stored would choose.
  const keptSort = await order.inputValue().catch(() => null);
  const keptReverse = await reverse.getAttribute('aria-pressed').catch(() => null);
  check(
    'and is the order the overview opens in next time',
    same(got, LATE_BACK) && keptSort === 'late' && keptReverse === 'true',
    `${flat(got)} | order ${keptSort}, reversed ${keptReverse}`,
  );
  await reverse.click();
  await order.selectOption({ label: 'Start date' });
  got = await settled(page, START);

  // ---- A renamed lane is a heading of its own ---------------------------------------------
  await db.doc('boards/ov_beta').update({
    lanes: [
      { id: 'ov_beta_l0', name: 'Planning' },
      { id: 'ov_beta_l1', name: 'Materials' },
    ],
  });
  const RENAMED = [['Beta Course'], ['Delta Retreat'], ['Alpha Camp'], ['Gamma Circle']];
  got = await settled(page, RENAMED);
  check('a board whose lane is renamed moves under a heading of its own', same(got, RENAMED), flat(got));
  await db.doc('boards/ov_beta').update({
    lanes: [
      { id: 'ov_beta_l0', name: 'Planning' },
      { id: 'ov_beta_l1', name: 'supplies' },
    ],
  });
  got = await settled(page, START);
  check('and back with them, whatever the capitals', same(got, START), flat(got));

  // ---- Hide and show ------------------------------------------------------------------------
  await page.getByTestId('overview-row:Alpha Camp').click({ button: 'right' });
  await page.getByText('Hide from my overview').click();
  const HIDDEN = [['Beta Course'], ['Delta Retreat'], ['Gamma Circle']];
  got = await settled(page, HIDDEN);
  check('hidden, a board leaves the overview', same(got, HIDDEN), flat(got));
  prefs = await storedWhen((d) => JSON.stringify(d.overviewHiddenBoardIds) === '["ov_alpha"]');
  check('and only the hidden list is written', JSON.stringify(prefs.overviewHiddenBoardIds) === '["ov_alpha"]');
  const disclosure = page.getByRole('button', { name: 'Hidden (1)' });
  check('Hidden (1) at the foot', await disclosure.isVisible());
  await disclosure.click();
  const show = page.getByRole('button', { name: 'Show Alpha Camp', exact: true });
  const opened = await show.waitFor({ timeout: 10000 }).then(() => true, () => false);
  const expanded = await disclosure.getAttribute('aria-expanded');
  check(
    'opens to the hidden board, and says it is open',
    opened && expanded === 'true' && (await page.getByText('Alpha Camp', { exact: true }).count()) === 1,
    `Show ${opened ? 'shown' : 'missing'}, aria-expanded ${expanded}`,
  );
  await show.click();
  got = await settled(page, START);
  check('shown again, it returns to its place in the order', same(got, START), flat(got));
  check('and the foot has nothing hidden', (await page.getByRole('button', { name: /^Hidden \(/ }).count()) === 0);

  // Faisal hides Gamma, for the member's check below.
  await page.getByTestId('overview-row:Gamma Circle').click({ button: 'right' });
  await page.getByText('Hide from my overview').click();
  await settled(page, [['Beta Course', 'Alpha Camp'], ['Delta Retreat']]);

  // A hidden board archived, another hidden meanwhile, then restored: still
  // hidden. Hiding writes the whole list, and it once dropped every board
  // not listed at that moment.
  await db.doc('boards/ov_gamma').update({ archived: true });
  // Archived and so no longer listed: the foot has nothing hidden to count.
  await page.getByRole('button', { name: /^Hidden \(/ }).waitFor({ state: 'detached', timeout: 20000 });
  await page.getByTestId('overview-row:Delta Retreat').click({ button: 'right' });
  await page.getByText('Hide from my overview').click();
  await settled(page, [['Beta Course', 'Alpha Camp']]);
  await db.doc('boards/ov_gamma').update({ archived: false });
  // Restored: listed again, and hidden, so the foot counts two.
  await page.getByRole('button', { name: 'Hidden (2)' }).waitFor({ timeout: 20000 }).catch(() => {});
  got = await settled(page, [['Beta Course', 'Alpha Camp']]);
  prefs = await storedWhen((d) => [...(d.overviewHiddenBoardIds ?? [])].sort().join() === 'ov_delta,ov_gamma');
  check(
    'a hidden board archived and restored is still hidden, though another was hidden meanwhile',
    same(got, [['Beta Course', 'Alpha Camp']]) &&
      JSON.stringify([...prefs.overviewHiddenBoardIds].sort()) === '["ov_delta","ov_gamma"]',
    `${flat(got)} | ${JSON.stringify(prefs.overviewHiddenBoardIds)}`,
  );
  await page.getByRole('button', { name: /^Hidden \(/ }).click();
  await page.getByRole('button', { name: 'Show Delta Retreat', exact: true }).click();
  await settled(page, [['Beta Course', 'Alpha Camp'], ['Delta Retreat']]);

  // ---- A row opens its board --------------------------------------------------------------
  await page.getByTestId('overview-row:Delta Retreat').click();
  check(
    'a row opens its board',
    await page
      .getByRole('button', { name: 'Board settings' })
      .waitFor({ timeout: 20000 })
      .then(() => page.getByText('Delta Retreat').first().isVisible(), () => false),
  );

  // ---- A member, on two of the boards -------------------------------------------------------
  await omar.ref.update({
    role: 'member',
    status: 'active',
    rulesVersion: RULES_VERSION,
    rulesAcceptedAt: FieldValue.serverTimestamp(),
  });
  await getAuth().setCustomUserClaims(O.uid, { role: 'member', status: 'active' });
  await omar.ref.update({ claimsUpdatedAt: FieldValue.serverTimestamp() });
  await overviewButton(opage).waitFor({ timeout: 40000 }).catch(() => {});
  check('a member on a board with lanes is offered the overview', await overviewButton(opage).isVisible());
  await overviewButton(opage).click();
  const MINE = [['Beta Course', 'Alpha Camp'], ['Gamma Circle']];
  got = await settled(opage, MINE);
  check('a member sees only the boards they are on', same(got, MINE), flat(got));
  check('and what one person hides stays hidden from them alone', got.flat().includes('Gamma Circle'));
  await octx.close();
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
