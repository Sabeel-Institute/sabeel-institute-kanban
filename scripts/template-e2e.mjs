/**
 * The template mark, driven as an owner would at a desk.
 *
 *   bash scripts/e2e.sh scripts/template-e2e.mjs
 *
 * A focused suite: a board marked on its General page moves under Templates
 * in the Boards list with a badge; it clones by right-click like any board; the
 * clone is not marked and its history opens with one line, "cloned from"; the
 * mark comes off; and an archived template keeps its badge under Archived.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { PORTS } from './lib/emulators.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { agreeToRules } from './lib/rules.mjs';

const tally = tryAgainTally();
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORTS.web}/`;

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

const TEMPLATE = 'Camp template';
const CLONE = 'Camp 2027';

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page error', false, String(e).slice(0, 120)));
  page.on('dialog', (d) => void d.accept());
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'faisal', exact: true }).click();
  tally.note('faisal', await settle(page, page.getByText('Waiting for approval')));
  await grantAdmin('faisal@oursabeel.com');
  await agreeToRules(page);
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 30000 });

  const boards = async () => {
    await page.getByRole('button', { name: 'Boards' }).first().click();
    await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
  };
  /** The heading a board's row sits under in the Boards list, read from the page. */
  const sectionOf = (name) =>
    page.evaluate((boardName) => {
      let heading = null;
      for (const el of document.querySelectorAll('div')) {
        if (el.children.length !== 0) continue;
        const text = (el.textContent || '').trim();
        if (['Starred', 'Recent', 'All boards', 'Boards', 'Templates'].includes(text)) heading = text;
        if (text === boardName) return heading;
      }
      return undefined;
    }, name);
  const generalSwitch = () => page.getByRole('switch', { name: 'This board is a template' });

  await page.getByRole('button', { name: 'New board' }).click();
  await fillThen(page, page.getByPlaceholder('Board name'), TEMPLATE, (o) =>
    page.getByRole('button', { name: 'Create', exact: true }).click(o),
  );
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Board settings' }).click();
  await generalSwitch().click();
  await page.getByText(/^Listed under Templates/).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  check(
    'marking a board is in its history',
    await page
      .getByText(/ marked the board as a template ·/)
      .waitFor({ timeout: 25000 })
      .then(() => true, () => false),
  );

  await boards();
  check('a marked board is listed under Templates', (await sectionOf(TEMPLATE)) === 'Templates', String(await sectionOf(TEMPLATE)));
  check('with a Template badge on its row', await page.getByText('Template', { exact: true }).first().isVisible());

  // ---- Cloned by right-click, like any board --------------------------------------
  await page.getByText(TEMPLATE, { exact: true }).first().click({ button: 'right' });
  const name = page.getByLabel('Name of the clone');
  await name.waitFor({ timeout: 15000 });
  await name.fill(CLONE);
  await page.getByRole('button', { name: 'Clone', exact: true }).click();
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Board settings' }).click();
  check('a clone of a template is not marked', (await generalSwitch().getAttribute('aria-checked')) === 'false');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByText(/ cloned this board from “Camp template” ·/).waitFor({ timeout: 25000 });
  // The "cloned" line is written with the board; a "created" line, if the
  // history trigger wrote one, would come later. So a later change is made and
  // its line awaited first, and the history then watched a while: the
  // emulator runs triggers in parallel, so the creation's is not sure to have
  // finished first.
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await generalSwitch().click();
  await page.getByText(/^Listed under Templates/).waitFor({ timeout: 15000 });
  await generalSwitch().click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  const later = await page
    .getByText(/ took the template mark off the board ·/)
    .waitFor({ timeout: 25000 })
    .then(() => true, () => false);
  let created = 0;
  for (let i = 0; later && i < 10 && created === 0; i += 1) {
    created = await page.getByText(/ created the board ·/).count();
    if (created === 0) await page.waitForTimeout(300);
  }
  check(
    'and its history opens with one line, where it was cloned from',
    later && created === 0,
    later ? 'a created line is there' : 'the later line never came',
  );
  await boards();
  // Named positively: "not under Templates" would pass as well for a row not
  // drawn at all. Just opened, the clone is under Recent.
  check('the clone is listed with the boards, not the templates', (await sectionOf(CLONE)) === 'Recent', String(await sectionOf(CLONE)));

  // ---- Unmarked ---------------------------------------------------------------------
  await page.getByText(TEMPLATE, { exact: true }).first().click();
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Board settings' }).click();
  await generalSwitch().click();
  await page.getByText(/^A board people clone/).waitFor({ timeout: 15000 });
  await boards();
  check(
    'unmarked, it leaves Templates, and the heading goes with the last one',
    (await sectionOf(TEMPLATE)) === 'Recent' &&
      (await page.getByText('Templates', { exact: true }).count()) === 0,
    String(await sectionOf(TEMPLATE)),
  );

  // ---- Archived, a template keeps its badge -------------------------------------------
  await page.getByText(TEMPLATE, { exact: true }).first().click();
  await page.getByText('To Do').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Board settings' }).click();
  await generalSwitch().click();
  await page.getByText(/^Listed under Templates/).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Archive board' }).click();
  await page.getByRole('button', { name: 'New board' }).waitFor({ timeout: 25000 });
  await page.getByRole('button', { name: /^Archived \(/ }).click();
  await page.getByText(TEMPLATE, { exact: true }).first().waitFor({ timeout: 15000 });
  check(
    'an archived template is under Archived, not Templates, and keeps its badge',
    (await page.getByText('Templates', { exact: true }).count()) === 0 &&
      (await page.getByText('Template', { exact: true }).first().isVisible()),
  );
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
