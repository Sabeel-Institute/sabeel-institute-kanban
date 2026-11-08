// Does a phone draw, and save, what the web does?
//
// Feeds seeded markdown through @sabeel/shared and through Node ports of the
// two HTML parsers inside react-native-enriched-html (Android's
// EnrichedParser.java, iOS's HtmlParser.mm; scripts/richtext-conformance/
// ports.mjs), and compares what each phone would show, and what an unedited
// save in each phone editor would store, with the document the web draws.
// Tests in Node compare our converter with our own idea of HTML; this compares
// it with the library's.
//
// Run it by hand whenever react-native-enriched-html or the converters in
// packages/shared/src/richtext*.ts change. Not in CI: it takes minutes, and
// what it guards changes rarely. Build the shared package first:
//
//   npm run build -w @sabeel/shared
//   node scripts/richtext-conformance.mjs                # 20000 documents
//   node scripts/richtext-conformance.mjs --set plain    # realistic only
//   node scripts/richtext-conformance.mjs --docs 200000 --from 1 --examples 8
//
// Exit 1 when a divergence is not in KNOWN below, or is well commoner than it
// expects. Exit 2 on bad arguments or a stale build. The ports describe
// react-native-enriched-html 1.1.1 with this repo's patch; another version
// is refused until the ports have been checked against its source.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { generate, generatePlain } from './richtext-conformance/generate.mjs';
import {
  compareDisplay,
  compareRt,
  displays,
  roundTrips,
  show,
  shrink,
} from './richtext-conformance/compare.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const USAGE =
  'Usage: node scripts/richtext-conformance.mjs [--set all|plain] [--docs N] [--from SEED] [--examples K]';

function fail(message) {
  console.error(message);
  process.exit(2);
}

// ---- Arguments ---------------------------------------------------------------
const opts = { set: 'all', docs: 20000, from: 1, examples: 4 };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  const value = argv[i + 1];
  if (a === '--set') {
    if (value !== 'all' && value !== 'plain') fail(`--set is "all" or "plain".\n${USAGE}`);
    opts.set = value;
  } else if (a === '--docs' || a === '--from' || a === '--examples') {
    const n = Number(value);
    const min = a === '--examples' ? 0 : 1;
    if (!Number.isInteger(n) || n < min) fail(`${a} needs a whole number of at least ${min}.\n${USAGE}`);
    opts[a.slice(2)] = n;
  } else fail(`Unknown argument ${a}.\n${USAGE}`);
  i += 1;
}

// ---- What is measured --------------------------------------------------------
const libPkg = JSON.parse(
  readFileSync(`${root}node_modules/react-native-enriched-html/package.json`, 'utf8'),
);
if (libPkg.version !== '1.1.1') {
  fail(
    `react-native-enriched-html is ${libPkg.version}; the ports model 1.1.1. ` +
      'Check ports.mjs against the new parsers before trusting a run.',
  );
}

// A stale build would measure the code before your change and pass.
for (const name of ['richtext', 'richtextHtml']) {
  const src = `${root}packages/shared/src/${name}.ts`;
  const built = `${root}packages/shared/lib/${name}.js`;
  if (!existsSync(built) || statSync(built).mtimeMs < statSync(src).mtimeMs) {
    fail(`packages/shared/lib is older than src/${name}.ts. Run: npm run build -w @sabeel/shared`);
  }
}
const lib = createRequire(import.meta.url)(`${root}packages/shared/lib/index.js`);

/**
 * Divergences that are understood and accepted, per set, as the number
 * expected in 10000 documents (measured on the default seeds). A class not
 * listed fails the run, and so does a count well above what is expected
 * (three standard deviations and two documents of slack), so a change that
 * makes a known problem commoner fails too. "display" compares what a phone
 * draws with the web; "editor" what an unedited save on a phone stores with
 * what was stored. Classes are reported most severe first per document:
 * text, then link or bold/italic, then structure, empty-item, whitespace.
 */
const WHY = {
  'blank-count': 'a blank line more or fewer between two lines',
  'blank-edge': 'a blank line more or fewer at either end',
  'gap-lost': 'an empty link in a list item takes the gap after the list',
  whitespace: 'spacing only: Android collapses runs, a tab saves as a space',
  structure: 'two lists of one kind with a blank line between save as one list',
  'empty-item': 'the same, for lists of empty items',
  link: 'iOS joins two links with nothing between them into one',
  'bold/italic': 'a mark ending in, or an italic starting with, the other mark (parseInline)',
  text: 'the same parser gap with literal asterisks, or a no-break space read as a list marker',
};
const KNOWN = {
  plain: {
    'editor and structure': 1671,
    'editor ios structure': 1671,
  },
  all: {
    'display and blank-count': 13,
    'display ios blank-count': 13,
    'display and blank-edge': 7,
    'display ios blank-edge': 17,
    'display and gap-lost': 0.5,
    'editor and whitespace': 5827,
    'editor ios whitespace': 3610,
    'editor and structure': 102,
    'editor ios structure': 94,
    'editor and empty-item': 5,
    'editor ios empty-item': 5,
    'editor ios link': 171,
    'editor ios bold/italic': 9,
    'editor and text': 71,
    'editor ios text': 433,
  },
};

// ---- Run ----------------------------------------------------------------------
const gen = opts.set === 'plain' ? generatePlain : generate;
const groups = new Map();
let errors = 0;
const dispCat = (md, surf) => {
  const d = displays(lib, md);
  return compareDisplay(d.web, d[surf]);
};
const rtCat = (md, surf) => {
  const r = roundTrips(lib, md);
  return compareRt(lib, md, surf === 'and' ? r.mdA : r.mdI);
};
function record(key, md, still) {
  let g = groups.get(key);
  if (!g) groups.set(key, (g = { n: 0, ex: new Set() }));
  g.n += 1;
  if (g.ex.size < opts.examples) g.ex.add(shrink(md, still));
}
for (let seed = opts.from; seed < opts.from + opts.docs; seed += 1) {
  const md = gen(seed);
  try {
    for (const surf of ['and', 'ios']) {
      const c = dispCat(md, surf);
      if (c) record(`display ${surf} ${c.cat}`, md, (m) => dispCat(m, surf)?.cat === c.cat);
      const rc = rtCat(md, surf);
      if (rc) record(`editor ${surf} ${rc.cat}`, md, (m) => rtCat(m, surf)?.cat === rc.cat);
    }
  } catch (e) {
    errors += 1;
    console.error(`seed ${seed} ${JSON.stringify(md)}: ${e.stack}`);
  }
}

// ---- Report -------------------------------------------------------------------
console.log(
  `${opts.set} documents, seeds ${opts.from}..${opts.from + opts.docs - 1}: ` +
    `${opts.docs} documents, ${errors} port error(s)`,
);
let unknown = 0;
for (const [key, g] of [...groups].sort()) {
  const [kind, surf, cat] = key.split(' ');
  const perTenK = KNOWN[opts.set][key];
  let verdict;
  if (perTenK === undefined) verdict = 'NEW  ';
  else {
    const expected = (perTenK * opts.docs) / 10000;
    const allowed = Math.ceil(expected + 3 * Math.sqrt(expected) + 2);
    verdict = g.n > allowed ? `MORE (allowed ${allowed})` : 'known';
  }
  if (verdict !== 'known') unknown += 1;
  console.log(`\n${verdict} ${key}: ${g.n} (${WHY[cat] ?? cat})`);
  for (const ex of [...g.ex].sort((a, b) => a.length - b.length)) {
    if (kind === 'display') {
      const d = displays(lib, ex);
      console.log('  md', JSON.stringify(ex), '| web', show(d.web), `| ${surf}`, show(d[surf]));
    } else {
      const r = roundTrips(lib, ex);
      const saved = surf === 'and' ? r.mdA : r.mdI;
      console.log('  md', JSON.stringify(ex), '-> saved', JSON.stringify(saved), '|', compareRt(lib, ex, saved)?.detail ?? '');
    }
  }
}
if (unknown > 0 || errors > 0) {
  console.log(`\n${unknown} class(es) new or commoner than KNOWN allows, ${errors} port error(s).`);
  process.exit(1);
}
console.log('\nOnly known divergences, no commoner than expected.');
