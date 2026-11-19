/**
 * Lanes and the finished column, driven as a person would at a desk.
 *
 *   bash scripts/e2e.sh scripts/lanes-e2e.mjs
 *
 * A focused suite: one board taken from no lanes, through switching them on,
 * adding and reordering them, filing cards, moving them by card, by drag and
 * in bulk, finishing one, and switching lanes off and on again, with the
 * board's and the card's history checked on the way. What a phone draws is the
 * width sweep's (`screens-e2e.mjs`); this is behaviour.
 *
 * Where a card sits is read from the page, not assumed: each column's list is
 * walked in document order, and a card belongs to the last lane heading
 * before it (`placement`).
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PORTS, PROJECT } from './lib/emulators.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { agreeToRules } from './lib/rules.mjs';

const tally = tryAgainTally();
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORTS.web}/`;
const SHOTS = resolve(import.meta.dirname, '..', 'shots');

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

const BOARD = 'Lanes Program';
const OTHER = 'Plain Board';
const PAST = '2020-01-01';

/**
 * Every card on the wide board: its column, and its lane: the lane's name,
 * 'No lane', or null on a board without lanes. Without lanes the board draws
 * columns (`column-cards-<name>`); with them, a grid of cells, each saying its
 * lane and column (`lane-cell`, `data-lane` '' for No lane).
 */
function placement(page) {
  return page.evaluate(() => {
    const out = {};
    const take = (root, column, lane) => {
      for (const el of root.querySelectorAll('[data-testid^="card-"]')) {
        out[el.getAttribute('data-testid').slice('card-'.length)] = { column, lane };
      }
    };
    for (const list of document.querySelectorAll('[data-testid^="column-cards-"]')) {
      take(list, list.getAttribute('data-testid').slice('column-cards-'.length), null);
    }
    for (const cell of document.querySelectorAll('[data-testid="lane-cell"]')) {
      take(cell, cell.dataset.column, cell.dataset.lane || 'No lane');
    }
    return out;
  });
}

/** One lane's cell in one column (lane null or 'No lane': No lane). Throws when the grid has none. */
function cellSelector(column, lane) {
  const name = lane === null || lane === 'No lane' ? '' : lane;
  return `[data-testid="lane-cell"][data-column="${column}"][data-lane="${name}"]`;
}

/** The cards of one lane in one column, in the order drawn (lane null: No lane). */
async function laneOrder(page, column, lane) {
  return page.evaluate((sel) => {
    const cell = document.querySelector(sel);
    if (!cell) throw new Error(`no cell ${sel}`);
    return [...cell.querySelectorAll('[data-testid^="card-"]')].map((el) => el.getAttribute('data-testid').slice(5));
  }, cellSelector(column, lane));
}

/** Whether a drop bar is drawn inside one lane's cell of a column right now. */
function barIn(page, column, lane) {
  return page.evaluate((sel) => {
    const cell = document.querySelector(sel);
    // No cell is a broken page, not a pass.
    if (!cell) throw new Error(`no cell ${sel}`);
    return !!cell.querySelector('[data-testid="drop-bar"]');
  }, cellSelector(column, lane));
}

/** A lane heading's words, as a screen reader hears it: name, finished of total, late. */
async function heading(page, lane) {
  const h = page.locator(`[data-testid="lane-heading"][aria-label^="${lane},"]`).first();
  await h.waitFor({ timeout: 20000 });
  return h.getAttribute('aria-label');
}

/** Wait until the board shows `title` in `lane` (null: no heading) and `column`. */
async function placed(page, title, column, lane, ms = 20000) {
  const until = Date.now() + ms;
  let seen;
  while (Date.now() < until) {
    seen = (await placement(page))[title];
    if (seen && seen.column === column && seen.lane === lane) return true;
    await page.waitForTimeout(300);
  }
  console.log(`         ${title}: ${JSON.stringify(seen)}`);
  return false;
}

/**
 * An HTML5 drag between two elements found by aria-label, one event per task so
 * React's state from `dragstart` is in place before `dragover` reads it.
 * Playwright's dragTo() synthesises mouse events, which never start one.
 */
async function htmlDrag(page, fromSelector, toSelector) {
  const fire = (selector, type) =>
    page.evaluate(
      ([sel, t]) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`no element for ${sel}`);
        window.__dt ??= new DataTransfer();
        el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
        if (t === 'dragend') window.__dt = undefined;
      },
      [selector, type],
    );
  await fire(fromSelector, 'dragstart');
  await page.waitForTimeout(250);
  await fire(toSelector, 'dragover');
  await page.waitForTimeout(250);
  await fire(toSelector, 'drop');
  await fire(fromSelector, 'dragend');
  await page.waitForTimeout(1200);
}

/**
 * Fill a controlled field and act on it, filling again if the value is wiped
 * underneath: the previous write's snapshot can land just after the fill and
 * re-render the field empty, which leaves its button disabled. The seed's
 * `fillThen` (scripts/seed-emulators.mjs) has the full story.
 */
async function fillThen(page, placeholder, value, act) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.getByPlaceholder(placeholder).fill(value);
    try {
      await act({ timeout: 4000 });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`"${placeholder}" would not accept ${JSON.stringify(value)}`);
}

async function cardId(title) {
  const snap = await db.collection('cards').where('title', '==', title).get();
  return snap.docs[0];
}

await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();
const dialogs = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page error', false, String(e).slice(0, 120)));
  // Confirmations are accepted, and remembered for the checks that read them.
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
  await page.getByRole('button', { name: 'More' }).waitFor({ timeout: 30000 });

  const boards = async () => {
    await page.getByRole('button', { name: 'Boards', exact: true }).first().click();
    await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 20000 });
  };
  const newBoard = async (name) => {
    await boards();
    await page.getByRole('button', { name: 'New board' }).click();
    await fillThen(page, 'Board name', name, (o) =>
      page.getByRole('button', { name: 'Create', exact: true }).click(o),
    );
    await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  };
  const openBoard = async (name) => {
    await boards();
    await page.getByText(name, { exact: true }).first().click();
    await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  };
  // With a lane: the + on To Do's heading, which asks for the lane. Without
  // (a board with no lanes): the column's own + Add card.
  const addCard = async (title, lane) => {
    if (lane) {
      await page.getByRole('button', { name: 'Add a card to To Do', exact: true }).click();
      await page.getByLabel('Lane', { exact: true }).selectOption({ label: lane });
    } else {
      await page.getByRole('button', { name: '+ Add card' }).first().click();
    }
    await fillThen(page, 'Card title', title, async (o) => {
      await page.getByRole('button', { name: 'Add card', exact: true }).click(o);
      if (lane) await page.locator(`[data-testid="card-${title}"]`).waitFor(o);
    });
  };
  const settingsPage = async (name) => {
    await page.getByRole('button', { name: 'Board settings' }).click();
    await page.getByRole('button', { name, exact: true }).click();
  };
  const back = () => page.getByRole('button', { name: 'Back' }).first().click();
  const openCard = async (title) => {
    await page.locator(`[data-testid="card-${title}"]`).first().click();
    await page.getByRole('button', { name: 'Share card' }).waitFor({ timeout: 20000 });
  };

  // ---- A board without lanes is today's board -------------------------------
  await newBoard(OTHER);
  await newBoard(BOARD);
  await addCard('Before lanes');
  await page.locator('[data-testid="card-Before lanes"]').waitFor({ timeout: 20000 });
  check(
    'a board without lanes draws no lane headings, and Add card asks for none',
    (await page.locator('[data-testid="lane-heading"][aria-label]').count()) === 0 &&
      (await page.getByRole('button', { name: '+ Add card' }).first().click().then(
        () => page.getByLabel('Lane', { exact: true }).count(),
      )) === 0,
  );
  await page.keyboard.press('Escape');

  // ---- The Lanes page ---------------------------------------------------------
  await settingsPage('Lanes');
  await page.getByText('Off. The board is drawn as it always has been.').waitFor({ timeout: 20000 });
  await page.getByRole('switch', { name: 'Lanes on this board' }).click();
  await page.getByPlaceholder('New lane name').waitFor({ timeout: 20000 });
  for (const lane of ['Planning', 'Marketing', 'Supplies']) {
    await fillThen(page, 'New lane name', lane, (o) =>
      page.getByRole('button', { name: 'Add lane' }).click(o),
    );
    await page.getByRole('button', { name: `Rename lane ${lane}` }).waitFor({ timeout: 20000 });
  }
  check(
    'switching lanes on sets the finished column to the last one',
    (await page.getByLabel('Finished cards are in').inputValue()) ===
      (await page.getByLabel('Finished cards are in').locator('option', { hasText: 'Done' }).getAttribute('value')),
  );
  await fillThen(page, 'New lane name', 'planning', (o) =>
    page.getByRole('button', { name: 'Add lane' }).click(o),
  );
  check(
    'a second lane of the same name, in other capitals, is refused',
    await page
      .getByText('There is already a lane with that name.')
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false),
  );
  await page.getByPlaceholder('New lane name').fill('');

  await htmlDrag(page, '[aria-label="Rename lane Supplies"]', '[aria-label="Rename lane Planning"]');
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label^="Rename lane "]')].map((e) =>
      e.getAttribute('aria-label').slice('Rename lane '.length),
    ),
  );
  check('lanes are reordered by dragging', order.join(',') === 'Supplies,Planning,Marketing', order.join(','));
  check(
    'the list says lanes are on, how many, and where finished cards are',
    await page
      .getByText('On, 3 lanes. Finished cards are in Done')
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false),
  );

  await page.getByRole('button', { name: 'History', exact: true }).click();
  for (const line of [/ turned lanes on ·/, / added the lane “Planning” ·/, / reordered the lanes ·/]) {
    check(
      `the board's history says it: ${line.source.trim()}`,
      await page.getByText(line).first().waitFor({ timeout: 25000 }).then(() => true, () => false),
    );
  }
  await back();
  await page.getByText('To Do').first().waitFor({ timeout: 20000 });

  // ---- The board, with lanes --------------------------------------------------
  check('a card from before lanes is under No lane', await placed(page, 'Before lanes', 'To Do', 'No lane'));
  const grid = await page.evaluate(() => ({
    lanes: [...document.querySelectorAll('[data-testid="lane-heading"]')].map((h) => h.getAttribute('aria-label').split(',')[0]),
    cells: [...document.querySelectorAll('[data-testid="lane-cell"][data-column="In Progress"]')].map((c) => c.dataset.lane || 'No lane'),
    perColumnAdds: document.querySelectorAll('button, [role="button"]').length &&
      [...document.querySelectorAll('[role="button"], button')].filter((b) => (b.textContent || '').trim() === '+ Add card').length,
  }));
  check(
    'the board is a grid: each lane once, as a row, with a cell in every column, and No lane last',
    grid.lanes.join(',') === 'Supplies,Planning,Marketing,No lane' &&
      grid.cells.join(',') === 'Supplies,Planning,Marketing,No lane',
    JSON.stringify(grid),
  );
  check(
    'a lane board has no + Add card at the foot of its columns: a + on each heading instead',
    grid.perColumnAdds === 0 &&
      (await page.getByRole('button', { name: /^Add a card to / }).count()) === 3 + 3,
    `${grid.perColumnAdds} foot buttons`,
  );

  // Without a lane: the form stays, says why, and adds nothing.
  await page.getByRole('button', { name: 'Add a card to To Do', exact: true }).click();
  await fillThen(page, 'Card title', 'Book the hall', (o) =>
    page.getByRole('button', { name: 'Add card', exact: true }).click(o),
  );
  check(
    'Add card on a board with lanes is refused until a lane is chosen',
    (await page
      .getByText('Choose a lane for the card first.')
      .waitFor({ timeout: 10000 })
      .then(() => true, () => false)) &&
      (await page.locator('[data-testid="card-Book the hall"]').count()) === 0,
  );
  await page.getByLabel('Lane', { exact: true }).selectOption({ label: 'Planning' });
  await page.getByRole('button', { name: 'Add card', exact: true }).click();
  check('and then files the card in that lane', await placed(page, 'Book the hall', 'To Do', 'Planning'));
  await addCard('Design the flyer', 'Marketing');
  await addCard('Order the books', 'Supplies');
  check('cards are filed in the lane chosen', await placed(page, 'Order the books', 'To Do', 'Supplies'));
  check('a lane heading counts its cards', (await heading(page, 'Planning')) === 'Planning, 0 of 1 finished');
  await page.screenshot({ path: join(SHOTS, 'lanes-board.png'), fullPage: true });

  // ---- A card's lane, on the card --------------------------------------------
  await openCard('Book the hall');
  const laneOptions = await page.getByLabel('Lane', { exact: true }).locator('option').allTextContents();
  check(
    'the card offers its lane beside its column, and no "No lane" once it has one',
    laneOptions.join(',') === 'Supplies,Planning,Marketing',
    laneOptions.join(','),
  );
  await page.getByLabel('Lane', { exact: true }).selectOption({ label: 'Marketing' });
  check(
    'the card’s history records the lane change, by name',
    await page
      .getByText(/moved it to the Marketing lane/)
      .first()
      .waitFor({ timeout: 25000 })
      .then(() => true, () => false),
  );
  await back();
  check('the board shows it in its new lane', await placed(page, 'Book the hall', 'To Do', 'Marketing'));

  // ---- Finished --------------------------------------------------------------
  await openCard('Design the flyer');
  await page.getByLabel('Column', { exact: true }).selectOption({ label: 'Done' });
  await page.getByLabel('Due date').fill(PAST);
  // The date is on the card once Clear is offered, which only a set date has;
  // "not Overdue" before then would say nothing.
  await page.getByRole('button', { name: 'Clear', exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  check(
    'a finished card past its date is not overdue on the card',
    !(await page.getByText('Overdue', { exact: true }).isVisible().catch(() => false)),
  );
  await back();
  check('a card moved to the finished column', await placed(page, 'Design the flyer', 'Done', 'Marketing'));
  check(
    'is counted finished in its lane, and does not make it late',
    (await heading(page, 'Marketing')) === 'Marketing, 1 of 2 finished',
    await heading(page, 'Marketing'),
  );
  const flyer = await page.locator('[data-testid="card-Design the flyer"]').innerText();
  check('its face shows the date, not how late it is', flyer.includes('1 Jan 2020') && !/late/.test(flyer), flyer);

  await openCard('Book the hall');
  await page.getByLabel('Due date').fill(PAST);
  await page.waitForTimeout(1500);
  await back();
  check(
    'an unfinished card past its date makes its lane late',
    (await heading(page, 'Marketing')) === 'Marketing, 1 of 2 finished, a card is late',
    await heading(page, 'Marketing'),
  );

  // Search's Overdue chip: the unfinished card, not the finished one.
  await page.getByRole('button', { name: 'Search' }).first().click();
  await page.getByRole('button', { name: /^Overdue filter/ }).click();
  await page.locator('[data-testid="card-Book the hall"]').waitFor({ timeout: 20000 });
  check(
    'Search’s Overdue leaves a finished card out',
    (await page.locator('[data-testid="card-Design the flyer"]').count()) === 0,
  );
  await page.getByRole('button', { name: /^Overdue filter/ }).click();
  await openBoard(BOARD);

  // ---- A parent waits for its subtasks (#111) ------------------------------------
  // A parent and one open subtask, written straight in, in To Do, Marketing.
  // Every way of moving the parent to Done is refused in a notice (a dialog,
  // recorded here), and the parent stays where it was; once the subtask is
  // finished, the move goes. Then the subtask cannot be reopened while its
  // parent is finished or archived, by any path, until it is unlinked.
  {
    const boardDoc = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0];
    const bd = boardDoc.data();
    const col = (name) => bd.columns.find((c) => c.name === name).id;
    const marketing = bd.lanes.find((l) => l.name === 'Marketing').id;
    const by = bd.createdBy;
    const put = (title, extra) =>
      db.collection('cards').add({
        boardId: boardDoc.id, title, description: '', columnId: col('To Do'), rank: `y${title.length}`,
        laneId: marketing, priority: 'none', assigneeUids: [], subscriberUids: [], labelIds: [],
        archived: false, commentCount: 0,
        createdAt: Date.now(), createdBy: by, updatedAt: Date.now(), updatedBy: by, ...extra,
      });
    const parentRef = await put('Run the fair');
    const childRef = await put('Book the stalls', { parentId: parentRef.id });
    await page.locator('[data-testid="card-Run the fair"]').waitFor({ timeout: 20000 });
    const at = async (ref) => (await ref.get()).data();
    // Every notice the page raises, recorded; the page's own dialog handler
    // (set up with the page) accepts it, as a person would.
    const notices = [];
    const onDialog = (d) => {
      notices.push(d.message());
    };
    page.on('dialog', onDialog);
    const noticed = async (re, ms = 10000) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (notices.some((m) => re.test(m))) return true;
        await page.waitForTimeout(200);
      }
      return false;
    };
    const HELD = /“Run the fair” can’t go to Done while its subtask is still open: “Book the stalls”/;

    await htmlDrag(
      page,
      '[data-testid="card-Run the fair"]',
      '[data-testid="lane-cell"][data-column="Done"][data-lane="Marketing"]',
    );
    check(
      'a parent dragged to Done with a subtask open stays put, and a notice says why',
      (await noticed(HELD)) && (await at(parentRef)).columnId === col('To Do'),
    );

    notices.length = 0;
    await openCard('Run the fair');
    await page.getByLabel('Column', { exact: true }).selectOption({ label: 'Done' });
    const pickSaid = await noticed(HELD);
    await page.waitForTimeout(800);
    check(
      'and so does choosing Done on the card',
      pickSaid && (await at(parentRef)).columnId === col('To Do') &&
        (await page.getByLabel('Column', { exact: true }).inputValue()) === col('To Do'),
    );
    await back();

    notices.length = 0;
    await page.getByRole('checkbox', { name: 'Select Run the fair' }).click();
    await page.getByRole('button', { name: 'Move selected cards' }).click();
    await page.getByLabel('Destination column', { exact: true }).selectOption({ label: 'Done' });
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    const bulkSaid = await noticed(HELD);
    await page.waitForTimeout(800);
    check('and so does Move on the selection bar', bulkSaid && (await at(parentRef)).columnId === col('To Do'));
    // Out of Move (Cancel), then out of the selection (Clear selection), or a
    // tap on a card below would select it rather than open it.
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await page.getByRole('button', { name: 'Clear selection', exact: true }).click();

    // Its subtask finished, the parent goes.
    await childRef.update({ columnId: col('Done'), updatedAt: Date.now() });
    await page.waitForTimeout(1500);
    await openCard('Run the fair');
    await page.getByLabel('Column', { exact: true }).selectOption({ label: 'Done' });
    let moved = false;
    for (let i = 0; i < 40 && !moved; i += 1) {
      moved = (await at(parentRef)).columnId === col('Done');
      if (!moved) await page.waitForTimeout(250);
    }
    check('once its subtask is finished, the parent goes to Done', moved);
    await back();

    // No new open work under a finished parent: adding a subtask is refused,
    // its title kept, and linking an open card is refused; nothing written.
    const spareRef = await put('Hire a tent');
    await page.locator('[data-testid="card-Hire a tent"]').waitFor({ timeout: 20000 });
    const childrenOf = async (id) =>
      (await db.collection('cards').where('parentId', '==', id).get()).docs.filter((d) => !d.data().archived).length;
    const kidsBefore = await childrenOf(parentRef.id);
    notices.length = 0;
    await openCard('Run the fair');
    await page.getByLabel('New subtask title').fill('Order the banners');
    await page.getByRole('button', { name: 'Add subtask', exact: true }).click();
    const addSaid = await noticed(/A subtask can’t be added to “Run the fair”, which is finished\. To add open work under it, first move “Run the fair” out of Done/);
    await page.waitForTimeout(800);
    const titleKept = (await page.getByLabel('New subtask title').inputValue()) === 'Order the banners';
    notices.length = 0;
    await page.getByRole('button', { name: 'Link an existing card' }).click();
    await page.getByRole('button', { name: 'Link Hire a tent as a subtask' }).click();
    const linkSaid = await noticed(/“Hire a tent” can’t become a subtask of “Run the fair”, which is finished/);
    await page.waitForTimeout(800);
    check(
      'a finished parent takes no new subtask (its title kept) and no open card linked under it',
      addSaid &&
        titleKept &&
        linkSaid &&
        (await childrenOf(parentRef.id)) === kidsBefore &&
        !(await spareRef.get()).data().parentId,
      notices.join(' | '),
    );
    await page.getByLabel('New subtask title').fill('');
    await back();
    await spareRef.update({ archived: true, archivedAt: Date.now() });

    // Reopening the subtask under its finished parent: refused on the card.
    const REOPEN = (why) =>
      new RegExp(
        why === 'archived'
          ? '“Book the stalls” is a subtask of “Run the fair”, which is archived\\. Restore “Run the fair” first, or to reopen'
          : '“Book the stalls” is a subtask of “Run the fair”, which is finished\\. To reopen it, first unlink it',
      );
    notices.length = 0;
    await openCard('Book the stalls');
    await page.getByLabel('Column', { exact: true }).selectOption({ label: 'To Do' });
    const reopenSaid = await noticed(REOPEN('finished'));
    await page.waitForTimeout(800);
    check(
      'a finished subtask is not reopened while its parent is finished, and the notice says to unlink it',
      reopenSaid && (await at(childRef)).columnId === col('Done'),
      notices.join(' | '),
    );
    await back();

    // Under an archived parent, refused on a drag too. The parent is read
    // from its document, since an archived card is not on the board.
    await parentRef.update({ archived: true, archivedAt: Date.now(), updatedAt: Date.now() });
    await page.locator('[data-testid="card-Run the fair"]').waitFor({ state: 'detached', timeout: 20000 });
    notices.length = 0;
    await htmlDrag(
      page,
      '[data-testid="card-Book the stalls"]',
      '[data-testid="lane-cell"][data-column="To Do"][data-lane="Marketing"]',
    );
    check(
      'and not while its parent is archived, dragged or otherwise',
      (await noticed(REOPEN('archived'))) && (await at(childRef)).columnId === col('Done'),
      notices.join(' | '),
    );

    // Restoring it open from the archive under its finished parent: refused.
    await parentRef.update({ archived: false, columnId: col('Done'), updatedAt: Date.now() });
    await childRef.update({ archived: true, archivedAt: Date.now(), columnId: col('To Do'), updatedAt: Date.now() });
    await page.locator('[data-testid="card-Book the stalls"]').waitFor({ state: 'detached', timeout: 20000 });
    notices.length = 0;
    await page.getByRole('button', { name: 'Archived cards' }).click();
    await page.getByRole('button', { name: 'Restore Book the stalls to the board' }).click();
    const restoreSaid = await noticed(REOPEN('finished'));
    await page.waitForTimeout(800);
    check(
      'and restoring it from the archive into an open column is refused the same way',
      restoreSaid && (await at(childRef)).archived === true,
      notices.join(' | '),
    );
    await back();

    // Unlinked from its parent, it reopens.
    await childRef.update({ archived: false, columnId: col('Done'), updatedAt: Date.now() });
    await page.locator('[data-testid="card-Book the stalls"]').waitFor({ timeout: 20000 });
    await openCard('Book the stalls');
    await page.getByRole('button', { name: 'Unlink from parent card' }).click();
    let unlinked = false;
    for (let i = 0; i < 40 && !unlinked; i += 1) {
      unlinked = !(await at(childRef)).parentId;
      if (!unlinked) await page.waitForTimeout(250);
    }
    await page.getByLabel('Column', { exact: true }).selectOption({ label: 'To Do' });
    let reopened = false;
    for (let i = 0; i < 40 && !reopened; i += 1) {
      reopened = (await at(childRef)).columnId === col('To Do');
      if (!reopened) await page.waitForTimeout(250);
    }
    check('unlinked from its parent, it reopens', unlinked && reopened);
    await back();
    page.off('dialog', onDialog);

    // Out of the way of the checks below, which count this board's cards.
    await parentRef.update({ archived: true, archivedAt: Date.now() });
    await childRef.update({ archived: true, archivedAt: Date.now() });
    await openBoard(BOARD);
  }

  // ---- In bulk ----------------------------------------------------------------
  await page.getByRole('checkbox', { name: 'Select Order the books' }).click();
  await page.getByRole('checkbox', { name: 'Select Book the hall' }).click();
  await page.getByRole('button', { name: 'Assign selected cards' }).click();
  await page.getByRole('button', { name: 'Assign', exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.getByRole('checkbox', { name: 'Select Order the books' }).click();
  await page.getByRole('checkbox', { name: 'Select Book the hall' }).click();
  await page.getByRole('button', { name: 'Move selected cards' }).click();
  check(
    'Move offers a lane as well as a column on a board with lanes',
    (await page.getByLabel('Lane', { exact: true }).count()) === 1,
  );
  // Left by the ✕ at the top (named Cancel in a mode, and first), then opened
  // again: nothing the last Move chose is still chosen.
  await page.getByLabel('Lane', { exact: true }).selectOption({ label: 'Supplies' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await page.getByRole('button', { name: 'Move selected cards' }).click();
  check(
    'leaving Move by its ✕ forgets the lane it had chosen',
    (await page.getByLabel('Lane', { exact: true }).inputValue()) === '',
    await page.getByLabel('Lane', { exact: true }).inputValue(),
  );
  await page.getByLabel('Lane', { exact: true }).selectOption({ label: 'Planning' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  check(
    'a lane alone moves the selection into it and keeps each card in its column',
    (await placed(page, 'Order the books', 'To Do', 'Planning')) &&
      (await placed(page, 'Book the hall', 'To Do', 'Planning')),
  );

  // My Work: assigned cards are grouped by when they are due, and a finished
  // one is never Overdue. Assign the finished card too, then look.
  await openCard('Design the flyer');
  await page.getByRole('button', { name: /^Assign someone/ }).click();
  await page.getByRole('button', { name: /^Assign \w/ }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Done', exact: true }).click().catch(() => {});
  await page.getByRole('button', { name: 'My Work' }).first().click();
  await page.locator('[data-testid="card-Design the flyer"]').waitFor({ timeout: 20000 });
  const groups = await page.evaluate(() => {
    const out = {};
    let group = null;
    for (const el of document.querySelectorAll('[data-testid="lane-heading"], [data-testid^="card-"], div')) {
      const text = el.textContent || '';
      if (el.children.length === 0 && /^(Overdue|Finished|Today|Next 7 days|Later|No due date) \(\d+\)$/.test(text)) {
        group = text.replace(/ \(\d+\)$/, '');
      }
      const id = el.getAttribute('data-testid');
      if (id?.startsWith('card-')) out[id.slice(5)] = group;
    }
    return out;
  });
  check(
    'My Work files a finished card under Finished, never Overdue',
    groups['Design the flyer'] === 'Finished' && groups['Book the hall'] === 'Overdue',
    JSON.stringify(groups),
  );
  await openBoard(BOARD);

  // ---- Dragging into a lane -----------------------------------------------------
  await htmlDrag(
    page,
    '[data-testid="card-Before lanes"]',
    '[data-testid="lane-cell"][data-column="In Progress"][data-lane="Supplies"]',
  );
  check(
    'a card dragged into a lane’s cell in another column lands in that lane and column',
    await placed(page, 'Before lanes', 'In Progress', 'Supplies'),
  );

  // ---- Where in a lane a drop lands --------------------------------------------
  // Three cards in one lane and one in No lane, written straight in, ranked
  // after everything else in To Do.
  {
    const boardDoc = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0];
    const bd = boardDoc.data();
    const todo = bd.columns.find((c) => c.name === 'To Do').id;
    const supplies = bd.lanes.find((l) => l.name === 'Supplies').id;
    const by = bd.createdBy;
    const put = (title, rank, laneId) =>
      db.collection('cards').add({
        boardId: boardDoc.id, title, description: '', columnId: todo, rank,
        ...(laneId ? { laneId } : {}),
        priority: 'none', assigneeUids: [], subscriberUids: [], labelIds: [],
        archived: false, commentCount: 0,
        createdAt: Date.now(), createdBy: by, updatedAt: Date.now(), updatedBy: by,
      });
    await put('Drag A', 'xa', supplies);
    await put('Drag B', 'xb', supplies);
    await put('Drag C', 'xc', supplies);
    await put('Drag N', 'xd', null);
    await page.locator('[data-testid="card-Drag N"]').waitFor({ timeout: 20000 });
    const tail = async () => (await laneOrder(page, 'To Do', 'Supplies')).filter((t) => t.startsWith('Drag '));

    await htmlDrag(page, '[data-testid="card-Drag A"]', '[data-testid="card-Drag C"]');
    let order = await tail();
    check('a card dragged down its lane lands where the bar was, above the card it was over', order.join() === 'Drag B,Drag A,Drag C', order.join());

    // Over a card in No lane, a card with a lane is refused there: no bar in
    // No lane, and the drop takes it to the end of its own lane.
    const fire = (sel, type) =>
      page.evaluate(
        ([s, t]) => {
          window.__dt ??= new DataTransfer();
          document.querySelector(s).dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
          if (t === 'dragend') window.__dt = undefined;
        },
        [sel, type],
      );
    await fire('[data-testid="card-Drag B"]', 'dragstart');
    await page.waitForTimeout(250);
    await fire('[data-testid="card-Drag N"]', 'dragover');
    // The dragover took effect: refused by No lane, it fell to the column,
    // which draws the bar at the end of the card's own lane. Then none in
    // No lane means something.
    let drawn = false;
    for (let i = 0; i < 20 && !drawn; i += 1) {
      drawn = await barIn(page, 'To Do', 'Supplies');
      if (!drawn) await page.waitForTimeout(150);
    }
    check(
      'a card with a lane over a card in No lane draws no bar in No lane',
      drawn && !(await barIn(page, 'To Do', 'No lane')),
      drawn ? 'a bar in No lane' : 'no bar drawn anywhere',
    );
    await fire('[data-testid="card-Drag N"]', 'drop');
    await fire('[data-testid="card-Drag B"]', 'dragend');
    await page.waitForTimeout(1200);
    order = await tail();
    check(
      'and dropped there it goes to the end of its own lane',
      order.join() === 'Drag A,Drag C,Drag B' && (await laneOrder(page, 'To Do', null)).includes('Drag N'),
      order.join(),
    );
  }

  // ---- Collapsing lanes (#115) ----------------------------------------------------
  // Supplies holds Drag A, B and C in To Do and Before lanes in In Progress;
  // Drag N is in No lane. Folding a lane folds it in every column, keeps its
  // count, and is stored on the account.
  {
    const boardDoc = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0];
    const bd = boardDoc.data();
    const supplies = bd.lanes.find((l) => l.name === 'Supplies').id;
    const me = db.doc(`users/${bd.createdBy}`);
    const storedLanes = async (want, ms = 15000) => {
      const until = Date.now() + ms;
      for (;;) {
        const got = (await me.get()).data()?.collapsedLanes?.[boardDoc.id];
        if (want(got) || Date.now() > until) return got;
        await page.waitForTimeout(250);
      }
    };
    const suppliesHeads = page.locator('[data-testid="lane-heading"][aria-label^="Supplies,"]');
    const states = async (loc) =>
      loc.evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')));
    const visibleCards = (titles) =>
      Promise.all(titles.map((t) => page.locator(`[data-testid="card-${t}"]`).count())).then((n) =>
        n.reduce((a, b) => a + b, 0),
      );
    const SUPPLIES_CARDS = ['Drag A', 'Drag B', 'Drag C', 'Before lanes'];

    const shownBefore = await visibleCards(SUPPLIES_CARDS);
    // A card selected in the lane: folding hides it, so it leaves the
    // selection rather than riding along, unseen, in a bulk action.
    await page.getByRole('checkbox', { name: 'Select Drag A' }).click();
    const selectedFirst = await page.getByRole('button', { name: 'Clear selection', exact: true }).isVisible();
    await suppliesHeads.first().click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-testid="lane-heading"][aria-label^="Supplies,"]')].every((e) => e.getAttribute('aria-expanded') === 'false'),
      null,
      { timeout: 10000 },
    );
    const headsShut = await states(suppliesHeads);
    const counted = /finished|no cards/.test((await suppliesHeads.first().getAttribute('aria-label')) ?? '');
    // Folded, each cell says how many of the lane's cards it holds.
    const hereTo = (await page.locator(cellSelector('To Do', 'Supplies')).innerText()).trim();
    const hereIn = (await page.locator(cellSelector('In Progress', 'Supplies')).innerText()).trim();
    check(
      'a folded lane gives its count in each cell, and its selected cards leave the selection',
      selectedFirst &&
        hereTo === '3 cards' &&
        hereIn === '1 card' &&
        (await page.getByRole('button', { name: 'Clear selection', exact: true }).count()) === 0,
      `${hereTo} | ${hereIn}`,
    );
    check(
      'a lane folds across the board at once (one heading), keeping its count, and only its cards go',
      shownBefore === 4 &&
        headsShut.length === 1 &&
        headsShut.every((x) => x === 'false') &&
        counted &&
        (await visibleCards(SUPPLIES_CARDS)) === 0 &&
        (await visibleCards(['Drag N'])) === 1,
      `${shownBefore} shown before; headings ${JSON.stringify(headsShut)}`,
    );
    const saved = await storedLanes((g) => Array.isArray(g) && g.includes(supplies));
    // A reload starts on the Boards list (routes are not in the URL), so the
    // board is opened again, as a person would.
    await page.reload();
    await openBoard(BOARD);
    // The folded heading coming back is the board answering with the stored
    // choice; only then is a card's absence evidence.
    const back = await page
      .waitForFunction(
        () => {
          const hs = [...document.querySelectorAll('[data-testid="lane-heading"][aria-label^="Supplies,"]')];
          return hs.length > 0 && hs.every((e) => e.getAttribute('aria-expanded') === 'false');
        },
        null,
        { timeout: 30000 },
      )
      .then(() => true, () => false);
    check(
      'and stays folded after a reload, stored on the account',
      back && (saved ?? []).includes(supplies) && (await visibleCards(SUPPLIES_CARDS)) === 0,
      `stored ${JSON.stringify(saved)}`,
    );

    // A drop on a folded lane's heading lands first in the lane.
    await htmlDrag(
      page,
      '[data-testid="card-Drag N"]',
      '[data-testid="lane-cell"][data-column="To Do"][data-lane="Supplies"]',
    );
    const ranked = async () => {
      const snap = await db.collection('cards').where('boardId', '==', boardDoc.id).get();
      const inLane = snap.docs
        .map((d) => d.data())
        .filter((c) => !c.archived && c.columnId === bd.columns.find((x) => x.name === 'To Do').id && c.laneId === supplies)
        .sort((x, y) => (x.rank < y.rank ? -1 : 1));
      return inLane.map((c) => c.title);
    };
    let order = [];
    for (let i = 0; i < 40 && order[0] !== 'Drag N'; i += 1) {
      order = await ranked();
      if (order[0] !== 'Drag N') await page.waitForTimeout(250);
    }
    const dropOpened = await page
      .waitForFunction(
        () => [...document.querySelectorAll('[data-testid="lane-heading"][aria-label^="Supplies,"]')].every((e) => e.getAttribute('aria-expanded') === 'true'),
        null,
        { timeout: 10000 },
      )
      .then(() => true, () => false);
    check(
      'a card dropped on a folded lane lands first in it, and the lane opens to show it',
      order[0] === 'Drag N' && dropOpened && (await page.locator('[data-testid="card-Drag N"]').isVisible()),
      order.join(),
    );

    // Adding a card to a folded lane opens it, so the card is seen landing.
    await suppliesHeads.first().click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-testid="lane-heading"][aria-label^="Supplies,"]')].every((e) => e.getAttribute('aria-expanded') === 'false'),
      null,
      { timeout: 10000 },
    );
    await storedLanes((g) => Array.isArray(g) && g.includes(supplies));
    await addCard('Into the fold', 'Supplies');
    const opened = await storedLanes((g) => !(g ?? []).includes(supplies));
    check(
      'adding a card to a folded lane opens the lane, card in view',
      (await states(suppliesHeads)).every((x) => x === 'true') &&
        (await page.locator('[data-testid="card-Into the fold"]').isVisible()) &&
        !(opened ?? []).includes(supplies),
      `stored ${JSON.stringify(opened)}`,
    );

    // Collapse all, then expand all.
    const allHeads = page.locator('[data-testid="lane-heading"]');
    await page.getByRole('button', { name: 'Collapse all lanes' }).click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-testid="lane-heading"]')].every((e) => e.getAttribute('aria-expanded') === 'false'),
      null,
      { timeout: 10000 },
    );
    const allShut = await storedLanes((g) => Array.isArray(g) && g.includes(supplies) && g.length >= bd.lanes.length);
    const collapseOff = await page.getByRole('button', { name: 'Collapse all lanes' }).isDisabled();
    await page.getByRole('button', { name: 'Expand all lanes' }).click();
    await page.waitForFunction(
      () => [...document.querySelectorAll('[data-testid="lane-heading"]')].every((e) => e.getAttribute('aria-expanded') === 'true'),
      null,
      { timeout: 10000 },
    );
    const allOpen = await storedLanes((g) => g === undefined);
    check(
      'Collapse all folds every lane, and Expand all opens them and leaves nothing stored',
      (allShut ?? []).length >= bd.lanes.length &&
        collapseOff &&
        allOpen === undefined &&
        (await page.getByRole('button', { name: 'Expand all lanes' }).isDisabled()) &&
        (await allHeads.count()) > 0,
      `folded ${JSON.stringify(allShut)}, then ${JSON.stringify(allOpen)}`,
    );

    // On a phone the same controls sit in a row above the lanes.
    await page.setViewportSize({ width: 360, height: 800 });
    const phoneCollapse = page.getByRole('button', { name: 'Collapse all lanes' }).first();
    await phoneCollapse.waitFor({ timeout: 15000 });
    // By role: the pager draws every column, the ones off screen aria-hidden,
    // and a role lookup skips those.
    const head = page.getByRole('button', { name: /^Supplies,/ }).first();
    await head.click();
    const phoneShut = await page
      .waitForFunction(
        () => document.querySelector('[data-testid="lane-heading"][aria-label^="Supplies,"]')?.getAttribute('aria-expanded') === 'false',
        null,
        { timeout: 10000 },
      )
      .then(() => true, () => false);
    await page.screenshot({ path: join(SHOTS, 'lanes-folded-phone.png'), fullPage: true });
    await head.click();
    await page.getByRole('button', { name: 'Expand all lanes' }).first().click().catch(() => {});
    await storedLanes((g) => g === undefined);
    await page.setViewportSize({ width: 1280, height: 950 });
    await page.getByText('To Do').first().waitFor({ timeout: 20000 });
    check('on a phone, a lane folds from its heading, with the collapse controls above the lanes', phoneShut);
  }

  // ---- Watching a lane ------------------------------------------------------------
  // The bell beside a lane's name watches it: one bell per lane, the grid's
  // reason for being (2026-11-19), stored on the account as board/lane.
  {
    const boardDoc = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0];
    const bd = boardDoc.data();
    const supplies = bd.lanes.find((l) => l.name === 'Supplies').id;
    const me = db.doc(`users/${bd.createdBy}`);
    const key = `${boardDoc.id}/${supplies}`;
    const storedWatch = async (want, ms = 15000) => {
      const until = Date.now() + ms;
      for (;;) {
        const got = (await me.get()).data()?.watchedLanes ?? [];
        if (want(got) || Date.now() > until) return got;
        await page.waitForTimeout(250);
      }
    };
    const watch = page.getByRole('button', { name: 'Watch the Supplies lane', exact: true });
    const stop = page.getByRole('button', { name: 'Stop watching the Supplies lane', exact: true });
    const before = await watch.count();
    await watch.first().click();
    await stop.first().waitFor({ timeout: 10000 });
    const on = await storedWatch((g) => g.includes(key));
    const stops = await stop.count();
    await stop.first().click();
    await watch.first().waitFor({ timeout: 10000 });
    const off = await storedWatch((g) => !g.includes(key));
    check(
      'a lane is watched from its one bell, beside its name, and unwatched',
      before === 1 && stops === before && (await watch.count()) === before && on.includes(key) && !off.includes(key),
      `${before} bells; stored ${JSON.stringify(on)} then ${JSON.stringify(off)}`,
    );
  }

  // ---- A refused add keeps its form ---------------------------------------------
  // The rules check a new card's column against the board's `columnIds`
  // mirror; with To Do taken out of it, the board still draws To Do and the
  // add is refused.
  {
    const boardDoc = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0];
    const bd = boardDoc.data();
    const todo = bd.columns.find((c) => c.name === 'To Do').id;
    await boardDoc.ref.update({ columnIds: bd.columnIds.filter((id) => id !== todo) });
    // From the lane's +, which asks for the column, with none chosen.
    await page.getByRole('button', { name: 'Add a card to the Planning lane', exact: true }).click();
    const unchosen = await page.getByLabel('Column', { exact: true }).inputValue();
    await page.getByPlaceholder('Card title').fill('Refused card');
    await page.getByLabel('Column', { exact: true }).selectOption({ label: 'To Do' });
    await page.getByRole('button', { name: 'Add card', exact: true }).click();
    await page.waitForTimeout(3000);
    const kept = await page.getByPlaceholder('Card title').inputValue().catch(() => null);
    const column = await page.getByLabel('Column', { exact: true }).inputValue().catch(() => null);
    check(
      'a lane\'s + asks for a column, none chosen; a refused card reopens that form with its title and column',
      unchosen === '' &&
        kept === 'Refused card' &&
        column === todo &&
        (await page.getByRole('dialog', { name: 'New card in the Planning lane' }).count()) === 1 &&
        (await page.locator('[data-testid="card-Refused card"]').count()) === 0,
      `column first ${JSON.stringify(unchosen)}; title ${kept}, column ${column}`,
    );
    await boardDoc.ref.update({ columnIds: bd.columnIds });
    // The browser's form closes on Escape; it has no Cancel button.
    await page.getByPlaceholder('Card title').press('Escape');
  }

  // ---- The add form's ✕ ------------------------------------------------------------
  // A touch screen has no Escape key, so the floating form has its own close.
  {
    const form = page.getByRole('dialog', { name: 'New card in the Supplies lane' });
    await page.getByRole('button', { name: 'Add a card to the Supplies lane', exact: true }).click();
    await form.waitFor({ timeout: 10000 });
    await page.getByPlaceholder('Card title').fill('Never added');
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    check(
      "the add form's ✕ closes it, and adds nothing",
      (await form.count()) === 0 && (await page.locator('[data-testid="card-Never added"]').count()) === 0,
    );
  }

  // ---- Removing a lane -----------------------------------------------------------
  await settingsPage('Lanes');
  dialogs.length = 0;
  await page.getByRole('button', { name: 'Remove lane Planning' }).click();
  await page.waitForTimeout(800);
  check(
    'a lane that holds cards is not removed, and says why',
    /Cannot remove this lane[\s\S]*still has 2 cards/.test(dialogs.join('|')) &&
      (await page.getByRole('button', { name: 'Rename lane Planning' }).count()) === 1,
    dialogs.join(' | '),
  );
  await back();

  // ---- To another board ---------------------------------------------------------
  await page.getByRole('checkbox', { name: 'Select Order the books' }).click();
  await page.getByRole('button', { name: 'Copy or move to another board' }).click();
  await page.getByLabel('Destination board').selectOption({ label: OTHER });
  await page.getByLabel('Destination column').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.locator('[data-testid="card-Order the books"]').waitFor({ state: 'detached', timeout: 20000 });
  // The card leaves this board's view on the local write, before the server
  // has it: the stored card is read once it is on the other board.
  const otherId = (await db.collection('boards').where('name', '==', OTHER).get()).docs[0].id;
  let moved = await cardId('Order the books');
  for (let i = 0; i < 60 && moved?.data().boardId !== otherId; i += 1) {
    await page.waitForTimeout(250);
    moved = await cardId('Order the books');
  }
  check(
    'a card moved to another board leaves its lane behind',
    moved && !('laneId' in moved.data()),
    JSON.stringify(moved?.data().laneId),
  );

  // ---- Lanes off, and on again ----------------------------------------------------
  await settingsPage('Lanes');
  await page.getByRole('switch', { name: 'Lanes on this board' }).click();
  await page.getByText(/Its 3 lanes are kept for when you switch back\./).waitFor({ timeout: 20000 });
  await back();
  await page.locator('[data-testid="card-Book the hall"]').waitFor({ timeout: 20000 });
  const off = await placement(page);
  check(
    'lanes off: the board is drawn as it always was, every card still on it',
    (await page.locator('[data-testid="lane-heading"][aria-label]').count()) === 0 &&
      ['Before lanes', 'Book the hall', 'Design the flyer'].every((t) => off[t]),
    JSON.stringify(off),
  );
  const flyerOff = await page.locator('[data-testid="card-Design the flyer"]').innerText();
  check('lanes off: a card past its date in the last column is late again, as before', /late/.test(flyerOff), flyerOff);
  await settingsPage('Lanes');
  await page.getByRole('switch', { name: 'Lanes on this board' }).click();
  await page.getByRole('button', { name: 'Rename lane Planning' }).waitFor({ timeout: 20000 });
  await back();
  check(
    'lanes on again: every card is back in its lane',
    (await placed(page, 'Book the hall', 'To Do', 'Planning')) &&
      (await placed(page, 'Before lanes', 'In Progress', 'Supplies')) &&
      (await placed(page, 'Design the flyer', 'Done', 'Marketing')),
  );
  await page.screenshot({ path: join(SHOTS, 'lanes-board-end.png'), fullPage: true });

  // ---- Deleting the finished column --------------------------------------------
  // A new last column, made the finished one, then deleted in Board settings
  // → Columns: the confirmation says which column becomes finished, and that
  // one is written, so adding a column afterwards does not move it again.
  {
    await settingsPage('Columns');
    await fillThen(page, 'New column name', 'Wrap-up', (o) =>
      page.getByRole('button', { name: 'Add column' }).click(o),
    );
    await page.getByRole('button', { name: 'Rename column Wrap-up' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Lanes', exact: true }).click();
    await page.getByLabel('Finished cards are in', { exact: true }).selectOption({ label: 'Wrap-up' });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Columns', exact: true }).click();
    // The confirmation is a dialog, accepted and recorded by the page's handler.
    dialogs.length = 0;
    await page.getByRole('button', { name: 'Delete column Wrap-up' }).click();
    for (let i = 0; i < 50 && !dialogs.some((d) => /Delete “Wrap-up”\?/.test(d)); i += 1) {
      await page.waitForTimeout(200);
    }
    check(
      'deleting the finished column says which column becomes finished',
      dialogs.some((d) => /Delete “Wrap-up”\?[\s\S]*“Wrap-up”.*“Done” count as finished/.test(d)),
      dialogs.join(' | '),
    );
    const boardDoc = async () => (await db.collection('boards').where('name', '==', BOARD).get()).docs[0].data();
    let stored = null;
    for (let i = 0; i < 40; i += 1) {
      const d = await boardDoc();
      if (!d.columns.some((c) => c.name === 'Wrap-up')) {
        stored = d.columns.find((c) => c.id === d.doneColumnId)?.name ?? null;
        break;
      }
      await page.waitForTimeout(300);
    }
    check('and that column is written as the finished one', stored === 'Done', String(stored));
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
