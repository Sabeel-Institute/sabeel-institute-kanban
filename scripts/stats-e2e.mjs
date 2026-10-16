/**
 * The Stats chart, against a realistically DENSE dataset.
 *
 *   bash scripts/e2e.sh scripts/stats-e2e.mjs
 *
 * A focused suite, and one that seeds rather than earns its data. The full
 * `web-e2e.mjs` run produces a handful of cards on a single day, which draws one
 * bar and proves nothing about the case that actually breaks a chart: sixty
 * columns competing for a phone's width. So this writes a year of plausible
 * counters straight into `stats/**` with the Admin SDK — the same shape the
 * triggers produce — and then LOOKS at every view.
 *
 * Seeding server-side is not a shortcut around the rules: clients cannot write
 * these documents at all, by design, so the Admin SDK is the only way to stand
 * up a fixture.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { EMULATOR_PORTS, WEB_PORTS } from './lib/ports.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { agreeToRules } from './lib/rules.mjs';

/** First sign-ins that took the app's Try again (lib/signin.mjs), printed with the results. */
const tally = tryAgainTally();

const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${WEB_PORTS.e2e}/`;
const SHOTS = resolve(import.meta.dirname, '..', 'shots');
const PROJECT = 'demo-sabeel-kanban';

process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${EMULATOR_PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${EMULATOR_PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
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

// ---- Seed ------------------------------------------------------------------
initializeApp({ projectId: PROJECT });
const db = getFirestore();

const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
};

// Today per the app's own rule, so "in progress" lines up with what it renders.
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const PEOPLE = ['ann', 'bo', 'cy', 'di', 'ed'];
/** Everyone but `ed`, who exists only in the history — see the boards seed. */
const NAMED = PEOPLE.slice(0, 4);
/**
 * Boards to split the org-wide numbers across.
 *
 * The suite used to seed the `_all` scope ALONE, which was enough while the
 * screen only drew a chart and is not enough now: every bar drills down to a
 * per-board breakdown, and with no board scopes seeded that breakdown is
 * correctly empty — so the assertion would have been vacuous rather than
 * failing. Real boards are created too, because the breakdown resolves names
 * from board documents and navigates to them.
 */
const BOARDS = [
  { id: 'stats_b1', name: 'Fundraising 2026', share: 0.5 },
  { id: 'stats_b2', name: 'Operations', share: 0.3 },
  { id: 'stats_b3', name: 'Outreach', share: 0.2 },
];
const months = new Map();
/** Per-board month buckets, keyed `boardId`. */
const boardMonths = new Map(BOARDS.map((b) => [b.id, new Map()]));
let seededCards = 0;

// A year back, with weekends quiet and one deliberate import-sized spike, so the
// chart is exercised on the shape real data actually has rather than on noise.
for (let i = 364; i >= 0; i--) {
  const day = addDays(today, -i);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  // Deterministic pseudo-random, so a failure is reproducible.
  const r = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  const busy = Math.abs(r);
  if (weekend && busy < 0.7) continue;

  const created = i === 120 ? 45 : Math.round(busy * (weekend ? 2 : 9));
  if (created === 0 && busy < 0.4) continue;

  const key = day.slice(0, 7);
  const dd = day.slice(8, 10);
  if (!months.has(key)) months.set(key, {});
  const archivedCount = Math.round(busy * 4);
  const comments = Math.round(busy * 12);
  const actors = PEOPLE.slice(0, 1 + Math.floor(busy * 4));
  months.get(key)[dd] = {
    cardsCreated: created,
    cardsArchived: archivedCount,
    comments,
    filesAdded: busy > 0.8 ? 1 : 0,
    filesRemoved: busy > 0.95 ? 1 : 0,
    actors,
  };
  seededCards += created;

  /**
   * The same day, split across the boards — and split EXACTLY, with the
   * remainder going to the first board.
   *
   * The real triggers write both scopes from one event, so the per-board
   * numbers sum to the org-wide one by construction. A fixture that only
   * approximated that would make the breakdown's own "boards not listed"
   * residual fire on every bar and prove nothing about the code.
   */
  let leftCreated = created;
  let leftArchived = archivedCount;
  let leftComments = comments;
  BOARDS.forEach((b, idx) => {
    const last = idx === BOARDS.length - 1;
    const take = (total, left) => (last ? left : Math.min(left, Math.floor(total * b.share)));
    const c = take(created, leftCreated);
    const a = take(archivedCount, leftArchived);
    const m = take(comments, leftComments);
    leftCreated -= c;
    leftArchived -= a;
    leftComments -= m;
    const bm = boardMonths.get(b.id);
    if (!bm.has(key)) bm.set(key, {});
    bm.get(key)[dd] = {
      cardsCreated: c,
      cardsArchived: a,
      comments: m,
      // Everyone active org-wide was active on the first board, so the union
      // over boards still matches the org-wide set.
      actors: idx === 0 ? actors : [],
    };
  });
}

for (const [month, days] of months) {
  await db.doc(`stats/_all/months/${month}`).set({ scope: '_all', month, days });
}
for (const b of BOARDS) {
  for (const [month, days] of boardMonths.get(b.id)) {
    await db.doc(`stats/${b.id}/months/${month}`).set({ scope: b.id, month, days });
  }
  // A real board document, so the breakdown can name it and navigate to it —
  // and with member PROFILES, because that is the only place uid -> name comes
  // from: the screen reads names off the boards it has already loaded rather
  // than listing the directory.
  //
  // `ed` is deliberately left OUT of every board. Someone who acted and was
  // later removed stays in the history for good, and an admin can act on a
  // board they were never a member of, so the unresolvable case is ordinary
  // rather than exotic and the fallback has to be exercised.
  await db.doc(`boards/${b.id}`).set({
    name: b.name,
    description: '',
    archived: false,
    columns: [{ id: 'c1', name: 'To Do' }],
    columnIds: ['c1'],
    memberUids: NAMED,
    memberProfiles: Object.fromEntries(
      NAMED.map((uid) => [
        uid,
        { displayName: uid.toUpperCase(), email: `${uid}@oursabeel.com` },
      ]),
    ),
    activeCardCount: 0,
    createdAt: 1,
    createdBy: 'seed',
  });
}
await db.doc('stats/_all').set({ bytesStored: 3111887, filesStored: 4 }, { merge: true });
console.log(`  seeded ${months.size} month documents, ${seededCards} cards created`);

// ---- Drive -----------------------------------------------------------------
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();
let page;

/** Every axis label currently drawn, in order, with its x position and width. */
const labelBoxes = async (p) => {
  const texts = await p.locator('[data-testid="stats-axis"]').all();
  const out = [];
  for (const el of texts) {
    const box = await el.boundingBox();
    const text = (await el.textContent())?.trim() ?? '';
    if (box && text) out.push({ text, ...box });
  }
  return out;
};

/**
 * The widths to prove this at.
 *
 * A chart that is only ever looked at on the developer's monitor is a chart
 * that breaks on a phone. These span the real range: a small Android, ordinary
 * phones, a phone in landscape, tablets, and a wide desktop — including the
 * narrowest width the app supports, where there is least room for a label and
 * most temptation for one to collide.
 */
const WIDTHS = [320, 360, 390, 430, 600, 768, 1024, 1280, 1600];
/** Only a few are captured; the rest are checked, not photographed. */
const CAPTURE = new Set([320, 768, 1600]);

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('   page error:', String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'faisal', exact: true }).click();
  tally.note('faisal', await settle(page, page.getByText('Waiting for approval')));
  await grantAdmin('faisal@oursabeel.com');
  await agreeToRules(page);
  await page.getByRole('button', { name: 'More' }).waitFor({ timeout: 30000 });

  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.getByText('Stats', { exact: true }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);

  for (const width of WIDTHS) {
    // Resizing an already-open chart also exercises the relayout path, which is
    // what a phone rotating actually does — a fresh load at each size would
    // quietly skip it.
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(450);

    for (const view of ['Daily', 'Weekly', 'Monthly']) {
      await page.getByRole('radio', { name: view, exact: true }).click();
      await page.waitForTimeout(400);

      const boxes = await labelBoxes(page);
      const tag = `${width}px/${view}`;

      // NO OVERLAPPING TEXT. The one property a chart cannot be allowed to
      // fail, and the one that is invisible to every other kind of test.
      let overlaps = 0;
      const sorted = [...boxes].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].x < sorted[i - 1].x + sorted[i - 1].width - 0.5) overlaps++;
      }
      check(`${tag}: labels never overlap`, overlaps === 0, `${boxes.length} labels`);

      // And they must not be ellipsised.
      //
      // Checked by MEASURING, not by looking for "…" in the text: CSS renders
      // the ellipsis in pixels and leaves textContent whole, so the obvious
      // version of this check passed while the phone rendered "2…" for
      // "21 Jul". A test that cannot see the bug it is for is worse than none.
      const measured = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="stats-axis"]')]
          .filter((el) => el.textContent?.trim())
          .map((el) => ({ text: el.textContent, need: el.scrollWidth, have: el.clientWidth })),
      );
      const clipped = measured.filter((m) => m.need > m.have + 1);
      check(`${tag}: labels are not truncated`, clipped.length === 0,
        clipped.map((c) => `${c.text} needs ${c.need}`).join(', ').slice(0, 50));

      // NOT SLICED BY THE SCROLL EDGE. The overlap check passes happily while
      // the first label is cut in half by the scroller, because the element's
      // box is intact and only the pixels are gone — which turned "13 Jul" into
      // "3 Jul": a WRONG date, not a missing one.
      const plotBox = await page.locator('[data-testid="stats-plot"]').first().boundingBox();
      const sliced = boxes.filter(
        (b) =>
          b.x + b.width > plotBox.x &&
          b.x < plotBox.x + plotBox.width &&
          (b.x < plotBox.x - 0.5 || b.x + b.width > plotBox.x + plotBox.width + 0.5),
      );
      check(`${tag}: no label sliced by the scroll edge`,
        boxes.length > 0 && sliced.length === 0,
        sliced.map((c) => c.text).join(','));

      // Bars stay wide enough to hit, and the panel never scrolls sideways.
      // Counted, not just filtered: `filter(...).length === 0` is also true when
      // there are NO bars at all, so the check would pass on a blank chart —
      // the vacuous-assertion trap that let an empty bar satisfy an earlier
      // version of this suite.
      const bars = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="stats-bar"]')].map(
          (el) => el.getBoundingClientRect().width,
        ),
      );
      check(
        `${tag}: bars stay tappable`,
        bars.length > 0 && bars.every((w) => w >= 18),
        `${bars.length} bars, narrowest ${bars.length ? Math.min(...bars).toFixed(0) : 'n/a'}px`,
      );

      const bleeds = await page.evaluate(
        (w) => document.documentElement.scrollWidth > w + 1,
        width,
      );
      check(`${tag}: page never scrolls horizontally`, !bleeds);

      // At least one label, whatever the width — an axis with none is unreadable.
      check(`${tag}: the axis is labelled at all`, boxes.length > 0);

      // The month has to appear somewhere, or the numbers are unanchored.
      check(
        `${tag}: a month is named on the axis`,
        boxes.some((b) => /[A-Za-z]/.test(b.text)),
        boxes.map((b) => b.text).join(' ').slice(0, 46),
      );

      // CONTROL SPACING. The period chips and the metric chips answer two
      // different questions, and they have to look like it. They did not: every
      // child of `Screen` gets the same 8px gap, and the wrapped metric chips
      // sat 4px apart inside their own group — so all six read as one set, with
      // a filled chip in each looking like two selections in one control.
      //
      // Measured rather than eyeballed, and measured as a RATIO: absolute gaps
      // drift with the type scale, but "between groups is at least twice within
      // a group" is the property that actually makes them read as separate.
      const spacing = await page.evaluate(() => {
        const chips = [...document.querySelectorAll('[role="button"]')].filter((el) =>
          /(filter, (on|off))$/.test(el.getAttribute('aria-label') ?? ''),
        );
        const period = [...document.querySelectorAll('[role="radio"]')];
        if (chips.length < 6 || period.length !== 3) return null;
        const box = (el) => el.getBoundingClientRect();
        const metrics = chips.map(box);
        const periodBottom = Math.max(...period.map((el) => box(el).bottom));
        const metricTop = Math.min(...metrics.map((b) => b.top));
        // The largest vertical gap between wrapped rows WITHIN the metric group.
        const tops = [...new Set(metrics.map((b) => Math.round(b.top)))].sort((a, b) => a - b);
        const withinGroup =
          tops.length > 1
            ? tops[1] - Math.max(...metrics.filter((b) => Math.round(b.top) === tops[0]).map((b) => b.bottom))
            : null;
        // And the dropdown above must not crowd the first chip either.
        const picker = document.querySelector('[aria-label^="Board filter"]');
        return {
          betweenGroups: metricTop - periodBottom,
          withinGroup,
          belowPicker: Math.min(...period.map((el) => box(el).top)) - box(picker).bottom,
        };
      });
      check(`${tag}: chip groups are visibly separate`,
        spacing !== null && spacing.betweenGroups >= 12 &&
          (spacing.withinGroup === null || spacing.betweenGroups >= spacing.withinGroup * 1.8),
        spacing && `between ${Math.round(spacing.betweenGroups)}px, within ${
          spacing.withinGroup === null ? 'n/a' : Math.round(spacing.withinGroup)}px`);
      // The period control must not be another row of pills.
      const distinct = await page.evaluate(() => {
        const radios = [...document.querySelectorAll('[role="radio"]')];
        const group = document.querySelector('[role="radiogroup"]');
        if (!group || radios.length !== 3) return false;
        const g = group.getBoundingClientRect();
        // Segments sit flush inside ONE bordered object: no gaps between them.
        const xs = radios.map((r) => r.getBoundingClientRect()).sort((a, b) => a.x - b.x);
        const flush = xs.every((b, i) => i === 0 || b.x - xs[i - 1].right < 1.5);
        return flush && g.width < 220;
      });
      check(`${tag}: period is one segmented object, not chips`, distinct);

      check(`${tag}: chips clear the board dropdown`,
        spacing !== null && spacing.belowPicker >= 12,
        spacing && `${Math.round(spacing.belowPicker)}px`);

      if (CAPTURE.has(width)) {
        await page.screenshot({
          path: join(SHOTS, `stats-${width}-${view.toLowerCase()}.png`),
          fullPage: true,
        });
      }
    }
  }

  // Interaction: tap a bar, get its figure.
  const bar = page.getByLabel(/^[1-9]\d* cards created, /).first();
  await bar.click();
  await page.waitForTimeout(300);
  check(
    'tapping a bar reads it out',
    await page.getByText(/^\d+ cards created · /).first().isVisible().catch(() => false),
  );

  // ---- The breakdown under a selected bar ---------------------------------
  // Only present WHILE a bar is selected: with nothing selected the same panel
  // would have to cover the whole loaded year, which is a different question.
  {
    const boardRow = page.getByRole('button', { name: /^Open Fundraising 2026, \d+$/ });
    check(
      'a selected bar breaks down into boards',
      await boardRow.first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false),
    );

    // Biggest first. Fundraising takes the largest share in the fixture, so it
    // must lead — an unsorted list would put whichever read resolved first.
    const rows = await page
      .getByRole('button', { name: /^Open .+, \d+$/ })
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const values = rows.map((r) => Number(r.match(/, (\d+)$/)?.[1] ?? 0));
    check(
      'boards are ranked biggest first',
      values.length > 1 && values.every((v, i) => i === 0 || values[i - 1] >= v),
      rows.join(' | '),
    );

    // The rows must ADD UP to the bar. The real triggers write the per-board
    // and all-boards counters from one event, so a shortfall would mean the
    // breakdown was reading something else — and the panel's own residual row
    // would appear.
    // The panel's own heading says what the LIST is ("By board · …"), not what
    // the bar was, so this matches the readout above the chart and nothing else.
    const readout = (await page.getByText(/^\d+ cards created · /).first().textContent()) ?? '';
    const barValue = Number(readout.match(/^(\d+)/)?.[1] ?? -1);
    const summed = values.reduce((a, b) => a + b, 0);
    check(
      'the board rows add up to the bar above them',
      barValue > 0 && summed === barValue,
      `${summed} of ${barValue}`,
    );
    check(
      'so nothing is reported as unattributed',
      !(await page.getByText('Boards not listed').isVisible().catch(() => false)),
    );

    /**
     * The bar in the month that is STILL RUNNING.
     *
     * Its own case, because the current month is the one the cache refuses to
     * store — the chart is live so today's bar moves, and a frozen breakdown
     * under a moving bar would be the worst kind of wrong. A first version of
     * that rule read its result back out of the cache it had just declined to
     * write, so every breakdown of a current-month bar came back empty while
     * looking perfectly plausible. Only the panel's unattributed row said
     * otherwise.
     */
    await page.getByRole('radio', { name: 'Monthly' }).click();
    await page.waitForTimeout(500);
    const thisMonth = page.getByLabel(/^[1-9]\d* cards created, .*still in progress$/).first();
    if (await thisMonth.isVisible().catch(() => false)) {
      await thisMonth.click();
      await page.waitForTimeout(1200);
      const liveRows = await page
        .getByRole('button', { name: /^Open .+, \d+$/ })
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      const liveValues = liveRows.map((r) => Number(r.match(/, (\d+)$/)?.[1] ?? 0));
      const liveReadout =
        (await page.getByText(/^\d+ cards created · /).first().textContent()) ?? '';
      const liveBar = Number(liveReadout.match(/^(\d+)/)?.[1] ?? -1);
      check(
        'the month in progress breaks down too, and still adds up',
        liveBar > 0 && liveValues.reduce((a, b) => a + b, 0) === liveBar,
        `${liveValues.reduce((a, b) => a + b, 0)} of ${liveBar}`,
      );
    }
    await page.getByRole('radio', { name: 'Daily' }).click();
    await page.waitForTimeout(500);

    // Active people answers WHO, from uids already in hand — no read at all.
    await page.getByRole('button', { name: 'Active people filter, off' }).click();
    await page.waitForTimeout(400);
    check(
      'switching metric clears the selection rather than describing a bar that is gone',
      !(await page
        .getByRole('button', { name: /^Open .+, \d+$/ })
        .first()
        .isVisible()
        .catch(() => false)),
    );
    await page.getByLabel(/^[1-9]\d* people active, /).first().click();
    await page.waitForTimeout(400);
    check(
      'active people names the people, not a count',
      await page
        .getByText('ANN')
        .first()
        .waitFor({ timeout: 20000 })
        .then(() => true)
        .catch(() => false),
    );
    // The names come from board member profiles, and that misses routinely:
    // anyone removed from a board stays in its history, and an admin can act
    // on a board they were never a member of. A uid is never shown raw.
    check(
      'a uid with no profile falls back to words rather than an id',
      !(await page.getByText('ed', { exact: true }).isVisible().catch(() => false)),
    );

    await page.screenshot({ path: join(SHOTS, 'stats-drilldown.png'), fullPage: true });
  }

  // A phone width, where the panel is furthest below the fold and most likely
  // to be the thing nobody sees.
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, 'stats-drilldown-320.png'), fullPage: true });

  /**
   * EVERY selection brings the panel into view, not just the first.
   *
   * At 320x568 the chart already reaches the fold, so the breakdown appended
   * below it is entirely off-screen and the screen has to scroll to it. Driven
   * by `onLayout` alone that works exactly ONCE: the event fires on mount and on
   * layout CHANGE, so a second bar whose panel comes out the same shape — the
   * same three board rows, which is the ordinary case rather than a corner —
   * never fires it, and the tap looks like it did nothing at all.
   *
   * So two bars are tapped, from a scroll position reset in between, and the
   * pair is chosen to have the SAME value where the fixture offers one: equal
   * bars give equal-length lists, which is precisely the case a layout-driven
   * scroll cannot see.
   */
  {
    await page.getByRole('button', { name: 'Cards created filter, off' }).click();
    await page.waitForTimeout(600);

    const bars = page.getByLabel(/^[1-9]\d* cards created, /);
    const labels = await bars.evaluateAll((els) =>
      els.map((e) => e.getAttribute('aria-label') ?? ''),
    );
    const valueAt = (i) => Number(labels[i].match(/^(\d+)/)?.[1] ?? 0);
    // Prefer a pair of equal bars; fall back to the last two, which still tests
    // the second selection even if it cannot guarantee identical geometry.
    let pair = [labels.length - 2, labels.length - 1];
    const seen = new Map();
    for (let i = 0; i < labels.length; i++) {
      const v = valueAt(i);
      if (seen.has(v)) {
        pair = [seen.get(v), i];
        break;
      }
      seen.set(v, i);
    }

    // The scroller is a react-native-web ScrollView — a div with its own
    // overflow — so `window.scrollY` is always 0 here and the container has to
    // be found by which element actually moved.
    // `reduce`, not `Math.max(...array)`: spreading a node list into a call is
    // bounded by the engine's argument limit, and a page that grew past it would
    // fail as a RangeError from a helper rather than as the check it serves.
    const scrolled = () =>
      page.evaluate(() => {
        let top = 0;
        for (const e of document.querySelectorAll('*')) top = Math.max(top, e.scrollTop);
        return top;
      });
    const toTop = () =>
      page.evaluate(() => {
        for (const e of document.querySelectorAll('*')) if (e.scrollTop > 0) e.scrollTop = 0;
      });

    const revealed = [];
    for (const idx of labels.length >= 2 ? pair : []) {
      await toTop();
      await page.waitForTimeout(300);
      await bars.nth(idx).click();
      await page.waitForTimeout(1500);
      revealed.push(await scrolled());
    }
    check(
      'every bar selection scrolls the breakdown into view, not only the first',
      revealed.length === 2 && revealed.every((y) => y > 0),
      `${revealed.join(', ')} px (bars ${pair.join(' then ')}, values ${pair
        .map(valueAt)
        .join('/')})`,
    );
  }

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
