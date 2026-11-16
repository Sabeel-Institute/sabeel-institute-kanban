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

/** Every card on the wide board: its column, and the lane heading it sits under (null: none). */
function placement(page) {
  return page.evaluate(() => {
    const out = {};
    for (const list of document.querySelectorAll('[data-testid^="column-cards-"]')) {
      const column = list.getAttribute('data-testid').slice('column-cards-'.length);
      let lane = null;
      for (const el of list.querySelectorAll('[role="heading"], [data-testid^="card-"]')) {
        if (el.getAttribute('role') === 'heading') {
          lane = (el.getAttribute('aria-label') || '').split(',')[0];
        } else {
          out[el.getAttribute('data-testid').slice('card-'.length)] = { column, lane };
        }
      }
    }
    return out;
  });
}

/** The cards of one lane in one column, in the order drawn (lane null: No lane). */
async function laneOrder(page, column, lane) {
  return page.evaluate(
    ([col, want]) => {
      const list = document.querySelector(`[data-testid="column-cards-${col}"]`);
      const out = [];
      let current = null;
      for (const el of list.querySelectorAll('[role="heading"], [data-testid^="card-"]')) {
        if (el.getAttribute('role') === 'heading') current = (el.getAttribute('aria-label') || '').split(',')[0];
        else if ((current === 'No lane' ? null : current) === want) out.push(el.getAttribute('data-testid').slice(5));
      }
      return out;
    },
    [column, lane],
  );
}

/** Whether a drop bar is drawn inside one lane's group of a column right now. */
function barIn(page, column, lane) {
  return page.evaluate(
    ([col, name]) => {
      const h = [...document.querySelectorAll(`[data-testid="column-cards-${col}"] [role="heading"]`)].find((el) => {
        const label = el.getAttribute('aria-label') || '';
        return label === name || label.startsWith(`${name},`);
      });
      // No heading is a broken page, not a pass.
      if (!h) throw new Error(`no ${name} heading in ${col}`);
      let group = h;
      while (group.parentElement && !group.parentElement.matches(`[data-testid="column-cards-${col}"]`)) group = group.parentElement;
      return [...group.querySelectorAll('div')].some((d) => getComputedStyle(d).height === '3px');
    },
    [column, lane],
  );
}

/** A lane heading's words, as a screen reader hears it: name, finished of total, late. */
async function heading(page, lane) {
  const h = page.locator(`[role="heading"][aria-label^="${lane},"]`).first();
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
    await page.getByRole('button', { name: 'Boards' }).first().click();
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
  const addCard = async (title, lane) => {
    await page.getByRole('button', { name: '+ Add card' }).first().click();
    if (lane) await page.getByLabel('Lane', { exact: true }).selectOption({ label: lane });
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
    (await page.locator('[role="heading"][aria-label]').count()) === 0 &&
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
  const toDoHeadings = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="column-cards-In Progress"] [role="heading"]')].map(
      (h) => h.getAttribute('aria-label').split(',')[0],
    ),
  );
  check(
    'every column lists every lane, holding cards or not, and No lane last',
    toDoHeadings.join(',') === 'Supplies,Planning,Marketing,No lane',
    toDoHeadings.join(','),
  );

  // Without a lane: the form stays, says why, and adds nothing.
  await page.getByRole('button', { name: '+ Add card' }).first().click();
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
  await page.waitForTimeout(1500);
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
    for (const el of document.querySelectorAll('[role="heading"], [data-testid^="card-"], div')) {
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
    '[data-testid="column-cards-In Progress"] [role="heading"][aria-label^="Supplies,"]',
  );
  check(
    'a card dragged onto a lane heading in another column lands in that lane and column',
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
    await page.waitForTimeout(250);
    check('a card with a lane over a card in No lane draws no bar in No lane', !(await barIn(page, 'To Do', 'No lane')));
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

  // ---- A refused add keeps its form ---------------------------------------------
  // The rules check a new card's column against the board's `columnIds`
  // mirror; with To Do taken out of it, the board still draws To Do and the
  // add is refused.
  {
    const boardDoc = (await db.collection('boards').where('name', '==', BOARD).get()).docs[0];
    const bd = boardDoc.data();
    const todo = bd.columns.find((c) => c.name === 'To Do').id;
    await boardDoc.ref.update({ columnIds: bd.columnIds.filter((id) => id !== todo) });
    await page.getByRole('button', { name: '+ Add card' }).first().click();
    await page.getByPlaceholder('Card title').fill('Refused card');
    await page.getByLabel('Lane', { exact: true }).selectOption({ label: 'Planning' });
    await page.getByRole('button', { name: 'Add card', exact: true }).click();
    await page.waitForTimeout(3000);
    const kept = await page.getByPlaceholder('Card title').inputValue().catch(() => null);
    const lane = await page.getByLabel('Lane', { exact: true }).inputValue().catch(() => null);
    check(
      'a card the rules refuse leaves the form open, its title and lane still in it',
      kept === 'Refused card' && Boolean(lane) && (await page.locator('[data-testid="card-Refused card"]').count()) === 0,
      `title ${kept}, lane ${lane}`,
    );
    await boardDoc.ref.update({ columnIds: bd.columnIds });
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
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
  const moved = await cardId('Order the books');
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
    (await page.locator('[role="heading"][aria-label]').count()) === 0 &&
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
  // A new last column, made the finished one, then deleted from the board: the
  // confirmation says which column becomes finished, and that one is written,
  // so adding a column afterwards does not move it again.
  {
    await settingsPage('Columns');
    await fillThen(page, 'New column name', 'Wrap-up', (o) =>
      page.getByRole('button', { name: 'Add column' }).click(o),
    );
    await page.getByRole('button', { name: 'Rename column Wrap-up' }).waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Lanes', exact: true }).click();
    await page.getByLabel('Finished cards are in', { exact: true }).selectOption({ label: 'Wrap-up' });
    await page.waitForTimeout(1200);
    await back();
    await page.getByRole('button', { name: 'Delete column Wrap-up' }).click();
    const note = page.getByText(/count as finished instead/);
    check(
      'deleting the finished column says which column becomes finished',
      await note.waitFor({ timeout: 10000 }).then(
        async () => /“Wrap-up”.*“Done” count as finished/.test(await note.innerText()),
        () => false,
      ),
    );
    await page.getByRole('button', { name: 'Delete column', exact: true }).click();
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
