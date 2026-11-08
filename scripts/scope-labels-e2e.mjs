/**
 * `scripts/scope-labels.mjs`, rehearsed end to end.
 *
 *   npm run test:emulator    # its rules pass runs this, after migration-e2e
 *
 * The script runs by hand against production once, so nothing else exercises
 * it. This drives it as a real subprocess, since its refusals ARE exit codes, on
 * the cases that would otherwise go wrong quietly: a label on one board, one on
 * three, one on no card, one already scoped, a card on which TWO planned labels
 * both move to copies, an archived card, and a plan that is wrong in each way
 * the script must refuse.
 *
 * Needs firestore only, and no Functions emulator: with triggers running, the
 * card rewrites would add history this file would have to reason about.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PORTS, PROJECT } from './lib/emulators.mjs';

process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
process.env.GCLOUD_PROJECT = PROJECT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
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

const ADMIN = 'sl_admin';
const MEMBER = 'sl_member';
const label = (id) => db.doc(`labels/${id}`);
const card = (id) => db.doc(`cards/${id}`);
const read = async (ref) => (await ref.get()).data();

async function seed() {
  await db.doc(`users/${ADMIN}`).set({ email: 'sl-admin@oursabeel.com', role: 'admin', status: 'active' });
  await db.doc(`users/${MEMBER}`).set({ email: 'sl-member@oursabeel.com', role: 'member', status: 'active' });
  for (const [id, name] of [
    ['sl_b1', 'Rehearsal One'],
    ['sl_b2', 'Rehearsal Two'],
    ['sl_b3', 'Rehearsal Three'],
    ['sl_dup1', 'Rehearsal Twin'],
    ['sl_dup2', 'Rehearsal Twin'],
  ]) {
    await db.doc(`boards/${id}`).set({ name, memberUids: [ADMIN], boardOwnerUids: [ADMIN], archived: false });
  }
  const l = (id, name, extra = {}) =>
    label(id).set({ name, color: '#83114F', createdAt: 1, createdBy: '', ...extra });
  await l('sl_single', 'Rehearsal single');
  await l('sl_spread', 'Rehearsal spread');
  await l('sl_unused', 'Rehearsal unused');
  await l('sl_done', 'Rehearsal done', { boardId: 'sl_b2' });
  await l('sl_wide', 'Rehearsal wide');
  await l('sl_also', 'Rehearsal also');
  await l('sl_twin_a', 'Rehearsal twin');
  await l('sl_twin_b', 'Rehearsal twin');
  await l('sl_tie', 'Rehearsal tie');
  await l('sl_clash', 'Rehearsal clash');
  // A member's own label on b2, named like the institute one in other capitals.
  await l('sl_clash_own', 'rehearsal CLASH', { boardId: 'sl_b2' });
  const c = (id, boardId, labelIds, archived = false) =>
    card(id).set({ boardId, title: id, labelIds, archived, updatedBy: MEMBER, updatedAt: 1 });
  await c('sl_c1', 'sl_b1', ['sl_single', 'sl_wide']);
  // The spread label: three cards on b1, two on b2 (one archived), two on b3, so
  // b1 keeps it by count alone. sl_a0 sorts first and is on b2, so taking the
  // first board read instead of the most-used one is caught.
  await c('sl_a0', 'sl_b2', ['sl_spread']);
  await c('sl_c2', 'sl_b1', ['sl_spread']);
  await c('sl_c3', 'sl_b1', ['sl_spread', 'sl_single']);
  await c('sl_c9', 'sl_b1', ['sl_spread']);
  await c('sl_c4', 'sl_b2', ['sl_spread', 'sl_wide'], true);
  await c('sl_c5', 'sl_b3', ['sl_spread']);
  // TWO planned labels that both move to a copy on this card: b1 keeps both.
  await c('sl_c6', 'sl_b1', ['sl_also']);
  await c('sl_c7', 'sl_b1', ['sl_also']);
  await c('sl_c8', 'sl_b3', ['sl_also', 'sl_spread', 'sl_wide']);
  // One card each on two boards: nothing to choose by.
  await c('sl_t1', 'sl_b1', ['sl_tie']);
  await c('sl_t2', 'sl_b2', ['sl_tie']);
  await c('sl_k1', 'sl_b1', ['sl_clash']);
  await c('sl_k2', 'sl_b2', ['sl_clash']);
}

await seed();
const CARDS = ['sl_a0', 'sl_c1', 'sl_c2', 'sl_c3', 'sl_c4', 'sl_c5', 'sl_c6', 'sl_c7', 'sl_c8', 'sl_c9'];
const snapshot = async () => JSON.stringify(await Promise.all(CARDS.map((id) => read(card(id)))));
const before = await snapshot();
const ACTOR = ['--actor', 'sl-admin@oursabeel.com'];

// ---- Refusals: each exits non-zero and writes nothing ------------------------
const refusals = [
  ['an unknown option', [plan([{ label: 'Rehearsal single' }]), '--force']],
  ['a missing plan file', [join(dir, 'nope.json')]],
  ['a plan that is not JSON', [plan('{not json')]],
  ['an empty plan', [plan([])]],
  ['an entry with an unknown key', [plan([{ label: 'Rehearsal single', boards: 'x' }])]],
  ['a label named twice', [plan([{ label: 'Rehearsal single' }, { label: 'Rehearsal single' }])]],
  ['a name that matches no label', [plan([{ label: 'rehearsal single' }])]],
  ['a name two institute labels share', [plan([{ label: 'Rehearsal twin' }])]],
  ['a board nobody has', [plan([{ label: 'Rehearsal single', board: 'No Such Board' }])]],
  ['a board name two boards share', [plan([{ label: 'Rehearsal single', board: 'Rehearsal Twin' }])]],
  ['a label on no card, with no board named', [plan([{ label: 'Rehearsal unused' }])]],
  ['a tie between two boards, with no board named', [plan([{ label: 'Rehearsal tie' }])]],
  ['a board that already has its own label of that name', [plan([{ label: 'Rehearsal clash', board: 'Rehearsal One' }])]],
  ['applying with no --actor', [plan([{ label: 'Rehearsal spread' }])]],
  ['an --actor who is not an admin', [plan([{ label: 'Rehearsal spread' }]), '--actor', 'sl-member@oursabeel.com']],
];
for (const [what, args] of refusals) {
  const r = run(...args, '--apply');
  check(`refuses ${what}`, r.code !== 0, r.out.trim().split('\n').pop());
}
check('no refusal wrote to a card', (await snapshot()) === before);
check('no refusal scoped a label', !(await read(label('sl_spread'))).boardId && !(await read(label('sl_single'))).boardId);

// ---- A dry run reports and writes nothing -------------------------------------
const good = plan([
  { label: 'Rehearsal single' },
  { label: 'Rehearsal spread' },
  { label: 'Rehearsal unused', board: 'Rehearsal Three' },
  { label: 'Rehearsal done' },
  { label: 'Rehearsal also' },
]);
const dry = run(good);
check('a dry run succeeds without --actor', dry.code === 0, dry.out.trim().split('\n').pop());
check('and names what each board gets', /copy for Rehearsal Two: 2 card/.test(dry.out) && /copy for Rehearsal Three: 2 card/.test(dry.out), dry.out);
// sl_a0, sl_c4, sl_c5 and sl_c8: sl_c8 holds two planned labels and is one card.
check('and counts cards, not card-label pairs', /5 label\(s\), 4 card\(s\) to move/.test(dry.out), dry.out.trim().split('\n').pop());
check('and writes nothing', !(await read(label('sl_spread'))).boardId && !(await label('sl_spread_sl_b2').get()).exists);

// ---- Apply --------------------------------------------------------------------
const applied = run(good, ...ACTOR, '--apply');
check('applying succeeds', applied.code === 0, applied.out.trim().split('\n').pop());
check('a label on one board is scoped to it', (await read(label('sl_single'))).boardId === 'sl_b1');
check('a spread label stays with the board that uses it most', (await read(label('sl_spread'))).boardId === 'sl_b1');
const copy2 = await read(label('sl_spread_sl_b2'));
const copy3 = await read(label('sl_spread_sl_b3'));
check('every other board gets a copy of its own', copy2?.boardId === 'sl_b2' && copy3?.boardId === 'sl_b3');
check('a copy keeps the name, colour and history fields', copy2?.name === 'Rehearsal spread' && copy2?.color === '#83114F' && copy2?.createdAt === 1 && copy2?.createdBy === '');
check('cards on the keeping board are not touched', (await read(card('sl_c2'))).updatedBy === MEMBER && (await read(card('sl_c3'))).updatedBy === MEMBER);
const c4 = await read(card('sl_c4'));
check('an archived card moves to its board’s copy', JSON.stringify(c4.labelIds) === JSON.stringify(['sl_spread_sl_b2', 'sl_wide']), JSON.stringify(c4.labelIds));
check('and the change names the admin, and is dated', c4.updatedBy === ADMIN && c4.updatedAt > 1);
check('a card elsewhere moves too', JSON.stringify((await read(card('sl_c5'))).labelIds) === JSON.stringify(['sl_spread_sl_b3']));
const c8 = (await read(card('sl_c8'))).labelIds;
check(
  'a card carrying two planned labels ends with both copies',
  JSON.stringify(c8) === JSON.stringify(['sl_also_sl_b3', 'sl_spread_sl_b3', 'sl_wide']),
  JSON.stringify(c8),
);
check('an unused label goes to the board named', (await read(label('sl_unused'))).boardId === 'sl_b3');
check('a label already a board’s is taken up, not duplicated', (await read(label('sl_done'))).boardId === 'sl_b2' && /"Rehearsal done" → Rehearsal Two \(already given; finishing\)/.test(applied.out));
check('a label not in the plan stays an institute label', !(await read(label('sl_wide'))).boardId);
check('and reports what it moved', /Applied: 4 card\(s\) moved/.test(applied.out), applied.out.trim().split('\n').pop());

// ---- Again, after the world moved on --------------------------------------------
// A card that picked up the original on another board after the run (an old
// app does that), on b3, whose copy a member has since renamed: the next run
// must move the card onto that copy and leave the copy's name alone.
await label('sl_spread_sl_b3').update({ name: 'Spread on three', color: '#3E6B8A' });
await card('sl_late').set({ boardId: 'sl_b3', title: 'late', labelIds: ['sl_spread', 'sl_wide'], archived: false, updatedBy: MEMBER, updatedAt: 1 });
const again = run(good, ...ACTOR, '--apply');
check('a second run succeeds', again.code === 0, again.out.trim().split('\n').pop());
check('and moves a card labelled since', JSON.stringify((await read(card('sl_late'))).labelIds) === JSON.stringify(['sl_spread_sl_b3', 'sl_wide']));
const renamed = await read(label('sl_spread_sl_b3'));
check('and leaves a renamed copy as it was', renamed.name === 'Spread on three' && renamed.color === '#3E6B8A');
const settled = await snapshot();
const third = run(good, ...ACTOR, '--apply');
check('a third run succeeds and changes nothing', third.code === 0 && settled === (await snapshot()) && /Applied: 0 card/.test(third.out), third.out.trim().split('\n').pop());
const elsewhere = run(plan([{ label: 'Rehearsal spread', board: 'Rehearsal Two' }]), ...ACTOR, '--apply');
check('refuses to give a label to a second board', elsewhere.code !== 0, elsewhere.out.trim().split('\n').pop());

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\nscope-labels: ${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
