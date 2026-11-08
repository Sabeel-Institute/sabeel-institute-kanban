/**
 * `scripts/scope-labels.mjs`, rehearsed end to end.
 *
 *   npm run test:emulator    # its rules pass runs this, after migration-e2e
 *
 * The script runs by hand against production once, so nothing else exercises
 * it. This drives it as a real subprocess, since its refusals ARE exit codes.
 * Every refusal is checked by the reason it prints, not by its exit code alone:
 * a check that passes on any failure would pass on the wrong one.
 *
 * Needs firestore only, and no Functions emulator. That the card trigger records
 * no history for SYSTEM_ACTOR's writes is tested in cardTriggers.test.ts.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SYSTEM_ACTOR } from '@sabeel/shared';
import { PORTS, PROJECT } from './lib/emulators.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
process.env.GCLOUD_PROJECT = PROJECT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

// The plan holds real names in production, so even here it lives outside the repo.
const dir = mkdtempSync(join(tmpdir(), 'scope-labels-'));
let planCount = 0;
function plan(entries) {
  planCount += 1;
  const path = join(dir, `plan-${planCount}.json`);
  writeFileSync(path, typeof entries === 'string' ? entries : JSON.stringify(entries));
  return path;
}
function run(...args) {
  const r = spawnSync('node', [resolve(import.meta.dirname, 'scope-labels.mjs'), ...args], {
    env: { ...process.env },
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

initializeApp({ projectId: PROJECT });
const db = getFirestore();

const MEMBER = 'sl_member';
const label = (id) => db.doc(`labels/${id}`);
const card = (id) => db.doc(`cards/${id}`);
const read = async (ref) => (await ref.get()).data();
const ids = async (id) => JSON.stringify((await read(card(id))).labelIds);

// Everything this file seeds starts with sl_, so the world can be compared
// whole before and after, whatever else the emulator holds.
async function world() {
  const [l, c] = await Promise.all([db.collection('labels').get(), db.collection('cards').get()]);
  const mine = (snap) =>
    snap.docs.filter((d) => d.id.startsWith('sl_')).map((d) => [d.id, d.data()]).sort();
  return JSON.stringify([mine(l), mine(c)]);
}

const B1 = 'sl_b1';
const B2 = 'sl_b2';
const B3 = 'sl_b3';
async function seed() {
  for (const [id, name, archived] of [
    [B1, 'Rehearsal One', false],
    [B2, 'Rehearsal Two', false],
    [B3, 'Rehearsal Three', true],
  ]) {
    await db.doc(`boards/${id}`).set({ name, memberUids: [MEMBER], boardOwnerUids: [MEMBER], archived });
  }
  const l = (id, name, extra = {}) =>
    label(id).set({ name, color: '#83114F', createdAt: 7, createdBy: 'sl_maker', ...extra });
  await l('sl_one', 'Rehearsal one board');
  await l('sl_spread', 'Rehearsal spread', { color: '#3E6B8A' });
  await l('sl_also', 'Rehearsal also');
  await l('sl_unused', 'Rehearsal unused');
  await l('sl_half', 'Rehearsal half done');
  await l('sl_kept', 'Rehearsal kept');
  await l('sl_case', 'Rehearsal Case');
  await l('sl_twin_a', 'Rehearsal twin');
  await l('sl_twin_b', 'Rehearsal twin');
  // A board's own label already, which the run must leave alone.
  await l('sl_own', 'Rehearsal own', { boardId: B1 });
  // A run that stopped part-way: B1's copy exists and its card was moved onto
  // it, B2's card was not reached, and the institute label is still there.
  await l('sl_half_sl_b1', 'Rehearsal half done', { boardId: B1 });

  const c = (id, boardId, labelIds, archived = false) =>
    card(id).set({ boardId, title: id, labelIds, archived, updatedBy: MEMBER, updatedAt: 1 });
  await c('sl_c1', B1, ['sl_one', 'sl_kept', 'sl_own']);
  await c('sl_c2', B1, ['sl_spread']);
  await c('sl_c3', B1, ['sl_spread', 'sl_one']);
  await c('sl_c4', B2, ['sl_kept', 'sl_spread'], true);
  // On the archived board, carrying two planned labels and one that stays.
  await c('sl_c5', B3, ['sl_also', 'sl_kept', 'sl_spread']);
  await c('sl_c6', B2, ['sl_kept']);
  await c('sl_c7', B2, []);
  await c('sl_h1', B1, ['sl_half_sl_b1']);
  await c('sl_h2', B2, ['sl_half', 'sl_kept']);
}

await seed();
const before = await world();
const PLAN = ['Rehearsal one board', 'Rehearsal spread', 'Rehearsal also', 'Rehearsal unused', 'Rehearsal half done'];

// ---- Refusals: each names its reason, exits non-zero and writes nothing ------
const refusals = [
  ['an unknown option', [plan(PLAN), '--force'], /Unknown option --force/],
  ['two plan files', [plan(PLAN), plan(PLAN)], /One plan file only/],
  ['no plan file', [], /^Usage:/m],
  ['a missing plan file', [join(dir, 'nope.json')], /No plan file at/],
  ['a plan that is not JSON', [plan('{not json')], /is not JSON/],
  ['an empty plan', [plan([])], /non-empty JSON array/],
  ['a plan that is not an array', [plan({ label: 'Rehearsal spread' })], /non-empty JSON array/],
  ['an entry that is not a name', [plan(['Rehearsal spread', { label: 'x' }])], /Plan entry 2 is not a label name/],
  ['a blank name', [plan(['Rehearsal spread', ' '])], /Plan entry 2 is not a label name/],
  ['a name given twice', [plan(['Rehearsal spread', 'Rehearsal spread'])], /"Rehearsal spread" is in the plan twice/],
  ['a name given twice in other capitals', [plan(['Rehearsal spread', 'rehearsal SPREAD'])], /"rehearsal SPREAD" is in the plan twice/],
  ['a name in the wrong capitals, naming the right one', [plan(['Rehearsal spread', 'rehearsal case'])], /"rehearsal case": no label has exactly this name\. Did you mean "Rehearsal Case"\?/],
  ['a name no label has', [plan(['Rehearsal spread', 'No such label'])], /"No such label": no label has exactly this name\.$/m],
  ['a name two institute labels share', [plan(['Rehearsal spread', 'Rehearsal twin'])], /"Rehearsal twin": 2 institute labels have this name/],
];
for (const [what, args, reason] of refusals) {
  const r = run(...args, '--apply');
  check(`refuses ${what}`, r.code !== 0 && reason.test(r.out), r.out.trim());
}
const refusedWorld = await world();
check('no refusal wrote anything', refusedWorld === before);
const noProject = spawnSync('node', [resolve(import.meta.dirname, 'scope-labels.mjs'), plan(PLAN), '--apply'], {
  env: { ...process.env, GCLOUD_PROJECT: '' },
  encoding: 'utf8',
});
check('refuses to run without GCLOUD_PROJECT', noProject.status !== 0 && /without GCLOUD_PROJECT/.test(noProject.stderr));

// ---- A dry run reports and writes nothing -------------------------------------
const dry = run(plan(PLAN));
check('a dry run succeeds', dry.code === 0, dry.out);
check(
  'and lists each board a label is on, with its cards',
  /"Rehearsal spread": 4 card\(s\) on 3 board\(s\)\n {4}Rehearsal One: 2 card\(s\)\n {4}Rehearsal Three: 1 card\(s\)\n {4}Rehearsal Two: 1 card\(s\)/.test(dry.out),
  dry.out,
);
check('and says a label on no card is deleted', /"Rehearsal unused": on no card\. The label is deleted\./.test(dry.out), dry.out);
// one: c1 c3 (B1). spread: c2 c3 (B1), c4 (B2), c5 (B3). also: c5 (B3). half: h2 (B2).
// Copies: one/B1, spread/B1 B2 B3, also/B3, half/B2 = 6. Distinct cards: c1 c2 c3 c4 c5 h2 = 6.
check(
  'and counts board labels and distinct cards',
  /5 label\(s\) to make board labels, 0 done already: 6 board label\(s\) to create, 6 card\(s\) to rewrite\./.test(dry.out),
  dry.out,
);
check('and writes nothing', (await world()) === before);

// ---- Apply --------------------------------------------------------------------
const applied = run(plan(PLAN), '--apply');
check('applying succeeds', applied.code === 0, applied.out);
check(
  'and reports what it did',
  /Applied: 6 board label\(s\) created, 6 card\(s\) rewritten, 5 institute label\(s\) deleted\./.test(applied.out),
  applied.out,
);
const copy = async (id) => read(label(id));
const spreadCopies = await Promise.all([B1, B2, B3].map((b) => copy(`sl_spread_${b}`)));
check(
  'every board that used a label gets its own copy, archived board included',
  spreadCopies.every((c, k) => c?.boardId === [B1, B2, B3][k]),
  JSON.stringify(spreadCopies),
);
check(
  'a copy keeps the name, colour and creation fields',
  spreadCopies.every(
    (c) => c?.name === 'Rehearsal spread' && c?.color === '#3E6B8A' && c?.createdAt === 7 && c?.createdBy === 'sl_maker',
  ),
  JSON.stringify(spreadCopies),
);
check('only boards that used a label get one', !(await label('sl_one_sl_b2').get()).exists && !(await label('sl_also_sl_b1').get()).exists);
check('a card moves onto its board’s copy, keeping the order', (await ids('sl_c3')) === JSON.stringify(['sl_spread_sl_b1', 'sl_one_sl_b1']), await ids('sl_c3'));
check('labels that stay are left on the card', (await ids('sl_c1')) === JSON.stringify(['sl_one_sl_b1', 'sl_kept', 'sl_own']), await ids('sl_c1'));
check('an archived card moves too', (await ids('sl_c4')) === JSON.stringify(['sl_kept', 'sl_spread_sl_b2']), await ids('sl_c4'));
check(
  'a card on an archived board with two planned labels gets both copies',
  (await ids('sl_c5')) === JSON.stringify(['sl_also_sl_b3', 'sl_kept', 'sl_spread_sl_b3']),
  await ids('sl_c5'),
);
const c4 = await read(card('sl_c4'));
check('a rewritten card is stamped SYSTEM_ACTOR, and its date is left alone', c4.updatedBy === SYSTEM_ACTOR && c4.updatedAt === 1, JSON.stringify(c4));
const c6 = await read(card('sl_c6'));
check('a card with no planned label is not written', c6.updatedBy === MEMBER && JSON.stringify(c6.labelIds) === JSON.stringify(['sl_kept']));
const gone = await Promise.all(['sl_one', 'sl_spread', 'sl_also', 'sl_unused', 'sl_half'].map(async (id) => (await label(id).get()).exists));
check('every planned institute label is deleted, the unused one too', gone.every((e) => !e), JSON.stringify(gone));
const kept = await read(label('sl_kept'));
check('a label not in the plan stays an institute label', kept && !kept.boardId);
check('a board’s own label is left alone', (await read(label('sl_own')))?.boardId === B1);
check('a stopped run is finished: the card it missed moves', (await ids('sl_h2')) === JSON.stringify(['sl_half_sl_b2', 'sl_kept']), await ids('sl_h2'));
check('and what it had done stays', (await ids('sl_h1')) === JSON.stringify(['sl_half_sl_b1']) && (await read(label('sl_half_sl_b1')))?.boardId === B1);
const allCards = (await db.collection('cards').get()).docs.filter((d) => d.id.startsWith('sl_'));
const allLabels = new Set((await db.collection('labels').get()).docs.map((d) => d.id));
const dangling = allCards.flatMap((d) => d.data().labelIds.filter((id) => !allLabels.has(id)));
check('no card holds a label that does not exist', dangling.length === 0, JSON.stringify(dangling));
const strays = allCards.flatMap((d) =>
  d.data().labelIds.filter((id) => allLabels.has(id) && id.includes('_sl_b') && !id.endsWith(`_${d.data().boardId}`)),
);
check('no card holds another board’s copy', strays.length === 0, JSON.stringify(strays));
const mineNow = [...allLabels].filter((id) => id.startsWith('sl_')).sort();
const expected = [
  'sl_also_sl_b3', 'sl_case', 'sl_half_sl_b1', 'sl_half_sl_b2', 'sl_kept', 'sl_one_sl_b1', 'sl_own',
  'sl_spread_sl_b1', 'sl_spread_sl_b2', 'sl_spread_sl_b3', 'sl_twin_a', 'sl_twin_b',
].sort();
check('and no other label was made or lost', JSON.stringify(mineNow) === JSON.stringify(expected), JSON.stringify(mineNow));

// ---- Again: a finished run is reported as done and writes nothing ----------------
const settled = await world();
const again = run(plan(PLAN.filter((n) => n !== 'Rehearsal unused')), '--apply');
check(
  'a second run reports every label done and writes nothing',
  again.code === 0 &&
    /0 label\(s\) to make board labels, 4 done already: 0 board label\(s\) to create, 0 card\(s\) to rewrite\./.test(again.out) &&
    settled === (await world()),
  again.out,
);
// A deleted unused label leaves nothing to recognise it by, so naming it again
// reads as a mistyped name, and is refused like one.
const unused = run(plan(PLAN), '--apply');
check(
  'naming the deleted unused label again is refused, writing nothing',
  unused.code !== 0 && /"Rehearsal unused": no label has exactly this name/.test(unused.out) && settled === (await world()),
  unused.out,
);

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\nscope-labels: ${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
