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
  const c = (id, boardId, labelIds, archived = false) =>
    card(id).set({ boardId, title: id, labelIds, archived, updatedBy: MEMBER, updatedAt: 1 });
  await c('sl_c1', 'sl_b1', ['sl_single', 'sl_wide']);
  // The spread label: two cards on b1, one on b2 (archived) and one on b3, so b1 keeps it.
  await c('sl_c2', 'sl_b1', ['sl_spread']);
  await c('sl_c3', 'sl_b1', ['sl_spread', 'sl_single']);
  await c('sl_c4', 'sl_b2', ['sl_spread', 'sl_wide'], true);
  await c('sl_c5', 'sl_b3', ['sl_spread']);
  // TWO planned labels that both move to a copy on this card: b1 keeps both
  // (sl_c6 and sl_c7 there), so this b3 card must end with both copies.
  await c('sl_c6', 'sl_b1', ['sl_also']);
  await c('sl_c7', 'sl_b1', ['sl_also']);
  await c('sl_c8', 'sl_b3', ['sl_also', 'sl_spread', 'sl_wide']);
}

await seed();
const CARDS = ['sl_c1', 'sl_c2', 'sl_c3', 'sl_c4', 'sl_c5', 'sl_c6', 'sl_c7', 'sl_c8'];
const snapshot = async () => JSON.stringify(await Promise.all(CARDS.map((id) => read(card(id)))));
const before = await snapshot();

// ---- Refusals: each exits non-zero and writes nothing ------------------------
const refusals = [
  ['an unknown option', [plan([{ label: 'Rehearsal single' }]), '--force']],
  ['a missing plan file', [join(dir, 'nope.json')]],
  ['a plan that is not JSON', [plan('{not json')]],
  ['an empty plan', [plan([])]],
  ['an entry with an unknown key', [plan([{ label: 'Rehearsal single', boards: 'x' }])]],
  ['a label named twice', [plan([{ label: 'Rehearsal single' }, { label: 'Rehearsal single' }])]],
  ['a name that matches no label', [plan([{ label: 'rehearsal single' }])]],
  ['a name two labels share', [plan([{ label: 'Rehearsal twin' }])]],
  ['a board nobody has', [plan([{ label: 'Rehearsal single', board: 'No Such Board' }])]],
  ['a board name two boards share', [plan([{ label: 'Rehearsal single', board: 'Rehearsal Twin' }])]],
  ['a label on no card, with no board named', [plan([{ label: 'Rehearsal unused' }])]],
  ['cards to move with no --actor', [plan([{ label: 'Rehearsal spread' }])]],
  ['an --actor who is not an admin', [plan([{ label: 'Rehearsal spread' }]), '--actor', 'sl-member@oursabeel.com']],
];
for (const [what, args] of refusals) {
  const r = run(...args, '--apply');
  check(`refuses ${what}`, r.code !== 0, r.out.trim().split('\n').pop());
}
const untouched = await snapshot();
check('no refusal wrote to a card', untouched === before);
check('no refusal scoped a label', !(await read(label('sl_spread'))).boardId && !(await read(label('sl_single'))).boardId);

// ---- A dry run reports and writes nothing -------------------------------------
const good = plan([
  { label: 'Rehearsal single' },
  { label: 'Rehearsal spread' },
  { label: 'Rehearsal unused', board: 'Rehearsal Three' },
  { label: 'Rehearsal done' },
  { label: 'Rehearsal also' },
]);
const dry = run(good, '--actor', 'sl-admin@oursabeel.com');
check('a dry run succeeds', dry.code === 0, dry.out.trim().split('\n').pop());
check('and names what each board gets', /copy for Rehearsal Two: 1 card/.test(dry.out) && /copy for Rehearsal Three: 1 card/.test(dry.out), dry.out);
check('and writes nothing', !(await read(label('sl_spread'))).boardId && !(await label('sl_spread_sl_b2').get()).exists);

// ---- Apply --------------------------------------------------------------------
const applied = run(good, '--actor', 'sl-admin@oursabeel.com', '--apply');
check('applying succeeds', applied.code === 0, applied.out.trim().split('\n').pop());
check('a label on one board is scoped to it', (await read(label('sl_single'))).boardId === 'sl_b1');
check('a spread label stays with the board that uses it most', (await read(label('sl_spread'))).boardId === 'sl_b1');
const copy2 = await read(label('sl_spread_sl_b2'));
const copy3 = await read(label('sl_spread_sl_b3'));
check('every other board gets a copy of its own', copy2?.boardId === 'sl_b2' && copy3?.boardId === 'sl_b3');
check('a copy keeps the name and colour', copy2?.name === 'Rehearsal spread' && copy2?.color === '#83114F');
check('cards on the keeping board are not touched', (await read(card('sl_c2'))).updatedBy === MEMBER && (await read(card('sl_c3'))).updatedBy === MEMBER);
const c4 = await read(card('sl_c4'));
check('an archived card moves to its board’s copy', JSON.stringify(c4.labelIds) === JSON.stringify(['sl_spread_sl_b2', 'sl_wide']), JSON.stringify(c4.labelIds));
check('and the change names the admin', c4.updatedBy === ADMIN);
check('a card elsewhere moves too', JSON.stringify((await read(card('sl_c5'))).labelIds) === JSON.stringify(['sl_spread_sl_b3']));
const c8 = (await read(card('sl_c8'))).labelIds;
check(
  'a card carrying two planned labels ends with both copies',
  JSON.stringify(c8) === JSON.stringify(['sl_also_sl_b3', 'sl_spread_sl_b3', 'sl_wide']),
  JSON.stringify(c8),
);
check('an unused label goes to the board named', (await read(label('sl_unused'))).boardId === 'sl_b3');
check('a label already scoped is left alone', (await read(label('sl_done'))).boardId === 'sl_b2' && /already on Rehearsal Two; skipped/.test(applied.out));
check('a label not in the plan stays an institute label', !(await read(label('sl_wide'))).boardId);

// ---- Again: nothing left to do --------------------------------------------------
const after = await snapshot();
const again = run(good, '--actor', 'sl-admin@oursabeel.com', '--apply');
check('a second run succeeds', again.code === 0, again.out.trim().split('\n').pop());
check('and changes nothing', after === (await snapshot()));

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\nscope-labels: ${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
