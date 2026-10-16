/**
 * Turn a screen sweep into ONE self-contained HTML file you can open anywhere.
 *
 *   bash scripts/e2e.sh scripts/screens-e2e.mjs     # produces shots/screens/
 *   node scripts/sweep-report.mjs                   # -> shots/sweep-report.html
 *
 * Every image is inlined as a data URI, so the file survives being downloaded,
 * emailed or opened over a remote connection with nothing beside it. That is the
 * whole point: `shots/screens/` is sixty loose PNGs whose filenames encode a
 * grid, and nobody compares a grid by opening sixty files.
 *
 * The layout is one ROW PER SCREEN and one column per width, ascending, so a
 * layout that only breaks at 320px is visible by scanning down the left edge.
 * Tap any shot to see it full size.
 *
 * It reads whatever is on disk rather than a list written here — a screen added
 * to the sweep appears in the report without this file changing. Ordering is the
 * one thing it does know, because tour order is more useful than alphabetical.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = resolve(ROOT, 'shots', 'screens');
const OUT = resolve(ROOT, 'shots', 'sweep-report.html');

/** Tour order, then anything new alphabetically after it. */
const ORDER = [
  'rules', 'boards', 'mywork', 'search', 'alerts', 'stats', 'people', 'more', 'report',
  'board', 'board-owner', 'board-member', 'roster-owner', 'roster-member',
  'board-longname', 'board-empty', 'bulk', 'card', 'card-editing', 'card-comment',
  'settings', 'archive',
];

/**
 * Screens that only EXIST on one side of the breakpoint.
 *
 * Without this the report calls the wide cells of a narrow-only screen
 * "not captured", which reads as a gap in the sweep rather than as the layout
 * genuinely not having that state. The pager is the narrow board's alone.
 */
const NARROW_ONLY = new Set([
  'board-longname',
  'board-empty',
  'board-owner',
  'board-member',
  'roster-owner',
  'roster-member',
]);

/** What each screen is, so the report explains itself to someone else. */
const BLURB = {
  rules: 'The institute\u2019s rules, once per account, between approval and every board. Its one way out is Sign out: nothing behind it is mounted until I agree.',
  more: 'The More sheet open, with Report a problem beside the privacy policy.',
  report: 'Report a problem with a report half-written: one field and Send, nothing else.',
  boards: 'The board list — the home screen.',
  mywork: 'Every card assigned to you, across every board, grouped by when it is due.',
  search: 'Search and its filter chips. The cursor is taken on desktop widths only.',
  'search-filters': 'The Filters sheet, one section expanded. An accordion because four headers already spend most of a bounded modal at 320px, and a second open section would double what has to be scrolled past to reach the rest. The rows do not scroll themselves — the sheet is the one scroller, because two nested on the same axis do not chain on iOS.',
  alerts: 'Notifications, newest first.',
  stats: 'Admin only. A pushed screen, so it needs its own way back.',
  'stats-detail': 'A bar selected, with its breakdown below the chart. The panel appends below the fold on a phone, so the screen scrolls it into view — the one thing reading the code cannot show.',
  people: 'Admin only — approvals and roles.',
  board: 'Columns on a wide screen, one swipeable column on a narrow one.',
  card: 'A card at rest: the description RENDERED, with its formatting applied.',
  'card-editing': 'The description EDITOR open — toolbar row plus Save/Cancel.',
  'card-comment': 'The comment composer in use, with Bold active.',
  'board-owner': 'The same board as an OWNER of it — delete-column and Board settings present, like an admin. Ownership is per board and has nothing to do with the org role.',
  'board-member': 'The same board as a MEMBER who does not own it — no delete-column, and the settings icon becomes Board members. The archive stays, because members archive and so must un-archive.',
  'roster-owner': 'The member list as an OWNER: a toggle per person, and the creator\u2019s row locked, because only an admin may take ownership off whoever made the board.',
  'roster-member': 'The same list as a MEMBER \u2014 read-only, owners marked. It answers \u201cwho do I ask to add someone?\u201d, which used to be a question you could only put to an admin. Reachable by nobody in the admin tour, since an admin owns every board.',
  bulk: 'Selection mode, with the action bar floating over the board. Six 44px actions do not fit one row at 320px, so it wraps rather than pushing the page sideways.',
  'board-empty': 'A board with no columns — reachable, since the last empty column can be deleted. Its board actions must survive having no column footer to live in.',
  'board-longname': 'A column name too long to centre — the name and its pencil slide left rather than truncating early. Narrow layouts only; the pager does not exist on wide.',
  settings: 'Board settings — this board\u2019s owners and admins only.',
  archive: 'Archived cards, most recently archived first.',
};

const files = (await readdir(SHOTS)).filter((f) => f.endsWith('.png'));
if (!files.length) throw new Error(`no shots in ${SHOTS} — run the sweep first`);

// "320px-card-editing.png" -> width 320, screen "card-editing"
const shots = files.map((f) => {
  const m = f.match(/^(\d+)px-(.+)\.png$/);
  if (!m) throw new Error(`unexpected filename: ${f}`);
  return { file: f, width: Number(m[1]), screen: m[2] };
});

const widths = [...new Set(shots.map((s) => s.width))].sort((a, b) => a - b);
const screens = [...new Set(shots.map((s) => s.screen))].sort((a, b) => {
  const ia = ORDER.indexOf(a);
  const ib = ORDER.indexOf(b);
  if (ia === -1 && ib === -1) return a.localeCompare(b);
  if (ia === -1) return 1;
  if (ib === -1) return -1;
  return ia - ib;
});

const data = new Map();
let bytes = 0;
for (const s of shots) {
  const buf = await readFile(join(SHOTS, s.file));
  bytes += buf.length;
  data.set(`${s.width}-${s.screen}`, `data:image/png;base64,${buf.toString('base64')}`);
}

// The breakpoint comes from the source, so the report cannot claim a stale one.
const layout = await readFile(resolve(ROOT, 'app/src/theme/layout.ts'), 'utf8');
const BP = Number(layout.match(/WIDE_BREAKPOINT\s*=\s*(\d+)/)?.[1] ?? 700);

const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const rows = screens
  .map((screen) => {
    const cells = widths
      .map((w) => {
        const src = data.get(`${w}-${screen}`);
        const side = w >= BP ? 'wide' : 'narrow';
        if (!src) {
          const why = NARROW_ONLY.has(screen) && w >= BP ? 'no pager<br>on wide' : 'not captured';
          return `<div class="cell missing"><span>${w}px<br>${why}</span></div>`;
        }
        const shown = Math.round(Math.min(430, Math.max(190, w / 3.2)));
        return `<figure class="cell" style="width:${shown}px">
        <figcaption>${w}px <span class="tag ${side}">${side}</span></figcaption>
        <div class="thumb"><img loading="lazy" src="${src}" alt="${esc(screen)} at ${w}px" data-screen="${esc(screen)} — ${w}px"></div>
      </figure>`;
      })
      .join('\n');
    return `<section id="${esc(screen)}">
      <h2>${esc(screen)}</h2>
      <p class="blurb">${esc(BLURB[screen] ?? '')}</p>
      <div class="strip">${cells}</div>
    </section>`;
  })
  .join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screen sweep — Sabeel Kanban</title>
<style>
  :root {
    --ivory: #F6EBDD; --sage: #A8B89A; --rasp: #83114F;
    --gold: #C6A15B; --taupe: #A58D7A;
    --ink: #2B2320; --ink2: #6B5B50; --line: #E3D5C4; --card: #FFFDF9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ivory); color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header { padding: 28px 20px 20px; border-bottom: 1px solid var(--line); background: var(--card); }
  h1 { margin: 0 0 6px; font-size: 22px; color: var(--rasp); }
  .meta { color: var(--ink2); font-size: 13px; }
  nav { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }
  nav a {
    font-size: 12px; text-decoration: none; color: var(--ink);
    border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; background: var(--ivory);
  }
  nav a.new { border-color: var(--rasp); color: var(--rasp); font-weight: 600; }
  section { padding: 22px 20px; border-bottom: 1px solid var(--line); }
  h2 { margin: 0; font-size: 17px; }
  .blurb { margin: 2px 0 14px; color: var(--ink2); font-size: 13px; }
  .strip { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; align-items: flex-start; }
  .cell { margin: 0; flex: 0 0 auto; }
  figcaption { font-size: 12px; color: var(--ink2); margin-bottom: 6px; }
  .tag { font-size: 10px; padding: 1px 6px; border-radius: 999px; text-transform: uppercase; letter-spacing: .04em; }
  .tag.narrow { background: var(--sage); color: #24301F; }
  .tag.wide { background: var(--gold); color: #3A2A10; }
  /*
   * Thumbnails show the FULL WIDTH and are clipped at the bottom.
   *
   * These are full-page shots, so a 320px one is ~2000px tall and scaling it to
   * fit made every row enormous and every wide shot illegible. An
   * object-fit:cover fixed the height but cropped the SIDES — it sliced the
   * left nav rail off every wide screenshot, which is the one thing a layout
   * review is looking at. So: the image keeps its aspect ratio at 100% width, and an
   * overflow-hidden box does the vertical clipping. Zoom shows the whole page.
   */
  .thumb {
    height: 480px; overflow: hidden; border: 1px solid var(--line);
    border-radius: 8px; background: var(--card);
  }
  img { width: 100%; height: auto; display: block; cursor: zoom-in; }
  .missing {
    display: grid; place-items: center; height: 160px; border: 1px dashed var(--taupe);
    border-radius: 8px; color: var(--taupe); font-size: 12px; text-align: center;
  }
  #zoom {
    position: fixed; inset: 0; background: rgba(28,20,16,.92); display: none;
    overflow: auto; z-index: 10; padding: 16px; cursor: zoom-out;
  }
  #zoom.on { display: block; }
  #zoom img { max-width: 100%; height: auto; margin: 0 auto; border-radius: 6px; cursor: zoom-out; }
  #zoom p { color: var(--ivory); text-align: center; font-size: 13px; margin: 0 0 10px; }
  @media (max-width: 600px) {
    .cell { width: 190px !important; }
    .thumb { height: 360px; }
  }
</style>
</head>
<body>
<header>
  <h1>Screen sweep — Sabeel Kanban</h1>
  <div class="meta">
    ${screens.length} screens &times; ${widths.length} widths (${widths.map((w) => `${w}px`).join(', ')}) &middot;
    ${shots.length} screenshots &middot; ${(bytes / 1024 / 1024).toFixed(1)} MB of PNGs inlined &middot;
    wide layout at &ge; ${BP}px &middot; generated ${new Date().toISOString().slice(0, 10)}
  </div>
  <div class="meta">Every shot is full-page and asserted by <code>scripts/screens-e2e.mjs</code>. Thumbnails are cropped to a common height &mdash; <strong>tap one to see the whole page</strong>.</div>
  <nav>${screens
    .map((s) => `<a class="${s.startsWith('card-') ? 'new' : ''}" href="#${esc(s)}">${esc(s)}</a>`)
    .join('')}</nav>
</header>
${rows}
<div id="zoom"><p></p><img alt=""></div>
<script>
  const z = document.getElementById('zoom');
  const zi = z.querySelector('img');
  const zp = z.querySelector('p');
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && e.target !== zi) {
      zi.src = e.target.src;
      zp.textContent = e.target.dataset.screen || '';
      z.classList.add('on');
      z.scrollTop = 0;
    } else if (z.classList.contains('on')) {
      z.classList.remove('on');
      zi.removeAttribute('src');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { z.classList.remove('on'); zi.removeAttribute('src'); }
  });
</script>
</body>
</html>
`;

await writeFile(OUT, html);
console.log(`${OUT}`);
console.log(`${shots.length} shots, ${screens.length} screens x ${widths.length} widths, ${(html.length / 1024 / 1024).toFixed(1)} MB`);
const missing = screens.flatMap((s) =>
  widths
    .filter((w) => !data.has(`${w}-${s}`) && !(NARROW_ONLY.has(s) && w >= BP))
    .map((w) => `${w}px-${s}`),
);
if (missing.length) console.log(`MISSING: ${missing.join(', ')}`);
