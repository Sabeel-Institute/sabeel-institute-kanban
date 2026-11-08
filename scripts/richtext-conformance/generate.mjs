// Seeded markdown. `generate` mixes what people type through either editor,
// what the ClickUp importer wrote (raw text, unescaped) and adversarial token
// soup; `generatePlain` is only the first, in the shape an editor stores it
// (single spaces, marks around whole words, ordinary addresses), which is what
// says how often a real description would be hit.
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let z = seed;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];

const WORDS = ['call', 'donors', 'Budget', 'Q3', 'x', 'snake_case', 'e.g.', 'it’s', "don't", 'naïve', 'Iftar', 'hall', 'flyer', 'OK', 'a', 'b'];
const ARABIC = ['مرحبا', 'السلام عليكم', 'كتاب', 'الجمعة', 'إعداد التقرير', 'שלום', 'Meeting مع الفريق at 10:30', 'اجتماع 10:30'];
const DIGITS = ['10:30', '2025', '3', '1.5', '(555) 123-4567', '25%', '$100', '1/2'];
const EMOJI = ['😀', '👍🏽', '👨‍👩‍👧', '🇵🇰', '❤️', '✅', '📣'];
const PUNCT = ['.', ',', '!', '?', ':', ';', '(', ')', '-', '—', '"', "'", '…', '•', '#', '_', '~', '`', '>', '<', '&', '/', '|', '=', '+', '%', '@', ']', '[', '*', '\\'];
const SPACES = [' ', ' ', ' ', '  ', '   ', '\t', '\u00A0'];
const MENTIONS = ['@sara', '@omar', '@faisal', '@sara.k'];
const BARE = ['https://e.org', 'https://e.org/a?b=1&c=2', 'http://e.org/p_(q)', 'https://e.org/x.', 'mailto:a@e.org', 'https://docs.google.com/document/d/1AbC/edit?usp=sharing', 'https://e.org/a#frag', 'www.e.org', 'https://e.org/a&amp;b', 'https://e.org/"q"'];
const HREFS = ['https://e.org', 'https://e.org/?a=1&b=2', 'https://e.org/?q="x"', 'https://e.org/a<b>c', 'https://e.org/p_(q)', 'mailto:q@e.org', 'https://e.org/a b', 'https://e.org/&amp;', 'https://e.org/%20x', 'javascript:alert(1)', 'note', 'https://e.org/a\\)b', "https://e.org/it's"];
const ESC = ['\\*', '\\[', '\\\\', '\\]', '\\_', '\\-', '\\.', '\\(', '\\)'];
const HTMLISH = ['<b>', '</p>', '&amp;', '&lt;', '&nbsp;', '<script>alert(1)</script>', 'a < b', 'x > y', '&#39;', '&#x27;', '<br>', '&quot;', '<a href="x">'];

function atom(r) {
  const k = r();
  if (k < 0.3) return pick(r, WORDS);
  if (k < 0.38) return pick(r, ARABIC);
  if (k < 0.44) return pick(r, DIGITS);
  if (k < 0.5) return pick(r, EMOJI);
  if (k < 0.6) return pick(r, PUNCT);
  if (k < 0.66) return pick(r, MENTIONS);
  if (k < 0.72) return pick(r, BARE);
  if (k < 0.78) return pick(r, ESC);
  if (k < 0.84) return pick(r, HTMLISH);
  return pick(r, WORDS);
}

// Inline content: words with spaces, sometimes wrapped in marks or links.
function inline(r, depth = 0, allowNl = false) {
  const n = 1 + Math.floor(r() * 5);
  let s = '';
  for (let k = 0; k < n; k++) {
    if (k > 0) s += r() < 0.85 ? ' ' : pick(r, SPACES);
    const m = r();
    if (depth < 2 && m < 0.12) s += `**${inline(r, depth + 1, allowNl)}**`;
    else if (depth < 2 && m < 0.22) s += `*${inline(r, depth + 1, allowNl)}*`;
    else if (depth < 2 && m < 0.26) s += `***${inline(r, depth + 1, allowNl)}***`;
    else if (depth < 2 && m < 0.34) s += `[${inline(r, depth + 1, false)}](${pick(r, HREFS)})`;
    else if (allowNl && m < 0.38) s += '\n';
    else s += atom(r);
  }
  // leading / trailing / doubled spaces now and then
  if (r() < 0.08) s = pick(r, SPACES) + s;
  if (r() < 0.08) s += pick(r, SPACES);
  // adjacent marks
  if (depth === 0 && r() < 0.05) s += `**${pick(r, WORDS)}****${pick(r, WORDS)}**`;
  if (depth === 0 && r() < 0.05) s += `*${pick(r, WORDS)}**${pick(r, WORDS)}***`;
  return s;
}

function structured(r) {
  const lines = [];
  const n = 1 + Math.floor(r() * 9);
  for (let k = 0; k < n; k++) {
    const t = r();
    if (t < 0.35) lines.push(inline(r, 0, r() < 0.3));
    else if (t < 0.45) lines.push(pick(r, ['', '', '   ', '\t']));
    else if (t < 0.65) {
      const m = r() < 0.15 ? 12 : 1 + Math.floor(r() * 4);
      const mark = pick(r, ['- ', '* ', '+ ', '  - ', '-   ', '- ']);
      for (let j = 0; j < m; j++) lines.push(mark + (r() < 0.1 ? pick(r, ['', ' ']) : r() < 0.1 ? pick(r, DIGITS) : inline(r)));
    } else if (t < 0.82) {
      const m = r() < 0.2 ? 11 + Math.floor(r() * 3) : 1 + Math.floor(r() * 4);
      const sep = pick(r, ['. ', '. ', ') ']);
      const start = pick(r, [1, 1, 1, 3, 10]);
      for (let j = 0; j < m; j++) lines.push(`${start + j}${sep}` + (r() < 0.1 ? pick(r, ['', ' ']) : r() < 0.15 ? pick(r, DIGITS) : inline(r)));
    } else if (t < 0.88) lines.push(pick(r, ['\\- not a list', '1\\. not a list', '• typed bullet', '•\tpasted', '- [ ] todo', '-x', '1.x']));
    else if (t < 0.94) lines.push(pick(r, ARABIC) + (r() < 0.5 ? ' ' + inline(r) : ''));
    else lines.push(`${inline(r)}\n${inline(r)}`);
  }
  return lines.join(r() < 0.1 ? '\r\n' : '\n');
}

const TASKS = ['Call donors', 'Follow up w/ *Masjid* board', 'Q3 [draft] report', '1. Prep', 'Budget_2025 (final)', 'إعداد التقرير', '📣 Announce', 'Book hall & catering', 'Fix <title> on site', 'Iftar - Day 3', 'Ask **Omar**'];
const STATUS = ['to do', 'in progress', 'complete'];
const FILES = ['IMG_1234.JPG', 'Budget 2025 - Final (1).xlsx', 'flyer_v2.pdf', 'تقرير.pdf', 'notes*.docx'];
const PEOPLE = ['Sara', 'Omar K.', 'faisal', 'سارة'];
function clickupBody(r) {
  const parts = [];
  const n = Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const t = r();
    if (t < 0.5) parts.push(inline(r));
    else if (t < 0.7) parts.push(pick(r, BARE) + (r() < 0.5 ? ' ' + inline(r) : ''));
    else if (t < 0.85) parts.push(`• ${inline(r)}`);
    else parts.push('');
  }
  return parts.join('\n').trim();
}
function clickupDescription(r) {
  const parts = [];
  const body = clickupBody(r);
  if (body) parts.push(body);
  const meta = [];
  if (r() < 0.3) meta.push(`Subtask of: ${pick(r, TASKS)}`);
  if (r() < 0.4) {
    meta.push('Subtasks:');
    const m = 1 + Math.floor(r() * (r() < 0.2 ? 12 : 4));
    for (let k = 0; k < m; k++) meta.push(`  - ${pick(r, TASKS)} (${pick(r, STATUS)})`);
  }
  if (r() < 0.4) meta.push(`Assigned in ClickUp: ${[pick(r, PEOPLE), pick(r, PEOPLE)].join(', ')}`);
  if (r() < 0.3) {
    meta.push(`${pick(r, ['Checklist', 'To do', 'Prep 1'])}:`);
    const m = 1 + Math.floor(r() * 4);
    for (let k = 0; k < m; k++) meta.push(`  - ${pick(r, TASKS)}`);
  }
  if (r() < 0.3) {
    meta.push('Attachments (were in ClickUp, not stored here):');
    const m = 1 + Math.floor(r() * 3);
    for (let k = 0; k < m; k++) meta.push(`  - ${pick(r, FILES)}`);
  }
  if (meta.length) parts.push('— From ClickUp —\n' + meta.join('\n'));
  return parts.join('\n\n');
}
function clickupComment(r) {
  const date = pick(r, ['Oct 3 2025 at 10:15 am', '', '2025-10-03']);
  return `[${pick(r, PEOPLE)} · ${date}]\n${clickupBody(r) || inline(r, 0, true)}`;
}

const SOUP = ['a', 'b', ' ', '  ', '**', '*', '***', '[x](https://e.org/?a=1&b="2")', '[y z](mailto:q@e.org)', 'https://e.org/p_(q)', '\n', '\n\n', '- ', '1. ', '\t', '&amp;', '<b>', '&', '"', '\\*', '😀', 'ب', '\u200B', '\u00A0', 'x.', ')', '(', '[', ']', '@sara', '10. ', '\r\n', '[](https://e.org)', '[**b**](https://e.org)'];
function soup(r) {
  let s = '';
  const n = 1 + Math.floor(r() * 16);
  for (let k = 0; k < n; k++) s += pick(r, SOUP);
  return s;
}

export function generate(seed) {
  const r = mulberry(seed);
  const k = r();
  if (k < 0.4) return structured(r);
  if (k < 0.55) return clickupDescription(r);
  if (k < 0.65) return clickupComment(r);
  return soup(r);
}

const PLAIN_WORDS = ['call', 'the', 'donors', 'budget', 'for', 'Q3', 'hall', 'booked', 'Friday', 'Iftar', 'flyer', 'draft', 'review', 'please', 'Omar', 'Sara', 'by', '10:30', '2025', 'مرحبا', 'الجمعة', '📣', '✅', 'notes', 'done', 'e.g.', "don't", '(see', 'below)', 'cost:', '$100'];
const PLAIN_URLS = ['https://docs.google.com/document/d/1AbC/edit?usp=sharing', 'https://e.org/form?a=1&b=2', 'https://www.e.org/events', 'mailto:info@e.org'];
function words(r, n) {
  const o = [];
  for (let k = 0; k < n; k++) o.push(pick(r, PLAIN_WORDS));
  return o;
}
function sentence(r) {
  const ws = words(r, 2 + Math.floor(r() * 8));
  const out = [];
  for (let k = 0; k < ws.length; ) {
    const len = 1 + Math.floor(r() * 3);
    const run = ws.slice(k, k + len).join(' ');
    const m = r();
    if (m < 0.1) out.push(`**${run}**`);
    else if (m < 0.18) out.push(`*${run}*`);
    else if (m < 0.21) out.push(`***${run}***`);
    else if (m < 0.27) out.push(`[${run}](${pick(r, PLAIN_URLS)})`);
    else if (m < 0.3) out.push(`**${run} [${pick(r, PLAIN_WORDS)}](${pick(r, PLAIN_URLS)})**`);
    else if (m < 0.33) out.push(`**${run} *${pick(r, PLAIN_WORDS)}* ${pick(r, PLAIN_WORDS)}**`);
    else if (m < 0.36) out.push(pick(r, PLAIN_URLS));
    else if (m < 0.39) out.push('@' + pick(r, ['sara', 'omar', 'faisal']));
    else out.push(run);
    k += len;
  }
  return out.join(' ');
}
export function generatePlain(seed) {
  const r = mulberry(seed);
  const lines = [];
  const n = 1 + Math.floor(r() * 6);
  for (let k = 0; k < n; k++) {
    const t = r();
    if (k > 0 && r() < 0.6) lines.push('');
    if (t < 0.45) {
      lines.push(sentence(r));
      if (r() < 0.3) lines.push(sentence(r));
    } else if (t < 0.7) {
      const m = 1 + Math.floor(r() * 5);
      for (let j = 0; j < m; j++) lines.push('- ' + sentence(r));
    } else if (t < 0.9) {
      const m = r() < 0.2 ? 12 : 1 + Math.floor(r() * 5);
      for (let j = 0; j < m; j++) lines.push(`${j + 1}. ` + sentence(r));
    } else {
      lines.push(`${sentence(r)}:`, ...Array.from({ length: 1 + Math.floor(r() * 3) }, () => `  - ${sentence(r)}`));
    }
  }
  return lines.join('\n');
}
