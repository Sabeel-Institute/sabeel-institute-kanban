import { describe, it, expect } from 'vitest';
import {
  decodeDisplayHref,
  htmlToMarkdown,
  markdownToHtml,
  markdownToPhoneEditorHtml,
  richDocToDisplayHtml,
} from '../src/richtextHtml';
import { extractMentions, mentionInsertion } from '../src/mentions';
import {
  normalizeMarkdown,
  parseRich,
  parseRichForDisplay,
  serializeRich,
  toPlainText,
  type RichDoc,
  type RichInline,
} from '../src/richtext';

/**
 * The seam both editors speak.
 *
 * The important assertions are the DEGRADATION table and the round trip —
 * `htmlToMarkdown` is the paste whitelist, so every row of "what happens to
 * something we do not speak" is a security and fidelity statement, not a
 * nicety.
 */

const trip = (md: string) => htmlToMarkdown(markdownToHtml(md));

describe('pasting a phone’s copied text', () => {
  it('turns its no-break spaces back into spaces', () => {
    expect(htmlToMarkdown('<p>a&#160;b\u00A0c&nbsp;d</p>')).toBe('a b c d');
  });
});

describe('markdown to HTML and back', () => {
  it('round-trips each element', () => {
    for (const md of [
      '**bold**',
      '*italic*',
      '[label](https://example.org)',
      '- one\n- two',
      '1. one\n2. two',
      'plain text',
    ]) {
      expect(trip(md), md).toBe(md);
    }
  });

  it('round-trips nested marks and mixed blocks', () => {
    const md = '**bold with [link](https://x.test) inside**\n\n- *a*\n- **b**\n\n1. one';
    expect(trip(md)).toBe(md);
  });

  it('keeps a soft line break inside a paragraph', () => {
    expect(markdownToHtml('a\nb')).toContain('<br>');
    expect(trip('a\nb')).toBe('a\nb');
  });

  it('keeps paragraph breaks distinct from line breaks', () => {
    expect(trip('a\n\nb')).toBe('a\n\nb');
    expect(trip('a\nb')).toBe('a\nb');
  });

  it('escapes and restores literal markdown characters', () => {
    for (const md of [normalizeMarkdown('2 * 3'), 'snake_case_name', 'a`b', '~x~']) {
      expect(trip(md), md).toBe(md);
    }
  });

  it('escapes and restores HTML-significant characters', () => {
    // A legacy description containing <not a tag> must not be eaten.
    const md = 'compare <not a tag> & "quotes"';
    expect(toPlainText(trip(md))).toBe(md);
  });
});

describe('degradation — what happens to everything we do not speak', () => {
  const cases: [string, string, string][] = [
    ['heading becomes a paragraph', '<h1>Title</h1>', 'Title'],
    ['quote becomes a paragraph', '<blockquote>quoted</blockquote>', 'quoted'],
    ['underline keeps its text', '<u>under</u>', 'under'],
    ['strikethrough keeps its text', '<s>gone</s>', 'gone'],
    ['inline code keeps its text', '<code>x = 1</code>', 'x = 1'],
    ['code block keeps its text', '<pre>line</pre>', 'line'],
    ['checkbox list becomes a bullet list', '<ul data-type="checkbox"><li>a</li></ul>', '- a'],
    ['unknown tag is unwrapped', '<span class="x">kept</span>', 'kept'],
    ['mention flattens to its text', '<mention>@sara</mention>', '@sara'],
    ['image is dropped entirely', '<p>before<img src="x.png">after</p>', 'beforeafter'],
    ['script is dropped, content and all', '<p>a</p><script>alert(1)</script>', 'a'],
    ['style is dropped, content and all', '<style>p{color:red}</style><p>b</p>', 'b'],
  ];
  for (const [name, html, expected] of cases) {
    it(name, () => {
      expect(htmlToMarkdown(html)).toBe(expected);
    });
  }

  it('flattens a nested list to one level, losing no items', () => {
    const md = htmlToMarkdown('<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>');
    expect(toPlainText(md).split('\n').sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops a refused scheme but keeps the label', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>')).toBe('click');
    expect(htmlToMarkdown('<a href="https://ok.test">click</a>')).toBe(
      '[click](https://ok.test)',
    );
  });

  it('never emits a tag outside the vocabulary', () => {
    const html = markdownToHtml('**b** *i* [l](https://x.test)\n\n- a\n\n1. n');
    const tags = [...html.matchAll(/<([a-z]+)/g)].map((m) => m[1]);
    expect([...new Set(tags)].sort()).toEqual(['a', 'b', 'i', 'li', 'ol', 'p', 'ul']);
  });
});

describe('both editor dialects', () => {
  it('collapses a doubled mark rather than nesting it', () => {
    // Lexical emits <b><strong>x</strong></b> for ONE bold run; nested that
    // serializes as ****x****, which is not even valid emphasis.
    expect(htmlToMarkdown('<b><strong>x</strong></b>')).toBe('**x**');
    expect(htmlToMarkdown('<i><em>y</em></i>')).toBe('*y*');
    expect(htmlToMarkdown('<b><i><b>z</b></i></b>')).toBe('***z***');
  });

  it('reads Lexical output', () => {
    // Lexical emits <strong>/<em>, wrapping spans, dir attributes and li value.
    const html =
      '<p dir="ltr"><span style="white-space: pre-wrap;"><strong>bold</strong> and <em>it</em></span></p>' +
      '<ol><li value="1"><span>one</span></li><li value="2"><span>two</span></li></ol>';
    expect(htmlToMarkdown(html)).toBe('**bold** and *it*\n\n1. one\n2. two');
  });

  it('reads enriched-html output', () => {
    const html = '<p><b>bold</b> and <i>it</i></p><ul><li>one</li></ul>';
    expect(htmlToMarkdown(html)).toBe('**bold** and *it*\n\n- one');
  });
});

describe('paste is safe without a paste handler', () => {
  it('reduces a rich paste to the vocabulary', () => {
    const pasted =
      '<h1>Heading</h1><p>Some <u>underlined</u> and <s>struck</s> text with ' +
      '<a href="https://ok.test">a link</a>.</p>' +
      '<table><tr><td>cell</td></tr></table>' +
      '<ul><li>item <code>code</code></li></ul>' +
      '<img src="x.png"><script>alert(1)</script>';
    const md = htmlToMarkdown(pasted);
    expect(md).not.toMatch(/[<>]/);
    expect(md).toContain('[a link](https://ok.test)');
    expect(toPlainText(md)).toContain('cell');
    expect(toPlainText(md)).not.toContain('alert(1)');
    // And it is already canonical, so the counter and the write agree.
    expect(normalizeMarkdown(md)).toBe(md);
  });
});

/**
 * A MENTION MUST SURVIVE THE SEAM WITH ITS INDICATOR.
 *
 * The native editor owns the mention as a <mention> node and puts the indicator
 * in an ATTRIBUTE, not in the element's text. An unknown tag is unwrapped here
 * — its text survives, the tag does not — so the "@" was silently dropped and
 * the stored body read "Cc sara". `extractMentions` scans for /@handle/, so it
 * found nobody, `mentionUids` was empty, and `onCommentWritten` paged nobody.
 * Nothing looked wrong: the popover opened, the chip rendered, the comment
 * posted.
 *
 * Web never had this — it inserts literal "@handle" text and has no mention
 * node at all — which is exactly why only a device found it. The assertion that
 * matters is the LAST one: not that the markdown looks right, but that the
 * function which decides who gets notified can still find the person.
 */
describe('mentions across the HTML seam', () => {
  const roster = [
    { uid: 'u-sara', email: 'sara@oursabeel.com', displayName: 'Sara' },
    { uid: 'u-omar', email: 'omar@oursabeel.com', displayName: 'Omar' },
  ];

  it('keeps the indicator, which lives in an attribute', () => {
    expect(
      htmlToMarkdown('<p>Cc <mention text="sara" indicator="@">sara</mention> please</p>'),
    ).toBe('Cc @sara please');
  });

  it('does not double the indicator when the text already carries it', () => {
    expect(
      htmlToMarkdown('<p><mention text="@sara" indicator="@">@sara</mention></p>'),
    ).toBe('@sara');
  });

  it('degrades to the visible text when the attributes are missing', () => {
    expect(htmlToMarkdown('<p>hi <mention>sara</mention></p>')).toBe('hi sara');
  });

  it('THE POINT: the stored body still resolves to a uid', () => {
    const body = htmlToMarkdown(
      '<p>Hi <mention text="sara" indicator="@">sara</mention> and <mention text="omar" indicator="@">omar</mention></p>',
    );
    expect(extractMentions(body, roster)).toEqual(['u-sara', 'u-omar']);
  });

  it('a mention is plain text in storage, as it is on web', () => {
    // Storage stays markdown with a literal @handle: `@` is NOT in the parse
    // set, and making it one would force it into the escape set and store
    // `\@` noise. So the chip is an editor-side representation only.
    const body = htmlToMarkdown('<p><mention text="sara" indicator="@">sara</mention></p>');
    expect(markdownToHtml(body)).toBe('<p>@sara</p>');
  });
});

/**
 * THE TWO SURFACES MUST CONVERGE — this is the test the bug needed.
 *
 * The converter tests above pin one shape. This pins the PROPERTY that made the
 * bug possible: web and native insert a mention by different mechanisms, and
 * for a month they disagreed about whether the indicator was part of the text.
 * Both now derive from `mentionInsertion`, and both paths are exercised here
 * against the same roster, asserting they produce byte-identical markdown and
 * resolve to the same uid.
 *
 * A regression on either surface alone fails this, which is what the old tests
 * could not do: they covered detection and conversion, never the round trip
 * from "the person picked a name" to "the person gets notified".
 */
describe('web and native mentions converge on the same stored markdown', () => {
  const roster = [
    { uid: 'u-sara', email: 'sara@oursabeel.com', displayName: 'Sara' },
    { uid: 'u-omar', email: 'omar@oursabeel.com', displayName: 'Omar' },
    { uid: 'u-dotted', email: 'faisal.shah@oursabeel.com', displayName: 'Faisal Shah' },
    { uid: 'u-plus', email: 'a+b@oursabeel.com', displayName: 'Plus' },
  ];

  /** What Lexical types into the document. */
  const webHtml = (c: (typeof roster)[number]) =>
    `<p>hi ${mentionInsertion(c).literal} there</p>`;

  /** What `react-native-enriched-html` serialises after setMention(). */
  const nativeHtml = (c: (typeof roster)[number]) => {
    const m = mentionInsertion(c);
    return `<p>hi <mention text="${m.text}" indicator="${m.indicator}">${m.text}</mention> there</p>`;
  };

  for (const c of roster) {
    it(`${c.displayName}: both surfaces store the same bytes and resolve`, () => {
      const fromWeb = htmlToMarkdown(webHtml(c));
      const fromNative = htmlToMarkdown(nativeHtml(c));

      expect(fromNative, 'native must store what web stores').toBe(fromWeb);
      expect(fromWeb).toBe(`hi ${mentionInsertion(c).literal} there`);

      // The assertion that actually matters: who gets notified.
      expect(extractMentions(fromWeb, roster)).toEqual([c.uid]);
      expect(extractMentions(fromNative, roster)).toEqual([c.uid]);
    });
  }

  it('a handle the indicator is missing from resolves to NOBODY', () => {
    // The bug, stated as a test: this is exactly what native used to store.
    expect(extractMentions('hi sara there', roster)).toEqual([]);
  });
});

/**
 * What a phone draws. A browser never sees this HTML, but the phones do, so this
 * is where a stray `<` or `"` in somebody's comment would become a rendering bug.
 */
describe('the display HTML the phones render', () => {
  const display = (md: string) => richDocToDisplayHtml(parseRichForDisplay(md));

  it('wraps the body so the library takes its direct parser', () => {
    expect(display('hello')).toBe('<html><p>hello</p></html>');
  });

  it('puts one line break between blocks and none inside a list', () => {
    expect(display('one\n\n- a\n- b\n\n1. c\n\ntwo')).toBe(
      '<html><p>one</p><br><ul><li>a</li><li>b</li></ul><br><ol><li>c</li></ol><br><p>two</p></html>',
    );
  });

  it('renders typed markup as the characters someone typed', () => {
    expect(display('a < b & <script>alert(1)</script>')).toBe(
      '<html><p>a &lt; b &amp; &lt;script&gt;alert(1)&lt;/script&gt;</p></html>',
    );
  });

  it('makes a bare URL tappable, as the web renderer does', () => {
    expect(display('see https://example.org/x now')).toBe(
      '<html><p>see <a href="https://example.org/x">https://example.org/x</a> now</p></html>',
    );
  });

  it('cannot let a quote in an address end the attribute', () => {
    const html = display('[x](https://example.org/a"onclick="b)');
    expect(html).not.toMatch(/href="[^"]*"onclick/);
    expect(html).toContain('&quot;');
  });

  it('keeps a run of spaces, ending each on an ordinary space to wrap at', () => {
    expect(display('a  b   c')).toBe('<html><p>a\u00A0 b\u00A0\u00A0 c</p></html>');
  });

  it('writes a mark inside the same mark once, which iOS needs', () => {
    // iOS keys open tags by name: an inner <i> ended the outer one's record, and
    // the outer italic's other words came out upright.
    const doc: RichDoc = [
      {
        kind: 'paragraph',
        content: [
          {
            kind: 'italic',
            content: [
              {
                kind: 'bold',
                content: [
                  { kind: 'italic', content: [{ kind: 'text', text: 'Urgent:' }] },
                  { kind: 'text', text: ' call ' },
                  { kind: 'italic', content: [{ kind: 'text', text: 'today' }] },
                ],
              },
            ],
          },
        ],
      },
    ];
    expect(richDocToDisplayHtml(doc)).toBe('<html><p><i><b>Urgent: call today</b></i></p></html>');
  });

  it('types the markers of a list that a right-to-left phone could lay out right to left', () => {
    // No strong letter at all takes the phone's own direction.
    expect(display('- 10:30\n- 11:00')).toBe('<html><p>\u2022 10:30</p><p>\u2022 11:00</p></html>');
    // A right-to-left mark is strong.
    expect(display('- \u200Fabc')).toBe('<html><p>\u2022 \u200Fabc</p></html>');
  });

  it('keeps an empty list item open, so the gap after the list survives on Android', () => {
    const doc: RichDoc = [
      { kind: 'bullets', items: [[{ kind: 'text', text: 'a' }], []] },
      { kind: 'paragraph', content: [{ kind: 'text', text: 'next' }] },
    ];
    expect(richDocToDisplayHtml(doc)).toBe('<html><ul><li>a</li><li>\u200B</li></ul><br><p>next</p></html>');
  });

  it('keeps a space at the start of a line, and a run across a bold mark', () => {
    const doc: RichDoc = [
      { kind: 'paragraph', content: [{ kind: 'text', text: ' x' }] },
      {
        kind: 'paragraph',
        content: [
          { kind: 'text', text: 'a ' },
          { kind: 'bold', content: [{ kind: 'text', text: ' b' }] },
        ],
      },
    ];
    expect(richDocToDisplayHtml(doc)).toBe('<html><p>\u00A0x</p><br><p>a <b>\u00A0b</b></p></html>');
  });

  it('draws each line of a paragraph as a paragraph of its own, never a <br> inside one', () => {
    // iOS makes <br> a newline only beside another tag, so text<br>text ran the
    // two lines together on an iPhone.
    expect(display('first\nsecond')).toBe('<html><p>first</p><p>second</p></html>');
    expect(display('first\nsecond')).not.toMatch(/[^>]<br>[^<]/);
  });

  it('closes and reopens a bold or a link that spans a line break', () => {
    const doc: RichDoc = [
      {
        kind: 'paragraph',
        content: [
          { kind: 'bold', content: [{ kind: 'text', text: 'one\ntwo' }] },
          { kind: 'link', href: 'https://example.org', content: [{ kind: 'text', text: 'x\ny' }] },
        ],
      },
    ];
    expect(richDocToDisplayHtml(doc)).toBe(
      '<html><p><b>one</b></p><p><b>two</b><a href="https://example.org">x</a></p>' +
        '<p><a href="https://example.org">y</a></p></html>',
    );
  });

  it('hands back exactly the address that was written, once decoded', () => {
    for (const href of ['https://example.org/f?a=1&b=2', 'https://example.org/a"b<c>', 'https://x.org/&amp;']) {
      const html = richDocToDisplayHtml([
        { kind: 'paragraph', content: [{ kind: 'link', href, content: [{ kind: 'text', text: 'go' }] }] },
      ]);
      const written = /href="([^"]*)"/.exec(html)![1];
      expect(decodeDisplayHref(written)).toBe(href);
    }
  });

  it('types the markers of a list with a right-to-left item', () => {
    // The library paints list markers off the canvas in a right-to-left
    // paragraph, so a real <ol> here would lose its numbers.
    expect(display('1. واحد\n2. two')).toBe('<html><p>1. واحد</p><p>2. two</p></html>');
    expect(display('- واحد\n- two')).toBe('<html><p>\u2022 واحد</p><p>\u2022 two</p></html>');
  });

  it('judges direction by the first strong character, as a text layout does', () => {
    expect(display('- 12: واحد')).toBe('<html><p>\u2022 12: واحد</p></html>');
    expect(display('- **واحد** two')).toBe('<html><p>\u2022 <b>واحد</b> two</p></html>');
    // A left-to-right item with Arabic further along keeps the real list.
    expect(display('- one واحد')).toBe('<html><ul><li>one واحد</li></ul></html>');
  });

  it('says the same words as the stored document, for 300 seeded documents', () => {
    const mulberry = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let z = seed;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
    const WORDS = ['plain', 'a<b', 'x&y', '"quoted"', 'snake_case', '[bracket]', 'c*d', '\\', '@sara', 'الله', 'line\nbreak'];
    const flatten = (nodes: RichInline[]): string =>
      nodes.map((n) => (n.kind === 'text' ? n.text : flatten(n.content))).join('');
    const unescape = (s: string) =>
      s
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');

    for (let seed = 1; seed <= 300; seed += 1) {
      const rnd = mulberry(seed);
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
      const inline = (): RichInline[] => {
        const text: RichInline = { kind: 'text', text: pick(WORDS) };
        const roll = rnd();
        if (roll < 0.2) return [text, { kind: 'text', text: ' ' }, { kind: 'bold', content: [{ kind: 'text', text: pick(WORDS) }] }];
        if (roll < 0.4) return [{ kind: 'italic', content: [text] }];
        return [text];
      };
      const doc: RichDoc = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
        const roll = rnd();
        if (roll < 0.5) return { kind: 'paragraph' as const, content: inline() };
        const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, inline);
        return { kind: roll < 0.75 ? ('bullets' as const) : ('numbers' as const), items };
      });
      const words = (d: RichDoc) =>
        d.flatMap((b) =>
          (b.kind === 'paragraph' ? [flatten(b.content)] : b.items.map(flatten)).flatMap((t) => t.split('\n')),
        );
      // Through storage first, so this is the document a phone actually receives.
      const stored = parseRich(serializeRich(doc));
      const html = richDocToDisplayHtml(stored);
      const shown = html
        .replace(/^<html>|<\/html>$/g, '')
        .split(/<\/p>|<\/li>|<br>/)
        .map(unescape)
        // A no-break space is a space someone typed, kept from collapsing; a
        // zero-width space holds an empty list item open.
        .map((line) => line.replace(/\u00A0/g, ' ').replace(/\u200B/g, ''))
        // A typed marker is the one thing a phone adds to the words.
        .map((line) => line.replace(/^(\u2022|\d+\.) /, ''))
        .filter((line) => line !== '');
      expect(shown, `seed ${seed}: ${html}`).toEqual(words(stored).filter((line) => line !== ''));
    }
  });
});

/**
 * What a phone editor opens with. iOS ran `line<br>line` into one line and
 * saved it that way, so a phone editor never sees a `<br>` inside a paragraph.
 */
describe('the HTML a phone editor opens with', () => {
  it('opens each line of a paragraph as a paragraph', () => {
    expect(markdownToPhoneEditorHtml('Call the venue\nthen email Sara')).toBe(
      '<p>Call the venue</p><p>then email Sara</p>',
    );
  });

  it('reopens a bold that spans the break', () => {
    expect(markdownToPhoneEditorHtml('**one\ntwo** three')).toBe('<p><b>one</b></p><p><b>two</b> three</p>');
  });

  it('writes a mark inside the same mark once, as the display does', () => {
    const html = markdownToPhoneEditorHtml('***Urgent:* call *today***');
    // No <i> opens while an <i> is open, and no <b> while a <b> is.
    let depth = { b: 0, i: 0 };
    for (const [, close, tag] of html.matchAll(/<(\/?)(b|i)>/g)) {
      const t = tag as 'b' | 'i';
      depth = { ...depth, [t]: depth[t] + (close ? -1 : 1) };
      expect(depth[t], html).toBeLessThanOrEqual(1);
    }
  });

  it('saves a soft break as a paragraph break, keeping every word', () => {
    // What Android's editor has always done with one; now iPhones do too.
    expect(htmlToMarkdown(markdownToPhoneEditorHtml('a\nb'))).toBe('a\n\nb');
  });

  it('is the browser editor’s HTML exactly, wherever there is no soft break', () => {
    for (const md of ['**bold** and *it*', '- one\n- two', '1. one\n2. two', 'p\n\n- l', '[x](https://e.org/a"b)', 'a < b & c']) {
      expect(markdownToPhoneEditorHtml(md), md).toBe(markdownToHtml(md));
    }
  });

  it('never puts a <br> inside a paragraph', () => {
    for (const md of ['a\nb\nc', '*x\ny*', '[l\nm](https://e.org)', 'one\n\ntwo\nthree']) {
      expect(markdownToPhoneEditorHtml(md), md).not.toContain('<br>');
    }
  });
});

