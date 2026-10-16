/**
 * TYPING MUST NOT GET SLOWER AS A SCREEN GETS BUSIER.
 *
 *   bash scripts/e2e.sh scripts/typing-perf-e2e.mjs
 *
 * The bug this exists to prevent, in one sentence: a text draft held in a
 * SCREEN's state re-renders everything that screen draws on every keystroke, so
 * the cost of typing one character grows with the number of comments, cards or
 * columns on display. It shipped, and it was reported from a phone as "unusable
 * on Android, like a slide show on web" — measured at 45ms per character on a
 * card with 25 comments, a ceiling of about 22 characters per second.
 *
 * THIS ASSERTS A RATIO, NEVER A STOPWATCH READING.
 *
 * Absolute ms/char against a dev server on a shared runner moves by more than
 * 3x between runs, so any absolute threshold is either loose enough to catch
 * nothing or tight enough to go red at random — and a check people learn to
 * ignore is worse than no check at all (see `screens-e2e.mjs`: a tour that
 * cannot fail is a screenshot generator). The property that actually matters is
 * SCALE INVARIANCE: typing into a busy screen must cost about what typing into
 * an empty one costs. That is machine-independent, and it is exactly what
 * regresses when a draft is hoisted back into a screen.
 *
 * Ratios before the fix were 4-15x and are now near 1, so the 2.5 threshold sits
 * in open space and needs no tuning. Absolute figures are LOGGED every run
 * because they are useful, and gated on never.
 *
 * The seed is deliberately the smallest that still separates the two arms: CI
 * runs every e2e suite sequentially in one job, so this one's wall clock is
 * added to the whole pipeline's.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { EMULATOR_PORTS, WEB_PORTS } from './lib/ports.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { agreeToRules } from './lib/rules.mjs';

/** First sign-ins that took the app's Try again (lib/signin.mjs), printed with the results. */
const tally = tryAgainTally();

const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${WEB_PORTS.e2e}/`;
const ROOT = resolve(import.meta.dirname, '..');
const PROJECT = 'demo-sabeel-kanban';
process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${EMULATOR_PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${EMULATOR_PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

/** Above this, typing costs materially more on a busy screen than an empty one. */
const MAX_RATIO = 2.5;
/** Long enough to average out one slow frame, short enough to stay cheap. */
const SAMPLE = 'the quick brown fox jumps over it';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}

const browser = await chromium.launch();
const grant = (email) =>
  new Promise((res, rej) => {
    const c = spawn('node', [resolve(ROOT, 'scripts/grant-admin.mjs'), email], {
      env: { ...process.env },
      stdio: 'pipe',
    });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`grant-admin ${code}`))));
  });

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await p.getByRole('button', { name: 'faisal', exact: true }).click();
  tally.note('faisal', await settle(p, p.getByText('Waiting for approval')));
  await grant('faisal@oursabeel.com');
  await agreeToRules(p);
  await ctx.close();
}

initializeApp({ projectId: PROJECT });
const db = getFirestore();
const users = await db.collection('users').get();
const uid = users.docs.find((d) => d.data().email === 'faisal@oursabeel.com').id;
const now = Date.now();

const board = (id, name, columns, cardCount) =>
  db.doc(`boards/${id}`).set({
    name,
    description: '',
    archived: false,
    columns,
    columnIds: columns.map((c) => c.id),
    memberUids: [uid],
    boardOwnerUids: [uid],
    memberProfiles: { [uid]: { displayName: 'Faisal', email: 'faisal@oursabeel.com' } },
    activeCardCount: cardCount,
    createdAt: now,
    createdBy: uid,
  });

const card = (id, boardId, columnId, title, rank) =>
  db.doc(`cards/${id}`).set({
    boardId, title, description: '', columnId, rank,
    priority: 'none', assigneeUids: [], subscriberUids: [], labelIds: [], archived: false,
    commentCount: 0, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
  });

// ---- the seed: one busy board and one empty one ---------------------------
//
// Eight columns of twelve is enough that a per-keystroke re-render of the whole
// board is unmistakable, and small enough to write in a second.
const HEAVY_COLUMNS = Array.from({ length: 8 }, (_, i) => ({ id: `hc${i}`, name: `Column ${i + 1}` }));
await board('perf_heavy', 'Busy board', HEAVY_COLUMNS, 96);
await board('perf_light', 'Empty board', [{ id: 'lc0', name: 'To Do' }], 0);

{
  const writes = [];
  for (const col of HEAVY_COLUMNS) {
    for (let i = 0; i < 12; i += 1) {
      writes.push(card(`${col.id}_${i}`, 'perf_heavy', col.id, `Card ${col.id} ${i}`, `V${i}`));
    }
  }
  await Promise.all(writes);
}

// Both cards live on the EMPTY board: the card screen replaces the board, so
// what is behind it cannot contribute to the measurement either way.
await card('perf_card_heavy', 'perf_light', 'lc0', 'Busy card', 'V0');
await card('perf_card_light', 'perf_light', 'lc0', 'Quiet card', 'V1');
{
  const writes = [];
  for (let i = 0; i < 25; i += 1) {
    writes.push(
      db.collection('cards/perf_card_heavy/comments').add({
        authorUid: uid,
        body: `Comment number ${i} with enough words in it to render a real paragraph.`,
        mentionUids: [],
        createdAt: now - (25 - i) * 60000,
      }),
    );
  }
  await Promise.all(writes);
}

const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'faisal', exact: true }).click();
await page.getByRole('button', { name: 'More' }).waitFor({ timeout: 30000 });

async function openBoard(name) {
  await page.getByRole('button', { name: 'Boards', exact: true }).first().click();
  await page.getByText(name).first().click();
  await page.waitForTimeout(1200);
}

async function openCard(boardName, title) {
  await openBoard(boardName);
  await page.getByText(title).first().click();
  await page.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 25000 });
  await page.waitForTimeout(600);
}

/**
 * Cost of one character, in milliseconds.
 *
 * A warm-up pass is typed and thrown away first: the very first keystroke into
 * a freshly mounted editor pays for lazy work that has nothing to do with the
 * property being measured, and on the light arm — where the total is small —
 * that one-off is large enough to flatter the ratio.
 */
async function msPerChar(locator) {
  await locator.click();
  await page.keyboard.type('warm', { delay: 0 });
  const started = Date.now();
  await page.keyboard.type(SAMPLE, { delay: 0 });
  return (Date.now() - started) / SAMPLE.length;
}

function report(arm, heavy, light) {
  const ratio = heavy / light;
  console.log(
    `       ${arm}: heavy ${heavy.toFixed(1)} ms/char, light ${light.toFixed(1)} ms/char, ratio ${ratio.toFixed(2)}`,
  );
  check(
    `${arm}: typing does not slow down on a busy screen`,
    ratio < MAX_RATIO,
    `ratio ${ratio.toFixed(2)} exceeds ${MAX_RATIO} (heavy ${heavy.toFixed(1)}, light ${light.toFixed(1)} ms/char)`,
  );
}

// ---- arm 1: the add-card composer ----------------------------------------
async function addCardCost(boardName) {
  await openBoard(boardName);
  await page.getByRole('button', { name: '+ Add card' }).first().click();
  const input = page.getByPlaceholder('Card title');
  await input.waitFor({ timeout: 15000 });
  const cost = await msPerChar(input);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return cost;
}
report('add card', await addCardCost('Busy board'), await addCardCost('Empty board'));

// ---- arm 2: the comment composer -----------------------------------------
async function commentCost(title) {
  await openCard('Empty board', title);
  const box = page.locator('[data-testid="comment-editor"]');
  await box.waitFor({ timeout: 20000 });
  return msPerChar(box);
}
report('comment', await commentCost('Busy card'), await commentCost('Quiet card'));

// ---- arm 3: the description editor ---------------------------------------
//
// Green already — it is what the memoised lists on the card screen bought, and
// then what moving the draft into `CardDescription` made structural. It stays
// so that a re-hoist of THAT draft is caught by the same rule as the others.
async function descriptionCost(title) {
  await openCard('Empty board', title);
  await page.getByRole('button', { name: 'Edit description' }).click();
  const box = page.locator('[contenteditable="true"]').first();
  await box.waitFor({ timeout: 20000 });
  const cost = await msPerChar(box);
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await page.waitForTimeout(400);
  return cost;
}
report('description', await descriptionCost('Busy card'), await descriptionCost('Quiet card'));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`  ${tally.summary()}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log(`FAILED: ${f.name}`);
  process.exit(1);
}
