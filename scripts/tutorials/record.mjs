/**
 * RECORD THE HELP FILMS: each film in `TUTORIALS`, on a phone and on a
 * computer, narrated, as MP4 (H.264 + AAC) with WebVTT captions.
 *
 *   node scripts/tutorials/record.mjs --wav <dir of narration WAVs> --out <dir>
 *        [--only film-id,film-id] [--variant phone|computer]
 *
 * Needs the dev stack, as the manual's screenshots do: `scripts/dev.sh web`
 * (the emulators, the Expo dev server on the `web` port, and the seed whose
 * dev sign-ins make the accounts) — not an export, which draws no dev
 * sign-in row. And the narration rendered first (`tts.py`), because each step
 * lasts as long as its line: the action runs while the line is said, and the
 * next step waits for the line to end. See "The help films" in
 * docs/DEV-TOOLING.md.
 *
 * Every film starts in a freshly built guide world (`world.mjs`), signed in
 * off camera in a browser context of its own, so neither a world nor a cache
 * carries from one film to the next. What only a development build draws —
 * the dev sign-in row, the build stamp — is hidden; a touch is drawn as a
 * ripple and, on the computer, the pointer as a dot that moves to what it
 * clicks. The browser's own confirmation dialogs are drawn into the page,
 * since a dialog the browser draws is not in the video.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { HELP_VARIANTS, HELP_VIDEOS, addDays, todayInOrgTz } from '@sabeel/shared';
import { PORTS } from '../lib/emulators.mjs';
import { settle } from '../lib/signin.mjs';
import { TUTORIALS } from './tutorials.mjs';
import { lineId } from './lines.mjs';
import { buildWorld, setAccess } from './world.mjs';

const WEB = `http://127.0.0.1:${PORTS.web}/`;
/** Breath between one line and the next. */
const GAP_MS = 450;
/** Held after the last line, so a film does not cut off on its last word. */
const TAIL_MS = 1200;

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
if (!args.wav || !args.out) {
  console.error('usage: record.mjs --wav <dir> --out <dir> [--only a,b] [--variant phone|computer]');
  process.exit(2);
}
const WAV = resolve(args.wav);
const OUT = resolve(args.out);
const only = new Set((args.only ?? '').split(',').filter(Boolean));
if (args.variant && !HELP_VARIANTS.includes(args.variant)) {
  console.error(`--variant must be one of ${HELP_VARIANTS.join(', ')}, not ${args.variant}`);
  process.exit(2);
}
const variants = args.variant ? [args.variant] : HELP_VARIANTS;

// ONE LIST: every catalogued film is scripted, and nothing unscripted is filmed.
const scripted = new Set(TUTORIALS.map((t) => t.id));
const catalogued = new Set(HELP_VIDEOS.map((v) => v.id));
const missing = [...catalogued].filter((id) => !scripted.has(id));
const extra = [...scripted].filter((id) => !catalogued.has(id));
if (missing.length || extra.length) {
  console.error(`HELP_VIDEOS and TUTORIALS disagree — unscripted: ${missing.join(', ') || 'none'}; uncatalogued: ${extra.join(', ') || 'none'}`);
  process.exit(1);
}
// A step kept to one cut names a cut there is, or it would be in neither.
const strays = TUTORIALS.flatMap((t) => t.steps.filter((s) => s.cut && !HELP_VARIANTS.includes(s.cut)).map((s) => `${t.id}: ${s.cut}`));
if (strays.length) {
  console.error(`a step is kept to a cut there is not — ${strays.join(', ')}`);
  process.exit(1);
}
for (const id of only) {
  if (!scripted.has(id)) {
    console.error(`--only names no film: ${id}`);
    process.exit(2);
  }
}

/** Seconds of audio in a WAV, from ffprobe. */
const seconds = (path) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' }).trim());

/**
 * Drawn on the page that is filmed: the touch, the pointer, the browser's
 * confirmations, and nothing that only a development build shows.
 */
function overlay({ showPointer, permission }) {
  // The push nudge and the device panel read the browser's permission: "denied"
  // keeps the nudge out of every film but the notifications one.
  try {
    Object.defineProperty(window.Notification, 'permission', { get: () => permission, configurable: true });
  } catch {
    // No Notification here: nothing reads it either.
  }
  const ripple = (x, y) => {
    const r = document.createElement('div');
    r.className = '__tut-ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 700);
  };
  window.__tutRipple = ripple;
  /*
   * THE BROWSER'S CONFIRMATIONS, DRAWN. `window.confirm` is a dialog the
   * browser paints outside the page, so the video never shows it. Here it is
   * a card in the page that says what the app asked, and is answered OK —
   * which a film's script has already decided it wants.
   */
  const ask = (message, buttons) => {
    const back = document.createElement('div');
    back.className = '__tut-dialog';
    const box = document.createElement('div');
    const text = document.createElement('div');
    text.textContent = message;
    const row = document.createElement('div');
    row.className = '__tut-dialog-row';
    let ok = null;
    for (const label of buttons) {
      const b = document.createElement('div');
      b.textContent = label;
      b.className = label === 'OK' ? '__tut-dialog-ok' : '__tut-dialog-cancel';
      if (label === 'OK') ok = b;
      row.appendChild(b);
    }
    box.append(text, row);
    back.appendChild(box);
    document.body.appendChild(back);
    setTimeout(() => {
      const r = ok.getBoundingClientRect();
      ripple(r.left + r.width / 2, r.top + r.height / 2);
    }, 1700);
    setTimeout(() => back.remove(), 2300);
  };
  window.confirm = (message) => {
    ask(String(message ?? ''), ['Cancel', 'OK']);
    return true;
  };
  window.alert = (message) => ask(String(message ?? ''), ['OK']);

  const install = () => {
    if (document.getElementById('__tut-style')) return;
    const style = document.createElement('style');
    style.id = '__tut-style';
    style.textContent = `
      #__tut-dot { position: fixed; left: -100px; top: -100px; width: 22px; height: 22px; margin: -11px 0 0 -11px;
        border-radius: 50%; background: rgba(131,17,79,.22); border: 2px solid rgba(131,17,79,.9);
        pointer-events: none; z-index: 2147483647; }
      .__tut-ripple { position: fixed; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
        background: rgba(131,17,79,.32); pointer-events: none; z-index: 2147483647; animation: __tut-r .65s ease-out forwards; }
      @keyframes __tut-r { from { transform: scale(.4); opacity: 1 } to { transform: scale(1.7); opacity: 0 } }
      .__tut-box { position: fixed; border: 3px solid rgba(201,162,39,.95); border-radius: 12px;
        box-shadow: 0 0 0 5px rgba(201,162,39,.22); pointer-events: none; z-index: 2147483646; transition: opacity .35s; }
      .__tut-dialog { position: fixed; inset: 0; background: rgba(58,47,40,.38); display: flex; align-items: center;
        justify-content: center; z-index: 2147483645; pointer-events: none; font: 15px/1.45 system-ui, sans-serif; }
      .__tut-dialog > div { background: #FFFFFF; color: #3A2F28; border-radius: 14px; padding: 20px 22px 14px;
        width: min(86vw, 400px); box-shadow: 0 12px 40px rgba(0,0,0,.25); white-space: pre-wrap; }
      .__tut-dialog-row { display: flex; justify-content: flex-end; gap: 22px; margin-top: 16px; }
      .__tut-dialog-ok, .__tut-dialog-cancel { font-weight: 600; padding: 6px 4px; }
      .__tut-dialog-ok { color: #83114F; } .__tut-dialog-cancel { color: #6A5748; }
      [data-testid="dev-sign-in"] { display: none !important; }`;
    document.head.appendChild(style);
    if (showPointer) {
      const dot = document.createElement('div');
      dot.id = '__tut-dot';
      document.body.appendChild(dot);
      window.addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    }
    window.addEventListener('pointerdown', (e) => ripple(e.clientX, e.clientY), true);
    // The build stamp — "v0.13.3 · 4e4b771" on the sign-in screen and at the foot
    // of More — names whatever commit happened to be checked out.
    const hide = () => {
      for (const el of document.querySelectorAll('div')) {
        if (el.childElementCount === 0 && /(^|· )v\d+\.\d+\.\d+ · \S+$/.test(el.textContent ?? '')) el.style.visibility = 'hidden';
      }
    };
    new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
    hide();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
}

/** What a step's `do` is given: locators by what a person sees, and actions a viewer can follow. */
function helpers(page, variant, world) {
  const phone = variant === 'phone';
  const visible = (loc) => loc.filter({ visible: true }).first();
  const wait = (ms) => page.waitForTimeout(ms);
  async function center(loc) {
    await loc.waitFor({ timeout: 20000 });
    await loc.evaluate((e) => e.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }));
    await wait(450);
    const b = await loc.boundingBox();
    if (!b) throw new Error('element has no box');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  async function press(loc) {
    const { x, y } = await center(loc);
    if (phone) {
      await page.touchscreen.tap(x, y);
    } else {
      await page.mouse.move(x, y, { steps: 22 });
      await wait(160);
      await page.mouse.click(x, y);
    }
    await wait(550);
  }
  async function outline(loc) {
    const { x, y } = await center(loc);
    if (!phone) await page.mouse.move(x, y, { steps: 22 });
    await loc.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const box = document.createElement('div');
      box.className = '__tut-box';
      Object.assign(box.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
      document.body.appendChild(box);
      setTimeout(() => { box.style.opacity = '0'; }, 1900);
      setTimeout(() => box.remove(), 2300);
    });
    await wait(900);
  }
  const typeText = (text) => page.keyboard.type(text, { delay: 45 });
  const t = {
    page,
    phone,
    world,
    wait,
    // Locators, by what a person sees: a control's name, a field's label, words on screen.
    btn: (name) => visible(page.getByRole('button', { name, exact: typeof name === 'string' })),
    switch: (name) => visible(page.getByRole('switch', { name, exact: true })),
    radio: (name) => visible(page.getByRole('radio', { name, exact: true })),
    label: (name) => visible(page.getByLabel(name, { exact: true })),
    placeholder: (text) => visible(page.getByPlaceholder(text, { exact: true })),
    text: (text, exact = typeof text === 'string') => visible(page.getByText(text, { exact })),
    id: (testId) => visible(page.getByTestId(testId)),
    card: (title) => visible(page.getByTestId(`card-${title}`)),
    editor: () => visible(page.locator('[contenteditable="true"]')),
    /** One person's card on People: the innermost block holding both their access switch and the role buttons. */
    person: (name) =>
      page
        .locator('div')
        .filter({ has: page.getByRole('switch', { name: `Account access for ${name}`, exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Set role organizer', exact: true }) })
        .last(),
    // Actions.
    waitFor: (loc, timeout = 20000) => loc.waitFor({ timeout }),
    waitGone: (loc, timeout = 20000) => loc.waitFor({ state: 'hidden', timeout }),
    tap: async (loc, { times = 1 } = {}) => {
      for (let i = 0; i < times; i++) await press(loc);
    },
    /** The touch or the click drawn on a control, without pressing it: the Google button, whose popup is not the app. */
    fakeTap: async (loc) => {
      const { x, y } = await center(loc);
      if (!phone) await page.mouse.move(x, y, { steps: 22 });
      await page.evaluate(([px, py]) => window.__tutRipple(px, py), [x, y]);
      await wait(550);
    },
    /** The dev row's sign-in, pressed though it is hidden: what the Google button does, as far as the app can tell. */
    devSignIn: (name) => page.getByRole('button', { name, exact: true, includeHidden: true }).evaluate((e) => e.click()),
    highlight: outline,
    type: async (loc, text) => {
      await press(loc);
      await typeText(text);
    },
    typeFocused: typeText,
    /** What a field holds, replaced: selected whole, then typed over. */
    replace: async (loc, text) => {
      await press(loc);
      await page.keyboard.press('Control+A');
      if (text) await typeText(text);
      else await page.keyboard.press('Backspace');
    },
    press: (key) => page.keyboard.press(key),
    select: async (loc, label) => {
      const { x, y } = await center(loc);
      if (!phone) await page.mouse.move(x, y, { steps: 22 });
      await loc.selectOption({ label });
      await wait(700);
    },
    fill: async (loc, value) => {
      await center(loc);
      await loc.fill(value);
      await wait(600);
    },
    scroll: async (dy) => {
      const vp = page.viewportSize();
      if (!phone) await page.mouse.move(vp.width / 2, vp.height / 2, { steps: 10 });
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, dy / 10);
        await wait(45);
      }
      await wait(350);
    },
    scrollTo: async (loc) => {
      await center(loc);
    },
    /** A press and hold, as a phone selects a card. */
    longPress: async (loc) => {
      const { x, y } = await center(loc);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await wait(900);
      await page.mouse.up();
      await wait(550);
    },
    /**
     * A card dragged to a column, as the computer's board takes it: HTML5 drag
     * events, the way the browser suite drives it, with the pointer travelling
     * between the two so the viewer sees the drag.
     */
    drag: async (from, to) => {
      const a = await center(from);
      const b = await center(to);
      await page.mouse.move(a.x, a.y, { steps: 18 });
      await wait(250);
      const src = await from.elementHandle();
      const dst = await to.elementHandle();
      await page.evaluate(([el, x, y]) => {
        window.__tutDt = new DataTransfer();
        el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__tutDt, clientX: x, clientY: y }));
      }, [src, a.x, a.y]);
      const steps = 24;
      for (let i = 1; i <= steps; i++) {
        const x = a.x + ((b.x - a.x) * i) / steps;
        const y = a.y + ((b.y - a.y) * i) / steps;
        await page.mouse.move(x, y);
        await page.evaluate(([el, px, py, first]) => {
          const fire = (type) =>
            el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: window.__tutDt, clientX: px, clientY: py }));
          if (first) fire('dragenter');
          fire('dragover');
        }, [dst, x, y, i === 1]);
        await wait(30);
      }
      await page.evaluate(([el, s, x, y]) => {
        const opts = { bubbles: true, cancelable: true, dataTransfer: window.__tutDt, clientX: x, clientY: y };
        el.dispatchEvent(new DragEvent('drop', opts));
        s.dispatchEvent(new DragEvent('dragend', opts));
      }, [dst, src, b.x, b.y]);
      await wait(600);
    },
    chooseFile: async (loc, file) => {
      const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
      await press(loc);
      await (await chooser).setFiles(file);
      await wait(900);
    },
    /** A due date this many days from today, as the date field takes it. */
    inDays: (n) => addDays(todayInOrgTz(), n),
  };
  return t;
}

/** Signed in as the film needs, on a page of its own whose video is discarded. */
async function signIn(context, as) {
  if (!as) return;
  const page = await context.newPage();
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  // The dev row is hidden in every page of the context (`overlay`), this one too.
  const row = page.getByRole('button', { name: as, exact: true, includeHidden: true });
  await row.waitFor({ state: 'attached', timeout: 60000 });
  await row.evaluate((e) => e.click());
  await settle(page, page.getByRole('button', { name: 'More', exact: true }));
  // The push nudge is once per account on each device; answered here, it is
  // not in the film. Only the notifications film lets the browser ask.
  const notNow = page.getByRole('button', { name: 'Not now', exact: true }).filter({ visible: true }).first();
  await notNow.waitFor({ timeout: 4000 }).then(() => notNow.click(), () => {});
  await page.close();
}

async function film(browsers, tut, variant) {
  const durations = tut.steps.map((step, i) => {
    const wav = join(WAV, `${lineId(tut.id, i)}.wav`);
    const said = join(WAV, `${lineId(tut.id, i)}.txt`);
    if (!existsSync(wav) || !existsSync(said)) throw new Error(`no narration for ${lineId(tut.id, i)} — render it with tts.py first`);
    // THE WORDS, NOT THE ID. A line reworded after it was rendered keeps its id,
    // and with it a WAV of the old words under captions of the new ones.
    if (readFileSync(said, 'utf8') !== step.say) {
      throw new Error(`the narration for ${lineId(tut.id, i)} is of other words — render it again with tts.py`);
    }
    return seconds(wav);
  });
  const uids = await buildWorld();
  const world = { uids, setAccess };
  if (tut.before) await tut.before(world);
  const dir = join(OUT, '.raw');
  mkdirSync(dir, { recursive: true });
  const phone = variant === 'phone';
  /*
   * THE PHONE AT TWICE ITS PIXELS, from a browser launched at that scale. A
   * context's own `deviceScaleFactor` sharpens screenshots, not the video:
   * Playwright films at CSS pixels, so the film was a 390-pixel page in the
   * corner of a 780-pixel frame. Launched with the scale forced, the page
   * still lays out at 390 and the screencast comes at 780.
   */
  const context = await browsers[variant].newContext({
    ...(phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, recordVideo: { dir, size: { width: 780, height: 1688 } } }
      : { viewport: { width: 1440, height: 900 }, recordVideo: { dir, size: { width: 1440, height: 900 } } }),
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript(overlay, { showPointer: !phone, permission: tut.permission ?? 'denied' });
  try {
    await signIn(context, tut.as);
    const page = await context.newPage();
    const born = Date.now();
    await page.goto(new URL(tut.start, WEB).href, { waitUntil: 'domcontentloaded' });
    // Whichever the film starts on: a list, a board, a card, or the sign-in screen.
    await page
      .getByRole('button', { name: tut.as ? 'More' : 'Sign in with Google', exact: true })
      .or(page.getByRole('button', { name: 'Share card', exact: true }))
      .or(page.locator('[data-testid^="card-"]'))
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 40000 });
    await page.waitForTimeout(1500);
    const t = helpers(page, variant, world);
    const cues = [];
    for (const [i, step] of tut.steps.entries()) {
      if (step.cut && step.cut !== variant) continue;
      const at = Date.now();
      cues.push({ start: (at - born) / 1000, dur: durations[i], text: step.say, wav: join(WAV, `${lineId(tut.id, i)}.wav`) });
      try {
        await step.do(t);
      } catch (e) {
        // What the page showed when the step failed, beside the films.
        await page.screenshot({ path: join(OUT, `.failed-${tut.id}-${variant}.png`) }).catch(() => {});
        throw new Error(`step ${i + 1} ("${step.say.slice(0, 48)}…"): ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      }
      const left = durations[i] * 1000 + GAP_MS - (Date.now() - at);
      if (left > 0) await page.waitForTimeout(left);
    }
    await page.waitForTimeout(TAIL_MS);
    const video = page.video();
    await page.close();
    await context.close();
    return { raw: await video.path(), cues, end: (Date.now() - born) / 1000 };
  } catch (e) {
    await context.close().catch(() => {});
    throw e;
  }
}

/**
 * Narration laid over the film from its first line, as MP4, with captions.
 *
 * SMALL, BECAUSE PEOPLE WATCH THESE ON PHONES. A screen recording is flat
 * colour that barely moves, which x264 compresses hard when told what it is
 * (`-tune animation`) and given time (`-preset slower`); 24 frames a second is
 * plenty for a pointer and a scroll; and speech needs one channel at 64 kbps.
 * H.264 High at level 4.1 is what every phone and browser plays.
 */
function mux({ raw, cues, end }, base) {
  const from = Math.max(0, cues[0].start - 0.4);
  const length = Math.min(end, cues[cues.length - 1].start + cues[cues.length - 1].dur + TAIL_MS / 1000 + 0.3) - from;
  const inputs = ['-ss', from.toFixed(3), '-i', raw];
  for (const c of cues) inputs.push('-i', c.wav);
  const delays = cues.map((c, i) => {
    const ms = Math.round((c.start - from) * 1000);
    return `[${i + 1}:a]aresample=48000,adelay=${ms}|${ms}[a${i}]`;
  });
  // Back to 48 kHz after loudnorm, which works — and would otherwise write — at
  // 192 kHz resampled to 96: past what some phones' hardware decoders take.
  const mix = `${cues.map((_, i) => `[a${i}]`).join('')}amix=inputs=${cues.length}:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`;
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', ...inputs,
    '-filter_complex', [...delays, mix].join(';'),
    '-map', '0:v', '-map', '[aout]', '-t', length.toFixed(3),
    '-c:v', 'libx264', '-preset', 'slower', '-tune', 'animation', '-crf', '28',
    '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p', '-r', '24', '-g', '240',
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-ar', '48000', '-movflags', '+faststart',
    `${base}.mp4`,
  ]);
  const stamp = (s) => {
    const ms = Math.max(0, Math.round(s * 1000));
    const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const sec = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    return `${h}:${m}:${sec}.${String(ms % 1000).padStart(3, '0')}`;
  };
  writeFileSync(
    `${base}.vtt`,
    `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start - from)} --> ${stamp(c.start - from + c.dur)}\n${c.text}\n`).join('\n')}`,
  );
  return length;
}

/**
 * Films only the DEV SERVER, against the emulators: an export draws no dev
 * sign-in row, and a production one reports to the live Sentry project.
 * Metro answers `/status`; the dev row is drawn only by a development build.
 */
async function assertDevServer(browser) {
  const status = await fetch(new URL('status', WEB)).then((r) => r.text(), () => '');
  const page = await browser.newPage();
  await page.goto(WEB, { waitUntil: 'domcontentloaded' });
  const devRow = await page.getByTestId('dev-sign-in').first().waitFor({ timeout: 60000 }).then(() => true, () => false);
  await page.close();
  if (status !== 'packager-status:running' || !devRow) {
    console.error(`${WEB} is not the dev server against the emulators; see "The help films" in docs/DEV-TOOLING.md`);
    process.exit(1);
  }
}

mkdirSync(OUT, { recursive: true });
/*
 * THE BROWSER ITSELF, headless (`channel: 'chromium'`), not Playwright's
 * headless shell, which films a different browser from the one people use.
 */
const browsers = {
  phone: await chromium.launch({ channel: 'chromium', args: ['--force-device-scale-factor=2'] }),
  computer: await chromium.launch({ channel: 'chromium' }),
};
await assertDevServer(browsers.computer);
let failures = 0;
for (const tut of TUTORIALS) {
  if (only.size && !only.has(tut.id)) continue;
  for (const variant of variants) {
    const base = join(OUT, `${tut.id}-${variant}`);
    process.stdout.write(`${tut.id} (${variant}) … `);
    try {
      const shot = await film(browsers, tut, variant);
      const length = mux(shot, base);
      rmSync(shot.raw, { force: true });
      console.log(`${length.toFixed(1)} s`);
    } catch (e) {
      failures += 1;
      console.log(`FAILED: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    }
  }
}
await Promise.all(Object.values(browsers).map((b) => b.close()));
rmSync(join(OUT, '.raw'), { recursive: true, force: true });
process.exit(failures ? 1 : 0);
