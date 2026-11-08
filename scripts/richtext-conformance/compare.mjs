// What a reader sees and what an edit saves, compared across the surfaces.
//
// The web is the reference: the browser draws the parsed document through RN
// Text, so `webLines` is that document laid out line by line. The phones are
// the ports in ports.mjs fed the HTML @sabeel/shared writes for them. Every
// function takes the built @sabeel/shared as `lib`, so the tool measures the
// code in this checkout.
import {
  androidDisplayModel,
  iosDisplayModel,
  modelLines,
  androidEditorRoundTrip,
  iosInputOpen,
  iosToHtml,
  ZWS,
} from './ports.mjs';

// ---------------------------------------------------------------- web model
const NLC = { nl: true };
function cellsOf(nodes, f = { b: false, i: false, href: null }, out = []) {
  for (const n of nodes) {
    if (n.kind === 'text') {
      for (let k = 0; k < n.text.length; k++) {
        const c = n.text[k];
        if (c === '\n') out.push(NLC);
        else if (c !== ZWS) out.push({ c: c === '\u00A0' ? ' ' : c, ...f });
      }
    } else if (n.kind === 'bold') cellsOf(n.content, { ...f, b: true }, out);
    else if (n.kind === 'italic') cellsOf(n.content, { ...f, i: true }, out);
    else cellsOf(n.content, { ...f, href: n.href }, out);
  }
  return out;
}
const splitNl = (cells) => {
  const lines = [[]];
  for (const c of cells) if (c === NLC) lines.push([]);
  else lines[lines.length - 1].push(c);
  return lines;
};
// Mirrors richDocToDisplayHtml's decision, so the typed-marker lists it
// chooses are compared as typed text (the design), not as a divergence.
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC\u200F\u061C]/;
function readsRtl(nodes) {
  const flat = (ns) => ns.map((n) => (n.kind === 'text' ? n.text : flat(n.content))).join('');
  const t = flat(nodes);
  for (const ch of t) {
    if (RTL.test(ch)) return true;
    if (ch.toLowerCase() !== ch.toUpperCase()) return false;
  }
  return t.trim().length > 0;
}
const plain = (s) => [...s].map((c) => ({ c, b: false, i: false, href: null }));
function webLines(doc) {
  const out = [];
  doc.forEach((b, k) => {
    if (k > 0) out.push({ marker: '', cells: [] });
    if (b.kind === 'paragraph') {
      const cells = cellsOf(b.content);
      const lines = splitNl(cells);
      // A browser draws no line after a trailing newline.
      if (cells.length && cells[cells.length - 1] === NLC) lines.pop();
      for (const l of lines) out.push({ marker: '', cells: l });
    } else if (b.items.some(readsRtl)) {
      b.items.forEach((it, j) =>
        out.push({ marker: '', cells: [...plain(b.kind === 'bullets' ? '• ' : `${j + 1}. `), ...cellsOf(it)] }),
      );
    } else b.items.forEach((it, j) => out.push({ marker: b.kind === 'bullets' ? '•' : `${j + 1}.`, cells: cellsOf(it) }));
  });
  return out;
}

// ---------------------------------------------------------------- compare
const fl = (c) => `${c.b ? 'b' : ''}${c.i ? 'i' : ''}${c.href != null ? `a(${c.href})` : ''}`;
export const show = (lines) =>
  lines
    .map((l) => (l.marker ? `[${l.marker}]` : '') + l.cells.map((c) => (fl(c) ? `${c.c}{${fl(c)}}` : c.c)).join(''))
    .join('⏎');
export function compareDisplay(web, ph) {
  const wt = web.flatMap((l) => l.cells);
  const pt = ph.flatMap((l) => l.cells);
  const ws = wt.map((c) => c.c).join('');
  const ps = pt.map((c) => c.c).join('');
  if (ws !== ps) return { cat: 'text', detail: firstDiff(ws, ps) };
  for (let k = 0; k < wt.length; k++)
    if (fl(wt[k]) !== fl(pt[k])) return { cat: 'flags', detail: `at ${JSON.stringify(ws.slice(Math.max(0, k - 3), k + 4))}: web{${fl(wt[k])}} phone{${fl(pt[k])}}` };
  const mk = (ls) => {
    const r = [];
    let off = 0;
    for (const l of ls) {
      if (l.marker) r.push(`${off}:${l.marker}`);
      off += l.cells.length;
    }
    return r.join(',');
  };
  if (mk(web) !== mk(ph)) return { cat: 'marker', detail: `web ${mk(web)} | phone ${mk(ph)}` };
  const ne = (ls) => ls.filter((l) => l.cells.length || l.marker).map((l) => l.cells.map((c) => c.c).join('')).join('⏎');
  if (show(web) === show(ph)) return null;
  if (ne(web) === ne(ph)) {
    // Blank lines between the same non-empty lines: a gap lost or added
    // between two lines is a divergence; a count that differs (1 vs 2) or a
    // blank line at either edge is cosmetic.
    const gaps = (ls) => {
      const g = [0];
      for (const l of ls) {
        if (l.cells.length || l.marker) g.push(0);
        else g[g.length - 1]++;
      }
      return g;
    };
    const gw = gaps(web);
    const gp = gaps(ph);
    for (let k = 1; k < gw.length - 1; k++)
      if (gw[k] > 0 !== gp[k] > 0) return { cat: gw[k] > 0 ? 'gap-lost' : 'gap-added', detail: `after line ${k}: web ${gw[k]} blank, phone ${gp[k]}` };
    for (let k = 1; k < gw.length - 1; k++) if (gw[k] !== gp[k]) return { cat: 'blank-count', detail: `after line ${k}: web ${gw[k]}, phone ${gp[k]}` };
    return { cat: 'blank-edge', detail: `web ${gw[0]}..${gw[gw.length - 1]} phone ${gp[0]}..${gp[gp.length - 1]}` };
  }
  return { cat: 'line-breaks', detail: `web ${JSON.stringify(ne(web))} | phone ${JSON.stringify(ne(ph))}` };
}
function firstDiff(a, b) {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return `web ${JSON.stringify(a.slice(Math.max(0, k - 4), k + 6))} | phone ${JSON.stringify(b.slice(Math.max(0, k - 4), k + 6))}`;
}

// ---------------------------------------------------------------- round trip canon
const isWs = (c) => c.c === ' ' || c.c === '\t' || c.c === '\u00A0';
function rtBlocks(lib, md, level) {
  const doc = lib.parseRich(md);
  const norm = (cells) => {
    if (level < 1) return cells;
    const o = [];
    for (const c of cells) {
      if (isWs(c)) {
        if (o.length && o[o.length - 1].c !== ' ') o.push({ c: ' ', b: false, i: false, href: null });
      } else o.push(c);
    }
    while (o.length && o[o.length - 1].c === ' ') o.pop();
    return o;
  };
  const out = [];
  for (const b of doc) {
    if (b.kind === 'paragraph') {
      for (const l of splitNl(cellsOf(b.content))) {
        const n = norm(l);
        if (n.length) out.push({ kind: 'p', cells: n });
      }
    } else {
      let items = b.items.map((i) => norm(cellsOf(i)));
      if (level >= 2) items = items.filter((i) => i.length);
      if (items.length) out.push({ kind: b.kind, items });
    }
  }
  return out;
}
const blocksStr = (bs) =>
  bs
    .map((b) =>
      b.kind === 'p'
        ? 'P:' + b.cells.map((c) => (fl(c) ? `${c.c}{${fl(c)}}` : c.c)).join('')
        : `${b.kind === 'bullets' ? 'UL' : 'OL'}:` + b.items.map((i) => '<' + i.map((c) => (fl(c) ? `${c.c}{${fl(c)}}` : c.c)).join('') + '>').join(''),
    )
    .join(' | ');
export function compareRt(lib, md0, md1) {
  for (const [lvl, cat] of [
    [0, null],
    [1, 'whitespace'],
    [2, 'empty-item'],
  ]) {
    if (blocksStr(rtBlocks(lib, md0, lvl)) === blocksStr(rtBlocks(lib, md1, lvl))) return cat ? { cat } : null;
  }
  const a = rtBlocks(lib, md0, 2);
  const b = rtBlocks(lib, md1, 2);
  const txt = (bs) => bs.flatMap((x) => (x.kind === 'p' ? [x.cells] : x.items)).map((cs) => cs.map((c) => c.c).join('')).join('|');
  const flat = (bs) => bs.flatMap((x) => (x.kind === 'p' ? x.cells : x.items.flat()));
  if (txt(a).replace(/\|/g, '') !== txt(b).replace(/\|/g, '')) return { cat: 'text', detail: firstDiff(txt(a), txt(b)) };
  const fa = flat(a);
  const fb = flat(b);
  for (let k = 0; k < fa.length; k++) {
    if (fl(fa[k]) !== fl(fb[k])) {
      const which = fa[k].href !== fb[k].href ? 'link' : 'bold/italic';
      return { cat: which, detail: `at ${JSON.stringify(fa[k].c)}: stored{${fl(fa[k])}} saved{${fl(fb[k])}}` };
    }
  }
  return { cat: 'structure', detail: `${blocksStr(a)}  ==>  ${blocksStr(b)}` };
}

// ---------------------------------------------------------------- surfaces
export function displays(lib, md) {
  const doc = lib.parseRichForDisplay(md);
  const html = lib.richDocToDisplayHtml(doc);
  const web = webLines(doc);
  const and = modelLines(androidDisplayModel(html));
  const im = iosDisplayModel(html);
  const ios = im.raw ? [{ marker: '', cells: plain(im.text) }] : modelLines(im, { decodeHref: lib.decodeDisplayHref });
  return { html, web, and, ios };
}
export function roundTrips(lib, md) {
  const ehtml = `<html>${lib.markdownToPhoneEditorHtml(md)}</html>`;
  const aHtml = androidEditorRoundTrip(ehtml);
  const iHtml = iosToHtml(iosInputOpen(ehtml));
  return { ehtml, aHtml, iHtml, mdA: lib.htmlToMarkdown(aHtml), mdI: lib.htmlToMarkdown(iHtml) };
}

// ---------------------------------------------------------------- shrinker
export function shrink(md, still) {
  // By code point, so a surrogate pair is never cut in half.
  let cur = [...md];
  let progress = true;
  let budget = 6000;
  while (progress && budget > 0) {
    progress = false;
    for (let size = Math.max(1, Math.floor(cur.length / 2)); size >= 1; size = Math.floor(size / 2)) {
      for (let at = 0; at + size <= cur.length && budget > 0; ) {
        const cand = [...cur.slice(0, at), ...cur.slice(at + size)];
        budget--;
        let ok = false;
        try {
          ok = cand.length > 0 && still(cand.join(''));
        } catch {
          ok = false;
        }
        if (ok) {
          cur = cand;
          progress = true;
        } else at += 1;
      }
      if (size === 1) break;
    }
  }
  return cur.join('');
}
