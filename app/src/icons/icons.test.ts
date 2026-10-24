import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { FONT_PATH, GLYPHMAP_PATH, buildIcons, readNames } from './build.mjs';

/**
 * The icon font is generated and committed (`build.mjs`), so nothing at build
 * time notices a font that lags `names.json`: the app would type-check against
 * the list and draw a blank square for the missing glyph. These hold the three
 * files to one another.
 */

/** Glyph index for each code point the font's Unicode cmap maps, and each glyph's outline length. */
function readFont(bytes: Buffer): { glyphOf: Map<number, number>; outlineBytes: (glyph: number) => number } {
  const tables = new Map<string, number>();
  for (let i = 0, n = bytes.readUInt16BE(4); i < n; i++) {
    const rec = 12 + i * 16;
    tables.set(bytes.toString('latin1', rec, rec + 4), bytes.readUInt32BE(rec + 8));
  }
  const table = (tag: string) => {
    const at = tables.get(tag);
    if (at === undefined) throw new Error(`no ${tag} table`);
    return at;
  };

  const glyphOf = new Map<number, number>();
  const cmap = table('cmap');
  for (let i = 0, n = bytes.readUInt16BE(cmap + 2); i < n; i++) {
    const rec = cmap + 4 + i * 8;
    const sub = cmap + bytes.readUInt32BE(rec + 4);
    const format = bytes.readUInt16BE(sub);
    if (format === 4) {
      const segs = bytes.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segs * 2 + 2;
      const deltas = starts + segs * 2;
      const ranges = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const start = bytes.readUInt16BE(starts + s * 2);
        const end = bytes.readUInt16BE(ends + s * 2);
        const delta = bytes.readInt16BE(deltas + s * 2);
        const range = bytes.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const g = range ? bytes.readUInt16BE(ranges + s * 2 + range + (c - start) * 2) : c;
          if (g !== 0) glyphOf.set(c, (g + delta) & 0xffff);
        }
      }
    } else if (format === 12) {
      for (let g = 0, n = bytes.readUInt32BE(sub + 12); g < n; g++) {
        const rec12 = sub + 16 + g * 12;
        const start = bytes.readUInt32BE(rec12);
        const end = bytes.readUInt32BE(rec12 + 4);
        const first = bytes.readUInt32BE(rec12 + 8);
        for (let c = start; c <= end; c++) glyphOf.set(c, first + c - start);
      }
    }
  }

  const longLoca = bytes.readInt16BE(table('head') + 50) === 1;
  const loca = table('loca');
  const offset = (g: number) =>
    longLoca ? bytes.readUInt32BE(loca + g * 4) : bytes.readUInt16BE(loca + g * 2) * 2;
  return { glyphOf, outlineBytes: (g) => offset(g + 1) - offset(g) };
}

describe('icon font', () => {
  it('lists each name once, in order', async () => {
    const names = await readNames();
    expect(names).toEqual([...new Set(names)].sort());
  });

  it('is what build.mjs makes of names.json (run `npm run icons -w @sabeel/app`)', async () => {
    const built = await buildIcons(await readNames());
    expect(JSON.parse(await readFile(GLYPHMAP_PATH, 'utf8'))).toEqual(built.glyphMap);
    expect((await readFile(FONT_PATH)).equals(built.font)).toBe(true);
  });

  it('draws every glyph the glyph map names', async () => {
    const glyphMap: Record<string, number> = JSON.parse(await readFile(GLYPHMAP_PATH, 'utf8'));
    const { glyphOf, outlineBytes } = readFont(await readFile(FONT_PATH));
    const missing = Object.entries(glyphMap)
      .filter(([, code]) => {
        const g = glyphOf.get(code);
        return g === undefined || g === 0 || outlineBytes(g) === 0;
      })
      .map(([name]) => name);
    expect(missing).toEqual([]);
    expect(Object.keys(glyphMap).length).toBeGreaterThan(0);
  });
});
