// Ports of react-native-enriched-html 1.1.1, with this repo's patch, for
// the HTML subset richDocToDisplayHtml / markdownToPhoneEditorHtml emit:
// p, br, ul, ol, li, b, i, a. Each function names the native code it mirrors.
//
// Model of a rendered/edited document, shared by both platforms:
//   { text: string, ch: Attr[] }  where Attr = { b, i, href, list }  per UTF-16 unit
// plus a marker function.

export const ZWS = '\u200B';

// ======================================================================
// ANDROID — common/parser/EnrichedParser.java (HtmlToSpannedConverter + toHtml)
// ======================================================================

// Span flags. SPAN_EXCLUSIVE_EXCLUSIVE = POINT start, MARK end.
// SPAN_INCLUSIVE_EXCLUSIVE = MARK start, MARK end (the converter's marks).
const POINT = 'P';
const MARK = 'M';
const EE = { s: POINT, e: MARK };
const IE = { s: MARK, e: MARK };

// Priority bits from EnrichedSpanFlags.forSpan: alignment 0, inline 1, paragraph 2.
// Marks set with plain SPAN_INCLUSIVE_EXCLUSIVE carry priority 0.
class SSB {
  constructor() {
    this.text = '';
    this.spans = [];
    this.seq = 0;
  }
  setSpan(obj, start, end, flags, prio) {
    const ex = this.spans.find((s) => s.obj === obj);
    if (ex) {
      // In-place update keeps insertion order (SpannableStringBuilder.setSpan).
      Object.assign(ex, { start, end, flags, prio });
      return;
    }
    this.spans.push({ obj, start, end, flags, prio, order: this.seq++ });
  }
  removeSpan(obj) {
    const k = this.spans.findIndex((s) => s.obj === obj);
    if (k >= 0) this.spans.splice(k, 1);
  }
  rec(obj) {
    return this.spans.find((s) => s.obj === obj);
  }
  // SpannableStringBuilder.getSpans(qs, qe, kind) with sortByInsertionOrder:
  // priority descending, then insertion order ascending.
  getSpans(qs, qe, pred) {
    return this.spans
      .filter(
        (s) =>
          pred(s.obj) &&
          s.start <= qe &&
          s.end >= qs &&
          (s.start === s.end || qs === qe || (s.start !== qe && s.end !== qs)),
      )
      .sort((a, b) => b.prio - a.prio || a.order - b.order);
  }
  nextSpanTransition(start, limit, pred) {
    let n = limit;
    for (const s of this.spans) {
      if (!pred(s.obj)) continue;
      if (s.start > start && s.start < n) n = s.start;
      if (s.end > start && s.end < n) n = s.end;
    }
    return n;
  }
  append(str) {
    // Appending at the end moves nothing: no span here has a POINT bound at
    // the end (zero-length EE spans are never created), and MARKs stay put.
    this.text += str;
  }
  insert(pos, str) {
    const n = str.length;
    this.text = this.text.slice(0, pos) + str + this.text.slice(pos);
    for (const s of this.spans) {
      if (s.start > pos || (s.start === pos && s.flags.s === POINT)) s.start += n;
      if (s.end > pos || (s.end === pos && s.flags.e === POINT)) s.end += n;
    }
  }
}

// Span objects
const mk = (kind, data = {}) => ({ kind, ...data });
const isInline = (o) => o.kind === 'b' || o.kind === 'i' || o.kind === 'a';
const isParagraph = (o) => o.kind === 'ul' || o.kind === 'ol';
const isEnriched = (o) => isInline(o) || isParagraph(o);

// TagSoup stand-in: well-formed input only. Decodes named + numeric entities in
// text and attribute values, lower-cases names, emits </br> for <br>.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };
function tsDecode(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (w, b) => {
    if (b[0] === '#') {
      const cp = b[1] === 'x' || b[1] === 'X' ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10);
      return String.fromCodePoint(cp);
    }
    if (!(b in NAMED)) throw new Error('entity not modelled: ' + w);
    return NAMED[b];
  });
}
function tsEvents(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      out.push({ t: 'text', s: tsDecode(html.slice(i)) });
      break;
    }
    if (lt > i) out.push({ t: 'text', s: tsDecode(html.slice(i, lt)) });
    // TagSoup reads quoted attribute values, so a '>' inside quotes does not
    // end the tag. Our HTML never has one, but find the real end anyway.
    let j = lt + 1;
    let q = null;
    for (; j < html.length; j++) {
      const c = html[j];
      if (q) {
        if (c === q) q = null;
      } else if (c === '"' || c === "'") q = c;
      else if (c === '>') break;
    }
    const raw = html.slice(lt + 1, j);
    if (raw[0] === '/') out.push({ t: 'end', n: raw.slice(1).trim().toLowerCase() });
    else {
      const m = /^([^\s/>]+)/.exec(raw);
      const n = m[1].toLowerCase();
      const attrs = {};
      for (const a of raw.slice(m[1].length).matchAll(/([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
        attrs[a[1].toLowerCase()] = tsDecode(a[3] ?? a[4]);
      out.push({ t: 'start', n, attrs });
      if (n === 'br') out.push({ t: 'end', n: 'br' });
    }
    i = j + 1;
  }
  return out;
}

// Static fields of HtmlToSpannedConverter: they persist across parses.
const AS = { olIndex: 0, inOl: false, empty: false };

function androidFromHtml(html) {
  const sb = new SSB();
  const isMark = (k) => (o) => o.kind === k;
  const getLast = (k) => {
    const all = sb.getSpans(0, sb.text.length, isMark(k));
    return all.length ? all[all.length - 1].obj : null;
  };
  const start = (mark) => sb.setSpan(mark, sb.text.length, sb.text.length, IE, 0);
  const appendNewlines = (min) => {
    const len = sb.text.length;
    if (len === 0) return;
    let ex = 0;
    for (let i = len - 1; i >= 0 && sb.text[i] === '\n'; i--) ex++;
    for (let j = ex; j < min; j++) sb.append('\n');
  };
  const startBlock = () => {
    appendNewlines(1);
    start(mk('Newline'));
  };
  const endBlock = () => {
    const n = getLast('Newline');
    if (n) {
      appendNewlines(1);
      sb.removeSpan(n);
    }
    // Alignment marks: none in our HTML.
  };
  const setSpanFromMark = (mark, span) => {
    const where = sb.rec(mark).start;
    sb.removeSpan(mark);
    const len = sb.text.length;
    if (where !== len) sb.setSpan(span, where, len, EE, isInline(span) ? 1 : 2);
  };
  const setParagraphSpanFromMark = (mark, span) => {
    const where = sb.rec(mark).start;
    sb.removeSpan(mark);
    let len = sb.text.length;
    if (AS.empty) {
      sb.append(ZWS);
      len++;
    }
    if (len > 0 && sb.text[len - 1] === '\n') len--;
    if (where !== len) sb.setSpan(span, where, len, EE, 2);
  };
  const end = (k, span) => {
    const o = getLast(k);
    if (o) setSpanFromMark(o, span);
  };

  for (const ev of tsEvents(html)) {
    if (ev.t === 'start') {
      switch (ev.n) {
        case 'p':
          AS.empty = true;
          startBlock();
          break;
        case 'ul':
          AS.inOl = false;
          startBlock();
          break;
        case 'ol':
          AS.inOl = true;
          AS.olIndex = 0;
          startBlock();
          break;
        case 'li':
          AS.empty = true;
          startBlock();
          if (AS.inOl) {
            AS.olIndex++;
            start(mk('List', { type: 'ordered', index: AS.olIndex }));
          } else start(mk('List', { type: 'unordered', index: 0 }));
          break;
        case 'b':
          start(mk('Bold'));
          break;
        case 'i':
          start(mk('Italic'));
          break;
        case 'a':
          start(mk('Href', { href: ev.attrs.href ?? null }));
          break;
        case 'html':
        case 'body':
        case 'br':
          break;
        default:
          throw new Error('tag not modelled: ' + ev.n);
      }
    } else if (ev.t === 'end') {
      switch (ev.n) {
        case 'br':
          sb.append('\n');
          break;
        case 'p': {
          const empty = AS.empty;
          endBlock();
          if (empty) sb.append('\n');
          break;
        }
        case 'ul':
        case 'ol':
          endBlock();
          break;
        case 'li': {
          endBlock();
          const l = getLast('List');
          if (l) setParagraphSpanFromMark(l, mk(l.type === 'ordered' ? 'ol' : 'ul', { index: l.index }));
          endBlock();
          break;
        }
        case 'b':
          end('Bold', mk('b'));
          break;
        case 'i':
          end('Italic', mk('i'));
          break;
        case 'a': {
          const h = getLast('Href');
          if (h && h.href != null) setSpanFromMark(h, mk('a', { href: h.href }));
          break;
        }
      }
    } else {
      // characters(): collapse ' ' and '\n' after ' ' / '\n' / start of text.
      let s = '';
      for (const c of ev.s) {
        if (c === ' ' || c === '\n') {
          const pred = s.length ? s[s.length - 1] : sb.text.length ? sb.text[sb.text.length - 1] : '\n';
          if (pred !== ' ' && pred !== '\n') s += ' ';
        } else s += c;
      }
      if (s.length > 0) AS.empty = false;
      sb.append(s);
    }
  }
  // convert(): fix ParagraphStyle ranges.
  for (const r of sb.getSpans(0, sb.text.length, isParagraph)) {
    let e = r.end;
    if (e - 2 >= 0 && sb.text[e - 1] === '\n' && sb.text[e - 2] === '\n') e--;
    if (e === r.start) sb.removeSpan(r.obj);
    else sb.setSpan(r.obj, r.start, e, EE, 2);
  }
  // convert(): a ZWS at the start of every paragraph span.
  for (const r of sb.getSpans(0, sb.text.length, isParagraph).map((x) => x.obj)) {
    const rr = sb.rec(r);
    const s0 = rr.start;
    let e0 = rr.end;
    if (s0 >= sb.text.length) throw new Error('charAt out of bounds');
    if (sb.text[s0] !== ZWS) {
      const coloc = sb.getSpans(s0, s0 + 1, isEnriched).map((x) => x.obj);
      sb.insert(s0, ZWS);
      e0++;
      for (const o of coloc) {
        if (o === r) continue;
        const or = sb.rec(o);
        if (or.start !== s0 + 1) continue;
        const oe = or.end;
        sb.removeSpan(o);
        sb.setSpan(o, s0, oe, EE, 0); // plain SPAN_EXCLUSIVE_EXCLUSIVE: priority bits lost
      }
    }
    sb.removeSpan(r);
    sb.setSpan(r, s0, e0, EE, 2);
  }
  return sb;
}

// CharSequence.trimEnd('\n') on a SpannableStringBuilder: subSequence keeps
// spans clipped to the new length.
function trimEndNl(sb) {
  let end = sb.text.length;
  while (end > 0 && sb.text[end - 1] === '\n') end--;
  const out = new SSB();
  out.text = sb.text.slice(0, end);
  for (const s of sb.spans) {
    const st = Math.min(s.start, end);
    const en = Math.min(s.end, end);
    // subSequence drops spans entirely outside, keeps empty ones only if they were empty
    if (s.start > end) continue;
    if (st === en && s.start !== s.end) continue;
    out.spans.push({ ...s, start: st, end: en });
  }
  out.seq = sb.seq;
  return out;
}

// EnrichedTextView: fromHtml(...).trimEnd('\n'); then android.text.Layout draws
// LeadingMarginSpans of each paragraph (spans covering the paragraph's first
// character): the ordered marker on the paragraph's first line ("first"), the
// bullet when getSpanStart(span) == line start.
export function androidDisplayModel(html) {
  const sb = trimEndNl(androidFromHtml(html));
  return sbToModel(sb);
}
function sbToModel(sb) {
  const text = sb.text;
  const ch = [];
  for (let p = 0; p < text.length; p++) {
    const a = { b: false, i: false, href: null };
    for (const s of sb.spans) {
      if (!(s.start <= p && p < s.end)) continue;
      if (s.obj.kind === 'b') a.b = true;
      if (s.obj.kind === 'i') a.i = true;
      if (s.obj.kind === 'a') a.href = s.obj.href;
    }
    ch.push(a);
  }
  const markerAt = (ps) => {
    // spans with s <= ps < e (LeadingMarginSpan collection at paragraph start)
    const covering = sb.spans.filter((s) => isParagraph(s.obj) && s.start <= ps && ps < s.end);
    if (ps === text.length && ps > 0) return '';
    const ms = [];
    for (const s of covering) {
      if (s.obj.kind === 'ol') ms.push(`${s.obj.index}.`);
      else if (s.start === ps) ms.push('•');
    }
    return ms.join('');
  };
  return { text, ch, markerAt, spans: sb.spans };
}

// android.text.TextUtils.htmlEncode
const htmlEncode = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

// EnrichedParser.toHtml(Spanned) — what the Android input emits (onChangeHtml).
function androidToHtml(sb) {
  let out = '';
  const text = sb.text;
  const end = text.length;
  const inlinePred = isInline;
  const withinStyle = (s, e) => {
    for (let i = s; i < e; i++) {
      const c = text.charCodeAt(i);
      const chr = text[i];
      if (chr === ZWS) continue;
      else if (chr === '<') out += '&lt;';
      else if (chr === '>') out += '&gt;';
      else if (chr === '&') out += '&amp;';
      else if (c >= 0xd800 && c <= 0xdfff) {
        if (c < 0xdc00 && i + 1 < e) {
          const d = text.charCodeAt(i + 1);
          if (d >= 0xdc00 && d <= 0xdfff) {
            i++;
            const cp = (0x010000 | ((c - 0xd800) << 10)) | (d - 0xdc00);
            out += `&#${cp};`;
          }
        }
      } else if (c > 0x7e || c < 0x20) out += `&#${c};`;
      else if (chr === ' ') {
        while (i + 1 < e && text[i + 1] === ' ') {
          out += '&nbsp;';
          i++;
        }
        out += ' ';
      } else out += chr;
    }
  };
  const withinParagraph = (s, e) => {
    for (let i = s; i < e; ) {
      const next = sb.nextSpanTransition(i, e, inlinePred);
      const style = sb.getSpans(i, next, inlinePred).map((x) => x.obj);
      for (const st of style) {
        if (st.kind === 'b') out += '<b>';
        if (st.kind === 'i') out += '<i>';
        // TextUtils.htmlEncode, which this repo's patch adds.
        if (st.kind === 'a') out += `<a href="${htmlEncode(st.href)}">`;
      }
      withinStyle(i, next);
      for (let j = style.length - 1; j >= 0; j--) {
        const st = style[j];
        if (st.kind === 'a') out += '</a>';
        if (st.kind === 'b') out += '</b>';
        if (st.kind === 'i') out += '</i>';
      }
      i = next;
    }
  };
  let inUl = false;
  let inOl = false;
  for (let i = 0; i <= end; ) {
    let next = text.indexOf('\n', i);
    if (next < 0 || next >= end) next = end;
    if (next === i) {
      if (inUl) {
        inUl = false;
        out += '</ul>\n';
      } else if (inOl) {
        inOl = false;
        out += '</ol>\n';
      }
      out += '<br>\n';
    } else {
      const ps = sb.getSpans(i, next, isParagraph).map((x) => x.obj);
      let tag = 'p';
      for (const p of ps) {
        if (p.kind === 'ul') {
          tag = 'ul';
          break;
        }
        if (p.kind === 'ol') {
          tag = 'ol';
          break;
        }
      }
      const isUl = tag === 'ul';
      const isOl = tag === 'ol';
      if (inUl && !isUl) {
        inUl = false;
        out += '</ul>\n';
      } else if (inOl && !isOl) {
        inOl = false;
        out += '</ol>\n';
      }
      if (isUl && !inUl) {
        inUl = true;
        out += '<ul>\n';
      } else if (isOl && !inOl) {
        inOl = true;
        out += '<ol>\n';
      }
      const tt = isUl || isOl ? 'li' : tag;
      out += `<${tt}>`;
      withinParagraph(i, next);
      out += `</${tt}>\n`;
      if (next === end && inUl) {
        inUl = false;
        out += '</ul>\n';
      } else if (next === end && inOl) {
        inOl = false;
        out += '</ol>\n';
      }
    }
    i = next + 1;
  }
  out = out.replace(/<p(?![^>]*text-align\s*:)[^>]*><\/p>/g, '<br>');
  return '<html>\n' + out + '</html>';
}

// EnrichedTextInputView.setValue(defaultValue): parseText → fromHtml(...).trimEnd('\n').
// Watchers are suspended during the transaction, so nothing else runs on open.
export function androidEditorRoundTrip(html) {
  return androidToHtml(trimEndNl(androidFromHtml(html)));
}

// ======================================================================
// iOS — ios/htmlParser/HtmlParser.mm + TextHtmlParser.mm / InputHtmlParser.mm
// ======================================================================

const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'b', 'a', 's', 'mention', 'code', 'u', 'i']);
// [NSCharacterSet whitespaceAndNewlineCharacterSet]: Z* + U+0009–U+000D + U+0085.
// Control characters are what these sets are made of.
// eslint-disable-next-line no-control-regex
const WS_NL = new RegExp('[\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]');
// [NSCharacterSet newlineCharacterSet]
// eslint-disable-next-line no-control-regex
const NL = new RegExp('[\\u000A-\\u000D\\u0085\\u2028\\u2029]');

function stripExtra(html) {
  let out = '';
  let tagBuf = '';
  let reading = false;
  let depth = 0;
  for (let i = 0; i < html.length; i++) {
    const c = html[i];
    if (c === '<') {
      reading = true;
      tagBuf = '';
      out += '<';
    } else if (c === '>') {
      reading = false;
      out += '>';
      const full = tagBuf.toLowerCase();
      const clean = full.replace(/^\/+|\/+$/g, '');
      const name = clean.split(WS_NL)[0];
      if (!TEXT_TAGS.has(name)) continue;
      if (full.startsWith('/')) depth = Math.max(0, depth - 1);
      else if (!full.endsWith('/')) depth++;
    } else {
      if (reading) {
        tagBuf += c;
        out += c;
        continue;
      }
      if (depth > 0) out += c;
      else if (!WS_NL.test(c)) out += c;
    }
  }
  return out;
}
const rep = (s, a, b) => s.split(a).join(b);
function addNl(s, tag, leading, trailing) {
  if (leading) s = rep(s, `>${tag}`, `>\n${tag}`);
  if (trailing) s = rep(s, `${tag}<`, `${tag}\n<`);
  return s;
}
function iosInitially(html) {
  const ws = stripExtra(html);
  let f = null;
  if (ws.length >= 13) {
    if (ws.slice(0, 6) === '<html>' && ws.slice(-7) === '</html>') {
      f = ws;
      f = rep(f, '<html>\n', '');
      f = rep(f, '\n</html>', '');
      f = rep(f, '<html>', '');
      f = rep(f, '</html>', '');
    }
    if (f !== null) {
      f = rep(f, '<body>\n', '<body>');
      f = rep(f, '\n</body>', '</body>');
    }
  }
  if (f === null) return null;
  f = rep(f, '<p></p>', '<br>');
  f = rep(f, '<li><p>', '<li>');
  f = rep(f, '</p></li>', '</li>');
  f = rep(f, '<br/>', '<br>');
  f = rep(f, '<p><br>', '<br>');
  f = rep(f, '<br></p>', '<br>');
  f = rep(f, '<blockquote></blockquote>', '<blockquote><br></blockquote>');
  f = rep(f, '<codeblock></codeblock>', '<codeblock><br></codeblock>');
  f = rep(f, '<ul></ul>', '');
  f = rep(f, '<ul data-type="checkbox"></ul>', '');
  f = rep(f, '<ol></ol>', '');
  for (const t of ['<br>', '<ul>', '</ul>', '<ol>', '</ol>', '<blockquote>', '</blockquote>', '<codeblock>', '</codeblock>'])
    f = addNl(f, t, true, true);
  for (const t of ['<p>', '<li>', '<li checked>', '<h1>', '<h2>', '<h3>', '<h4>', '<h5>', '<h6>']) f = addNl(f, t, true, false);
  for (const t of ['</p>', '</li>', '</h1>', '</h2>', '</h3>', '</h4>', '</h5>', '</h6>']) f = addNl(f, t, false, true);
  return f;
}
// NSString getEscapedCharactersInfoFrom: &amp; &lt; &gt; and numeric only.
function iosEntities(text) {
  const res = new Map();
  for (const [k, v] of [['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>']]) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(k, from);
      if (at < 0) break;
      res.set(at, [k, v]);
      from = at + k.length;
    }
  }
  for (const m of text.matchAll(/&#([xX][0-9a-fA-F]+|[0-9]+);/g)) {
    const v = m[1];
    let cp = /^[xX]/.test(v) ? parseInt(v.slice(1), 16) : parseInt(v, 10);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) cp = 0xfffd;
    res.set(m.index, [m[0], String.fromCodePoint(cp)]);
  }
  return res;
}
const IOS_BLOCK = new Set(['ul', 'ol', 'blockquote', 'codeblock']);
// getTextAndStylesFromHtml — returns plain text and [tag, start, len, params] in closing order.
function iosGetTextAndStyles(fixed) {
  let plain = '';
  const ongoing = new Map();
  const processed = [];
  let insideTag = false;
  let gettingName = false;
  let gettingParams = false;
  let closing = false;
  let lastBr = false;
  let name = '';
  let params = '';
  const ents = iosEntities(fixed);
  for (let i = 0; i < fixed.length; i++) {
    const c = fixed[i];
    if (c === '<') {
      insideTag = true;
      gettingName = true;
    } else if (c === '>') {
      insideTag = gettingName = gettingParams = false;
      if (params.endsWith('/')) params = params.slice(0, -1);
      if (name === 'br') lastBr = true;
      else if (name === 'li') {
        if (!closing) ongoing.set('li', [plain.length]);
        else {
          const d = ongoing.get('li');
          if (d) {
            const inner = plain.slice(d[0]);
            if (trimSet(inner, NL).length === 0) plain += ZWS;
            ongoing.delete('li');
          }
        }
      } else if (!closing) {
        const plainP = name === 'p' && params.length === 0;
        if (!plainP) {
          ongoing.set(name, params.length > 0 ? [plain.length, 0, params] : [plain.length, 0]);
          if (IOS_BLOCK.has(name) && i + 1 < fixed.length && NL.test(fixed[i + 1])) i += 1;
        }
      } else {
        const isBlock = IOS_BLOCK.has(name);
        if (isBlock && plain.length > 0 && NL.test(plain[plain.length - 1])) {
          if (lastBr) plain = plain.slice(0, -1) + ZWS + plain.slice(-1);
          plain = plain.slice(0, -1);
        }
        const d = ongoing.get(name);
        if (d) {
          processed.push({ tag: name, start: d[0], len: plain.length - d[0], params: d[2] });
          ongoing.delete(name);
        }
      }
      closing = false;
      name = '';
      params = '';
    } else if (!insideTag) {
      const e = ents.get(i);
      if (e) {
        plain += e[1];
        i += e[0].length - 1;
      } else {
        plain += c;
        if (!NL.test(c)) lastBr = false;
      }
    } else if (gettingName) {
      if (c === ' ') {
        gettingName = false;
        gettingParams = true;
      } else if (c === '/') closing = true;
      else name += c;
    } else if (gettingParams) params += c;
  }
  const styles = [];
  for (const p of processed) {
    if (p.tag === 'b' || p.tag === 'i' || p.tag === 'ul' || p.tag === 'ol') styles.push(p);
    else if (p.tag === 'a') {
      const m = /href=".+"/.exec(p.params ?? '');
      if (!m) continue;
      const url = m[0].slice(6, -1);
      styles.push({ ...p, url, linkText: plain.slice(p.start, p.start + p.len) });
    } else if (p.tag === 'p') continue;
    else throw new Error('iOS tag not modelled: ' + p.tag);
  }
  return { plain, styles };
}
function trimSet(s, re) {
  let a = 0;
  let b = s.length;
  while (a < b && re.test(s[a])) a++;
  while (b > a && re.test(s[b - 1])) b--;
  return s.slice(a, b);
}

// An NSTextStorage stand-in: per-unit attributes. `list` is the paragraph
// style's text list ('ul' | 'ol' | null); `link` is LinkData {url, text}.
class IosStore {
  constructor(text) {
    this.text = text;
    this.a = [...text].length === text.length ? null : null;
    this.at = Array.from({ length: text.length }, () => ({ b: false, i: false, link: null, list: null }));
  }
  // NSString paragraphRangeForRange (paragraph separators: our text only has '\n')
  paraRange(loc, len) {
    let s = loc;
    while (s > 0 && this.text[s - 1] !== '\n') s--;
    const last = len > 0 ? loc + len - 1 : loc;
    let e = last;
    if (len > 0 && this.text[last] === '\n') e = last + 1;
    else {
      while (e < this.text.length && this.text[e] !== '\n') e++;
      if (e < this.text.length) e++;
    }
    return [s, e];
  }
  replace(loc, len, str) {
    // replaceCharactersInRange: new characters take the attributes of the first replaced one.
    const base = len > 0 ? this.at[loc] : loc > 0 ? this.at[loc - 1] : { b: false, i: false, link: null, list: null };
    this.text = this.text.slice(0, loc) + str + this.text.slice(loc + len);
    this.at.splice(loc, len, ...Array.from({ length: str.length }, () => ({ ...base })));
  }
  insertWithAttrs(loc, str, attrs) {
    this.text = this.text.slice(0, loc) + str + this.text.slice(loc);
    this.at.splice(loc, 0, ...Array.from({ length: str.length }, () => ({ ...attrs })));
  }
  // links: enumerateAttribute merges adjacent equal LinkData (isEqual: text+url)
  linkRuns(s, e) {
    const runs = [];
    for (let k = s; k < e; k++) {
      const l = this.at[k].link;
      if (!l) continue;
      const last = runs[runs.length - 1];
      if (last && last.end === k && last.link.url === l.url && last.link.text === l.text) last.end = k + 1;
      else runs.push({ start: k, end: k + 1, link: l });
    }
    return runs;
  }
  fullLinkRange(loc) {
    let s = loc === this.text.length ? loc - 1 : loc;
    if (s < 0) return [0, 0];
    const l = this.at[s].link;
    if (!l) return [0, 0];
    let a = s;
    let b = s + 1;
    const same = (x) => x && x.url === l.url && x.text === l.text;
    while (a > 0 && same(this.at[a - 1].link)) a--;
    while (b < this.text.length && same(this.at[b].link)) b++;
    return [a, b];
  }
  removeLinksIn(s, e) {
    for (const r of this.linkRuns(s, e)) {
      const [a, b] = this.fullLinkRange(r.start);
      for (let k = a; k < b; k++) this.at[k].link = null;
    }
  }
  anyList(kind, s, e) {
    for (let k = s; k < e; k++) if (this.at[k].list === kind) return true;
    return false;
  }
  detectListAt(kind, idx) {
    // OccurenceUtils detect atIndex checkPrevious:YES (zero-length)
    if (idx === this.text.length) {
      const [ps] = this.paraRange(idx, 0);
      if (ps === idx) return false;
      return this.at[ps].list === kind;
    }
    return this.at[idx].list === kind;
  }
  setList(kind, s, e) {
    const [ps, pe] = this.paraRange(s, e - s);
    for (let k = ps; k < pe; k++) this.at[k].list = kind; // textListsByAdding (conflicts already removed)
  }
  removeList(kind, s, e) {
    const [ps, pe] = this.paraRange(s, e - s);
    for (let k = ps; k < pe; k++) if (this.at[k].list === kind) this.at[k].list = null;
  }
  // ZeroWidthSpaceUtils addSpacesIfNeededInHost:inRange:
  addZwsIn(s, len) {
    const [ss, se] = this.paraRange(s, len);
    const idx = [];
    for (let k = ss; k < se; k++) {
      if (this.text[k] === '\n') {
        const [ps, pe] = this.paraRange(k, 1);
        if (pe - ps === 1 && this.at[k].list) idx.push(ps);
      }
    }
    let off = 0;
    for (const k of idx) {
      this.replace(k + off, 1, ZWS + '\n');
      off++;
    }
    return off;
  }
  // ZeroWidthSpaceUtils removeSpacesIfNeededinHost (input only)
  removeZws() {
    const rm = [];
    for (let k = 0; k < this.text.length; k++) {
      if (this.text[k] !== ZWS) continue;
      const [ps, pe] = this.paraRange(k, 1);
      let remove = pe - ps > 1;
      if (pe - ps === 2 && ps === k && NL.test(this.text[k + 1] ?? '')) remove = false;
      if (remove) {
        rm.push(k);
        continue;
      }
      if (!this.at[k].list) rm.push(k);
    }
    let off = 0;
    for (const k of rm) {
      this.replace(k + off, 1, '');
      off--;
    }
  }
}

function applyIosStyles(store, styles, { input }) {
  let zoff = 0;
  for (const st of styles) {
    const before = store.text.length;
    const s = st.start + zoff;
    const len = st.len;
    const e = s + len;
    // StyleUtils handleStyleBlocksAndConflicts
    if (st.tag === 'a') {
      const present = len >= 1 ? store.linkRuns(s, e).length > 0 : s < store.text.length && !!store.at[s].link;
      if (present) {
        if (len >= 1) store.removeLinksIn(s, e);
        else {
          // removeTyping: whole link at the selection. EnrichedTextView keeps
          // selectedRange at (0,0); the input's selection is at the end.
          const sel = input ? store.text.length : 0;
          const [a, b] = store.fullLinkRange(sel);
          for (let k = a; k < b; k++) store.at[k].link = null;
        }
      }
    } else if (st.tag === 'ul' || st.tag === 'ol') {
      const other = st.tag === 'ul' ? 'ol' : 'ul';
      const present = len >= 1 ? store.anyList(other, s, e) : store.detectListAt(other, s, input);
      if (present) store.removeList(other, s, e);
    }
    // apply
    if (st.tag === 'a') {
      if (len > 0) {
        const data = { url: st.url, text: st.linkText };
        for (let k = s; k < e; k++) store.at[k].link = data;
        if (input) connectedLinksCheck(store);
      }
    } else if (st.tag === 'ul' || st.tag === 'ol') store.setList(st.tag, s, e);
    else if (st.tag === 'b') for (let k = s; k < e; k++) store.at[k].b = true;
    else if (st.tag === 'i') for (let k = s; k < e; k++) store.at[k].i = true;
    if (!input) store.addZwsIn(s, len); // TextHtmlParser only
    const delta = store.text.length - before;
    if (delta !== 0) zoff += delta;
  }
}

// LinkStyle addLink → removeConnectedLinksIfNeeded on the word at the selection
// (the end of the text while the input is being filled).
function connectedLinksCheck(store) {
  const w = currentWordAtEnd(store.text);
  if (!w) return;
  const [s, e] = w;
  let onlyLinks = true;
  for (let k = s; k < e; k++) if (!store.at[k].link) onlyLinks = false;
  if (onlyLinks && store.linkRuns(s, e).length !== 1) store.removeLinksIn(s, e);
}
function currentWordAtEnd(text) {
  // WordsUtils getCurrentWord with selection (len, 0)
  if (text.length === 0) return null;
  const isWs = (c) => WS_NL.test(c);
  let left = text.length - 1;
  left = Math.min(left, text.length - 1);
  if (left > 0) {
    while (left >= 0) {
      if (isWs(text[left])) {
        left += 1;
        break;
      }
      left -= 1;
    }
  }
  left = Math.max(0, left);
  left = Math.min(text.length - 1, left);
  const right = text.length - 1;
  if (left > right) return null;
  const words = [];
  let cur = '';
  let cs = left;
  for (let k = left; k <= right; k++) {
    if (isWs(text[k])) {
      if (cur.length) words.push([cs, cs + cur.length]);
      cur = '';
      cs = k + 1;
    } else cur += text[k];
  }
  if (cur.length) words.push([cs, right + 1]);
  return words.length === 1 ? words[0] : null;
}

// LinkStyle handleManualLinks over every word (dirty ranges cover all styled text).
function handleManualLinks(store) {
  const text = store.text;
  let k = 0;
  while (k < text.length) {
    while (k < text.length && WS_NL.test(text[k])) k++;
    const s = k;
    while (k < text.length && !WS_NL.test(text[k])) k++;
    const e = k;
    if (e <= s) continue;
    const runs = store.linkRuns(s, e);
    if (!runs.length) continue;
    let min = null;
    let max = null;
    for (const r of runs) {
      if (!min || r.start < min.start) min = r;
      if (!max || r.end - 1 > max.end - 1) max = r;
    }
    if (min.link.url === max.link.url && min.link.text === max.link.text) {
      for (let q = min.start; q < max.end; q++) store.at[q].link = min.link;
    }
  }
}

export function iosDisplayModel(html) {
  const fixed = iosInitially(html);
  if (fixed === null) return { raw: true, text: html };
  const { plain, styles } = iosGetTextAndStyles(fixed);
  const store = new IosStore(plain);
  applyIosStyles(store, styles, { input: false });
  return storeToModel(store);
}
function storeToModel(store) {
  const text = store.text;
  const ch = store.at.map((x) => ({ b: x.b, i: x.i, href: x.link ? x.link.url : null }));
  // LayoutManagerExtension drawLists: every paragraph in a list run gets its
  // marker on its first line; the decimal is 1 + consecutive OL paragraphs before it.
  const markerAt = (ps) => {
    if (ps >= text.length) return '';
    const l = store.at[ps].list;
    if (l === 'ul') return '•';
    if (l === 'ol') {
      let n = 1;
      let p = ps;
      while (p > 0) {
        const [prev] = store.paraRange(p - 1, 0);
        if (store.detectListAt('ol', prev, false)) {
          n++;
          p = prev;
        } else break;
      }
      return `${n}.`;
    }
    return '';
  };
  return { text, ch, markerAt, store };
}

// InputHtmlParser.replaceWholeFromHtml + anyTextMayHaveBeenModified
export function iosInputOpen(html) {
  const fixed = iosInitially(html);
  if (fixed === null) throw new Error('iOS input: not internal html');
  const { plain, styles } = iosGetTextAndStyles(fixed);
  const store = new IosStore(plain);
  applyIosStyles(store, styles, { input: true });
  store.removeZws();
  store.addZwsIn(0, store.text.length);
  handleManualLinks(store);
  return store;
}

// HtmlParser parseToHtmlFromRange — the iOS input's HTML output.
const T = { UL: 2, OL: 3, LINK: 12, B: 16, I: 17 };
export function iosToHtml(store) {
  const text = store.text;
  if (text.length === 0) return '<html>\n<p></p>\n</html>';
  const esc = (c) => c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tag = (t, opening, loc) => {
    if (t === T.B) return 'b';
    if (t === T.I) return 'i';
    if (t === T.LINK) return opening && store.at[loc].link ? `a href="${store.at[loc].link.url}"` : 'a';
    return 'li';
  };
  let r = '<html>';
  let prev = new Set();
  let newLine = true;
  let inUl = false;
  let inOl = false;
  let lastChar = '';
  for (let i = 0; i < text.length; i++) {
    const a = store.at[i];
    const cur = new Set();
    const begin = new Map();
    const det = [];
    if (a.list === 'ul') det.push(T.UL);
    if (a.list === 'ol') det.push(T.OL);
    if (a.link) det.push(T.LINK);
    if (a.b) det.push(T.B);
    if (a.i) det.push(T.I);
    for (const t of det) {
      cur.add(t);
      if (!prev.has(t)) begin.set(t, i);
    }
    const c = text[i];
    if (NL.test(c)) {
      if (newLine) {
        if (inOl) {
          if (store.detectListAt('ol', i, true)) r += '\n<li></li>';
          else {
            r += '\n</ol>\n<br>';
            inOl = false;
          }
        } else if (inUl) {
          if (store.detectListAt('ul', i, true)) r += '\n<li></li>';
          else {
            r += '\n</ul>\n<br>';
            inUl = false;
          }
        } else r += '\n<br>';
      } else {
        for (const t of [...prev].sort((x, y) => y - x)) r += `</${tag(t, false, i)}>`;
        if (!(prev.has(T.UL) || prev.has(T.OL))) r += '</p>';
      }
      prev = new Set();
      newLine = true;
    } else {
      if (newLine) {
        newLine = false;
        if (inUl && !cur.has(T.UL)) {
          inUl = false;
          r += '\n</ul>';
        }
        if (inOl && !cur.has(T.OL)) {
          inOl = false;
          r += '\n</ol>';
        }
        if (!inUl && cur.has(T.UL)) {
          inUl = true;
          r += '\n<ul>';
        }
        if (!inOl && cur.has(T.OL)) {
          inOl = true;
          r += '\n<ol>';
        }
        if (cur.has(T.UL) || cur.has(T.OL)) r += '\n';
        else r += '\n<p>';
      }
      const ended = new Set([...prev].filter((t) => !cur.has(t)));
      const fixedEnded = new Set(ended);
      const readd = new Set();
      for (const st of ended) {
        const sb = begin.get(st) ?? 0;
        for (const act of cur) {
          const ab = begin.get(act) ?? 0;
          if ((ab > sb && ab < i) || (ab === sb && ab < i && act > st)) {
            fixedEnded.add(act);
            readd.add(act);
          }
        }
      }
      const news = new Set([...cur].filter((t) => !prev.has(t)));
      const still = new Set([...prev].filter((t) => cur.has(t)));
      for (const st of news)
        for (const og of still)
          if (og > st) {
            fixedEnded.add(og);
            readd.add(og);
          }
      for (const t of [...fixedEnded].sort((x, y) => y - x)) r += `</${tag(t, false, i)}>`;
      for (const t of readd) news.add(t);
      for (const t of [...news].sort((x, y) => x - y)) r += `<${tag(t, true, i)}>`;
      r += esc(c);
      prev = cur;
    }
    lastChar = c;
  }
  if (!NL.test(lastChar)) {
    for (const t of [...prev].sort((x, y) => y - x)) r += `</${tag(t, false, text.length - 1)}>`;
    if (prev.has(T.UL)) r += '\n</ul>';
    else if (prev.has(T.OL)) r += '\n</ol>';
    else r += '</p>';
  } else {
    if (inUl) r += '\n</ul>';
    if (inOl) r += '\n</ol>';
  }
  r += '\n</html>';
  r = rep(r, '￼', '');
  r = rep(r, ZWS, '');
  r = rep(r, '<p></p>', '<br>');
  return r;
}

// ======================================================================
// Canonical "what a reader sees": lines of [marker, cells]; cell = char + flags.
// ======================================================================
export function modelLines(m, { decodeHref = (h) => h } = {}) {
  const out = [];
  const text = m.text;
  let ps = 0;
  for (;;) {
    let pe = text.indexOf('\n', ps);
    if (pe < 0) pe = text.length;
    const cells = [];
    for (let k = ps; k < pe; k++) {
      const c = text[k];
      if (c === ZWS) continue;
      const a = m.ch[k];
      cells.push({ c: c === '\u00A0' ? ' ' : c, b: a.b, i: a.i, href: a.href == null ? null : decodeHref(a.href) });
    }
    out.push({ marker: m.markerAt(ps), cells });
    if (pe >= text.length) break;
    ps = pe + 1;
  }
  return out;
}
