/**
 * The HTML seam — the ONLY thing either editor speaks.
 *
 * This HTML is never rendered in a browser and never stored. It exists so that
 * Lexical (web) and `react-native-enriched-html` (the phones) can hand documents
 * to us and take them back, while **markdown remains the single storage
 * format**. Both surfaces go through one converter, so the same keystrokes
 * produce byte-identical markdown from a phone and from a browser — which is
 * what makes the round-trip proof testable at all.
 *
 * `htmlToMarkdown` IS the paste whitelist. It cannot emit anything outside the
 * five-element vocabulary because it does not know anything else, so a pasted
 * heading, table or `<script>` is reduced without needing a paste handler.
 *
 * Hand-rolled rather than `DOMParser`: this module runs under Node for vitest
 * and under Hermes on the device, and two parsers for one job is exactly the
 * "two boxes doing the same thing" failure the repo already warns about.
 */
import {
  isSafeHref,
  parseRich,
  serializeRich,
  type RichBlock,
  type RichDoc,
  type RichInline,
} from './richtext';

/** Tags whose CONTENT is dropped as well as the tag. */
const DROP_CONTENT = new Set(['script', 'style', 'head', 'title', 'img']);

/** Tags that become a paragraph boundary. Headings and quotes degrade here. */
const BLOCKISH = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'section', 'article',
]);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    const key = body.toLowerCase();
    if (key in ENTITIES) return ENTITIES[key];
    if (key.startsWith('#x')) {
      const n = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    if (key.startsWith('#')) {
      const n = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return whole;
  });
}

function encodeEntities(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------- markdown → HTML

function inlineToHtml(nodes: RichInline[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          // A newline inside a paragraph is a soft break the editors express as
          // <br>. Without this a two-line paragraph collapses to one line.
          return encodeEntities(n.text).split('\n').join('<br>');
        case 'bold':
          return `<b>${inlineToHtml(n.content)}</b>`;
        case 'italic':
          return `<i>${inlineToHtml(n.content)}</i>`;
        case 'link':
          // An attribute value, so its quote has to be escaped as well: a `"` in
          // an address would otherwise end the attribute early.
          return `<a href="${encodeHref(n.href)}">${inlineToHtml(n.content)}</a>`;
      }
    })
    .join('');
}

function listToHtml(b: RichBlock & { kind: 'bullets' | 'numbers' }): string {
  const tag = b.kind === 'bullets' ? 'ul' : 'ol';
  return `<${tag}>${b.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join('')}</${tag}>`;
}

/** What the BROWSER editor (Lexical) opens with: a soft break is a `<br>`, which it keeps. */
export function markdownToHtml(markdown: string): string {
  return parseRich(markdown)
    .map((b) => (b.kind === 'paragraph' ? `<p>${inlineToHtml(b.content)}</p>` : listToHtml(b)))
    .join('');
}

/**
 * What a PHONE editor opens with: each line of a paragraph its own `<p>`, a
 * bold or link that spans the break reopened on the next line.
 *
 * The phone editors have no line break inside a paragraph. iOS makes `<br>` a
 * newline only beside another tag, so `line<br>line` opened as ONE line and
 * saved that way: the words of a description ran together the first time an
 * iPhone saved it. Android opens the `<br>` as a new line, which its editor
 * saves as a new paragraph. So both now open what Android always saved: an
 * edit on a phone turns a soft break into a paragraph break, and loses nothing.
 */
export function markdownToPhoneEditorHtml(markdown: string): string {
  return parseRich(markdown)
    .map((b) =>
      b.kind === 'paragraph'
        ? splitLines(b.content)
            .map((line) => `<p>${inlineToHtml(line)}</p>`)
            .join('')
        : listToHtml(b),
    )
    .join('');
}

/**
 * An address as an attribute value: its quote escaped as well, or a `"` in it
 * would end the attribute early. `decodeDisplayHref` is the inverse.
 */
function encodeHref(href: string): string {
  return encodeEntities(href).replace(/"/g, '&quot;');
}

/**
 * The address a phone hands back when a link is tapped, as it was before
 * `encodeHref`. iOS returns the attribute as written, escapes included, so
 * `?a=1&b=2` would open as `?a=1&amp;b=2`; Android decodes it already, and
 * decoding twice would turn a literal `&amp;` in an address into `&`.
 */
export function decodeDisplayHref(href: string): string {
  return href
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * The HTML a phone's native text view draws: the one thing here that IS
 * rendered, on Android and iOS only, and never by a browser. Escaping here is
 * what keeps a typed `<script>` as characters on a phone.
 *
 * Takes the parsed document rather than markdown, so the phones draw what
 * `parseRichForDisplay` produced for the web too and the surfaces cannot
 * disagree about the words. It differs from `markdownToHtml` in what the two
 * platforms' parsers need in order to draw the same thing:
 *
 *  - `<html>` around the body sends it down the library's parser directly. Its
 *    normaliser exists for HTML from elsewhere, and everything here is ours.
 *  - `<br>` BETWEEN blocks, where a single text view has no margins to offer.
 *  - Each LINE of a paragraph is a `<p>` of its own, never a `<br>` inside one.
 *    iOS turns `<br>` into a newline only beside another tag, so
 *    `line<br>line` ran the two lines together there. A bold or a link that
 *    spans the break is closed and reopened on each line.
 *  - Spaces survive. Android collapses a space after a space or at the start
 *    of a line, as a browser would, so each of those is a no-break space.
 *  - A list holding a right-to-left item becomes lines with typed markers. The
 *    library paints list markers off the canvas in a right-to-left paragraph
 *    (1.1.1, both list spans on Android), so an Arabic list would lose its
 *    bullets and its numbers. The whole list changes, because a list split in
 *    two restarts its numbering, and gives up the hanging indent.
 */
export function richDocToDisplayHtml(doc: RichDoc): string {
  const line = (nodes: RichInline[], marker = '') =>
    `<p>${displayInline(marker ? [{ kind: 'text', text: marker }, ...nodes] : nodes, { space: true })}</p>`;
  const block = (b: RichBlock): string => {
    if (b.kind === 'paragraph') return splitLines(b.content).map((l) => line(l)).join('');
    if (b.items.some(readsRightToLeft)) {
      return b.items
        .map((item, i) => line(item, b.kind === 'bullets' ? '\u2022 ' : `${i + 1}. `))
        .join('');
    }
    const tag = b.kind === 'bullets' ? 'ul' : 'ol';
    return `<${tag}>${b.items.map((i) => `<li>${displayInline(i, { space: true })}</li>`).join('')}</${tag}>`;
  };
  return `<html>${doc.map(block).join('<br>')}</html>`;
}

/** A paragraph's inline nodes, one array per line, formatting reopened on each. */
function splitLines(nodes: RichInline[]): RichInline[][] {
  const lines: RichInline[][] = [[]];
  const push = (n: RichInline) => lines[lines.length - 1].push(n);
  for (const n of nodes) {
    const parts: RichInline[][] =
      n.kind === 'text'
        ? n.text.split('\n').map((t) => (t ? [{ kind: 'text', text: t }] : []))
        : splitLines(n.content).map((c) => (c.length ? [{ ...n, content: c }] : []));
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      part.forEach(push);
    });
  }
  return lines;
}

/**
 * Inline nodes for the display HTML. `state.space` is whether the last
 * character drawn was a space, or the line has only begun; a space then is a
 * no-break space, which Android does not collapse. Carried across nodes, since
 * `a ` then a bold ` b` is a run of two.
 */
function displayInline(nodes: RichInline[], state: { space: boolean }): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text': {
          let out = '';
          for (const ch of n.text) {
            out += ch === ' ' && state.space ? '\u00A0' : ch;
            state.space = ch === ' ';
          }
          return encodeEntities(out);
        }
        case 'bold':
          return `<b>${displayInline(n.content, state)}</b>`;
        case 'italic':
          return `<i>${displayInline(n.content, state)}</i>`;
        case 'link':
          return `<a href="${encodeHref(n.href)}">${displayInline(n.content, state)}</a>`;
      }
    })
    .join('');
}

/** Hebrew and the Arabic blocks, presentation forms included. */
const RIGHT_TO_LEFT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;

/**
 * The rule a text layout uses for a paragraph's direction: its first strong
 * character. Digits and punctuation are neutral, and a letter with case is the
 * cheap test for "strongly left-to-right" that needs no Unicode tables on Hermes.
 */
function readsRightToLeft(nodes: RichInline[]): boolean {
  const flat = (ns: RichInline[]): string =>
    ns.map((n) => (n.kind === 'text' ? n.text : flat(n.content))).join('');
  for (const ch of flat(nodes)) {
    if (RIGHT_TO_LEFT.test(ch)) return true;
    if (ch.toLowerCase() !== ch.toUpperCase()) return false;
  }
  return false;
}

// ---------------------------------------------------------------- HTML → markdown

type Token =
  | { t: 'text'; text: string }
  | { t: 'open'; name: string; attrs: string }
  | { t: 'close'; name: string };

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out.push({ t: 'text', text: html.slice(i) });
      break;
    }
    if (lt > i) out.push({ t: 'text', text: html.slice(i, lt) });
    const gt = html.indexOf('>', lt);
    if (gt < 0) {
      out.push({ t: 'text', text: html.slice(lt) });
      break;
    }
    const raw = html.slice(lt + 1, gt).trim();
    if (raw.startsWith('!')) {
      i = gt + 1;
      continue; // comment or doctype
    }
    if (raw.startsWith('/')) {
      out.push({ t: 'close', name: raw.slice(1).trim().toLowerCase() });
    } else {
      const sp = raw.search(/[\s/]/);
      const name = (sp < 0 ? raw : raw.slice(0, sp)).toLowerCase();
      out.push({ t: 'open', name, attrs: sp < 0 ? '' : raw.slice(sp) });
      // Self-closing or void: emit a matching close so the walker stays simple.
      if (raw.endsWith('/') || name === 'br' || name === 'img' || name === 'hr') {
        out.push({ t: 'close', name });
      }
    }
    i = gt + 1;
  }
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : undefined;
}

/**
 * Walk the token stream into blocks.
 *
 * Everything outside the vocabulary degrades here rather than being rejected:
 * an unknown tag is unwrapped (its text survives), a heading or quote becomes a
 * paragraph, and a nested list is flattened because the native editor does not
 * support nesting either.
 */
export function htmlToMarkdown(html: string): string {
  const tokens = tokenize(html);
  const blocks: RichDoc = [];

  // Inline state: a stack of open marks, and the run being built.
  let run: RichInline[] = [];
  const marks: { kind: 'bold' | 'italic' | 'link'; href?: string; content: RichInline[] }[] = [];
  let listKind: 'bullets' | 'numbers' | null = null;
  let listItems: RichInline[][] = [];
  let inItem = false;
  let dropDepth = 0;
  // Inside a <mention> whose `text` attribute we have already emitted. Its own
  // child text duplicates that attribute, so it is skipped — see the open case.
  let mentionDepth = 0;
  // Nesting depth of <ul>/<ol>. A nested list is FLATTENED into the outer
  // one (the native editor does not nest either), so the inner </ul> must
  // not end the list and strand every item after it.
  let listDepth = 0;
  // Depth per inline mark. Lexical emits <b><strong>x</strong></b> for ONE bold
  // run: the inner open must be collapsed AND its close ignored, or the close
  // ends the outer mark early and strands everything after it.
  const markDepth = { bold: 0, italic: 0 };

  const target = (): RichInline[] => (marks.length ? marks[marks.length - 1].content : run);

  const pushText = (text: string) => {
    if (!text) return;
    const arr = target();
    const last = arr[arr.length - 1];
    if (last && last.kind === 'text') last.text += text;
    else arr.push({ kind: 'text', text });
  };

  const closeMark = (kind: 'bold' | 'italic' | 'link') => {
    for (let m = marks.length - 1; m >= 0; m -= 1) {
      if (marks[m].kind !== kind) continue;
      const done = marks.splice(m)[0];
      const arr = target();
      if (done.kind === 'link') {
        if (done.href && isSafeHref(done.href)) {
          arr.push({ kind: 'link', href: done.href, content: done.content });
        } else {
          // Refused scheme: keep the words, drop the link.
          arr.push(...done.content);
        }
      } else {
        arr.push({ kind: done.kind, content: done.content });
      }
      return;
    }
  };

  const flushRun = () => {
    while (marks.length) closeMark(marks[marks.length - 1].kind);
    const content = run;
    run = [];
    if (content.length === 0) return null;
    return content;
  };

  const endBlock = () => {
    const content = flushRun();
    if (content) blocks.push({ kind: 'paragraph', content });
  };

  const endList = () => {
    if (listKind && listItems.length) {
      blocks.push({ kind: listKind, items: listItems } as RichBlock);
    }
    listKind = null;
    listItems = [];
    inItem = false;
  };

  for (const tk of tokens) {
    if (mentionDepth > 0) {
      if (tk.t === 'close' && tk.name === 'mention') mentionDepth -= 1;
      else if (tk.t === 'open' && tk.name === 'mention') mentionDepth += 1;
      continue;
    }

    if (dropDepth > 0) {
      if (tk.t === 'close' && DROP_CONTENT.has(tk.name)) dropDepth -= 1;
      else if (tk.t === 'open' && DROP_CONTENT.has(tk.name)) dropDepth += 1;
      continue;
    }

    if (tk.t === 'text') {
      const text = decodeEntities(tk.text);
      // Collapse the incidental whitespace editors emit between tags, but keep
      // a single space so words do not run together.
      if (text.trim() === '') {
        if (/[ \t\n]/.test(text) && target().length) pushText(' ');
        continue;
      }
      pushText(text.replace(/[\n\r\t]+/g, ' '));
      continue;
    }

    if (tk.t === 'open') {
      const n = tk.name;
      if (DROP_CONTENT.has(n)) {
        dropDepth += 1;
        continue;
      }
      if (n === 'mention') {
        // THE NATIVE EDITOR'S CHIP, and the one tag whose meaning is not in its
        // text. `react-native-enriched-html` keeps the indicator in an
        // ATTRIBUTE — `<mention text="sara" indicator="@">sara</mention>` — so
        // unwrapping it, which is what any unknown tag gets, dropped the "@"
        // and stored "Cc sara". `extractMentions` scans the stored markdown for
        // /@handle/, so it found nobody, `mentionUids` came out empty and
        // `onCommentWritten` paged nobody. Every native build shipped that, and
        // nothing looked wrong: the popover opened, the chip rendered, the
        // comment posted.
        //
        // Web never had it — Lexical inserts literal "@handle" text and has no
        // mention node — which is the whole reason a browser suite could not
        // see it. Emitting indicator + text here makes both surfaces store the
        // same bytes for the same act, which is what this module is for.
        //
        // The `text` attribute is authoritative and the element's own text
        // duplicates it, so the content is skipped. With no attribute to trust,
        // the content is kept instead: a degraded mention still reads.
        const indicator = attr(tk.attrs, 'indicator') ?? '';
        const label = attr(tk.attrs, 'text') ?? '';
        if (label) {
          pushText(label.startsWith(indicator) ? label : indicator + label);
          mentionDepth += 1;
        } else {
          pushText(indicator);
        }
        continue;
      }
      const openMark = (kind: 'bold' | 'italic') => {
        markDepth[kind] += 1;
        if (markDepth[kind] === 1) marks.push({ kind, content: [] });
      };
      if (n === 'b' || n === 'strong') openMark('bold');
      else if (n === 'i' || n === 'em') openMark('italic');
      else if (n === 'a') marks.push({ kind: 'link', href: attr(tk.attrs, 'href'), content: [] });
      else if (n === 'br') pushText('\n');
      else if (n === 'ul' || n === 'ol') {
        if (listDepth === 0) {
          endBlock();
          listKind = n === 'ul' ? 'bullets' : 'numbers';
          listItems = [];
        }
        listDepth += 1;
      } else if (n === 'li') {
        if (inItem) {
          const c = flushRun();
          if (c) listItems.push(c);
        }
        inItem = true;
      } else if (BLOCKISH.has(n)) {
        if (listDepth === 0) endBlock();
      }
      continue;
    }

    // close
    const n = tk.name;
    const shutMark = (kind: 'bold' | 'italic') => {
      if (markDepth[kind] === 1) closeMark(kind);
      markDepth[kind] = Math.max(0, markDepth[kind] - 1);
    };
    if (n === 'b' || n === 'strong') shutMark('bold');
    else if (n === 'i' || n === 'em') shutMark('italic');
    else if (n === 'a') closeMark('link');
    else if (n === 'li') {
      const c = flushRun();
      if (c) listItems.push(c);
      inItem = false;
    } else if (n === 'ul' || n === 'ol') {
      if (inItem) {
        const c = flushRun();
        if (c) listItems.push(c);
        inItem = false;
      }
      listDepth = Math.max(0, listDepth - 1);
      if (listDepth === 0) endList();
    } else if (BLOCKISH.has(n)) {
      if (listDepth === 0) endBlock();
    }
  }

  if (inItem) {
    const c = flushRun();
    if (c) listItems.push(c);
  }
  endList();
  endBlock();

  return serializeRich(blocks);
}
