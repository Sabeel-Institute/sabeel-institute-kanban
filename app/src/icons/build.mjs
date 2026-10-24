/**
 * Builds the app's icon font: the Material Icons glyphs named in `names.json`,
 * and nothing else.
 *
 * The full font is 2,234 glyphs (357 KB, 156 KB over the wire) and the app
 * draws a few dozen. On the web it is fetched only once the first icon mounts,
 * after the bundle, and @expo/vector-icons gives it 12 s: on a slow connection
 * it lost that race (Sentry SABEEL-KANBAN-WEB-J) and every icon on screen
 * stayed blank. Sending less is the fix; fetching it earlier would only take
 * the same bandwidth from the bundle.
 *
 * `glyphmap.json` and `icons.ttf` are this function's output, committed so
 * Metro and the type checker see them without a build step. `icons.test.ts`
 * rebuilds both and fails when either differs, and checks every glyph is
 * really in the font, so an edited list cannot ship without its glyphs.
 *
 *   npm run icons -w @sabeel/app     # after editing names.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);
const UPSTREAM = '@expo/vector-icons/build/vendor/react-native-vector-icons';
const HERE = fileURLToPath(new URL('.', import.meta.url));

export const NAMES_PATH = `${HERE}names.json`;
export const GLYPHMAP_PATH = `${HERE}glyphmap.json`;
export const FONT_PATH = `${HERE}icons.ttf`;

/**
 * @param {string[]} names Material Icons glyph names, as @expo/vector-icons spells them.
 * @returns {Promise<{ glyphMap: Record<string, number>, font: Buffer }>}
 */
export async function buildIcons(names) {
  /** @type {Record<string, number>} */
  const upstream = require(`${UPSTREAM}/glyphmaps/MaterialIcons.json`);
  const unknown = names.filter((n) => !Object.hasOwn(upstream, n));
  if (unknown.length) {
    throw new Error(`not Material Icons glyph names: ${unknown.join(', ')}`);
  }
  const glyphMap = Object.fromEntries([...names].sort().map((n) => [n, upstream[n]]));
  const full = await readFile(require.resolve(`${UPSTREAM}/Fonts/MaterialIcons.ttf`));
  const font = await subsetFont(full, String.fromCodePoint(...Object.values(glyphMap)), {
    targetFormat: 'truetype',
  });
  return { glyphMap, font };
}

/** @returns {Promise<string[]>} */
export async function readNames() {
  return JSON.parse(await readFile(NAMES_PATH, 'utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { glyphMap, font } = await buildIcons(await readNames());
  await writeFile(GLYPHMAP_PATH, `${JSON.stringify(glyphMap, null, 2)}\n`);
  await writeFile(FONT_PATH, font);
  console.log(`${Object.keys(glyphMap).length} icons, ${font.length} bytes`);
}
