import { describe, it, expect } from 'vitest';
import { REPORT_FROM, REPORT_TO } from '@sabeel/shared';
import {
  composeReportMessage,
  encodeWords,
  escapeHtml,
  formatMailbox,
  type ReportForMail,
} from '../../src/reportMessage';

/**
 * What a report's email promises the administrators who read it: it reaches
 * the reports group, it comes from the no-reply sender, pressing Reply writes
 * to the person who reported, the subject names the app and the reporter, and
 * the body says who, when, from what, and then exactly what they wrote, in a
 * plain part and an HTML part that say the same thing, and in which nothing
 * the person typed can become markup.
 *
 * Asserted on the RAW message, parsed back the way a mail client reads it
 * (unfolded headers, encoded-words decoded, the multipart split on its
 * boundary, each part's base64 undone), so a header or part that is right in
 * the structured result but mangled on the wire fails.
 */

const REPORT: ReportForMail = {
  appName: 'Sabeel Kanban',
  reportId: 'r123',
  uid: 'u-sara',
  displayName: 'Sara Ahmed',
  email: 'sara@oursabeel.com',
  role: 'member',
  text: 'The card "Venue deposit" has a comment calling Omar names.\n\nIt is the second one this week.',
  // 15:05 UTC is 10:05 in Chicago in October (CDT, UTC-5).
  filedAt: new Date('2026-10-16T15:05:00Z'),
  platform: 'android',
  appVersion: '0.11.5 (3945e38)',
};

const compose = (over: Partial<ReportForMail> = {}) =>
  composeReportMessage({ ...REPORT, ...over }, { from: REPORT_FROM, to: REPORT_TO });

/** RFC 2047 B-encoded words back to text; adjacent words join without the folding space. */
function decodeWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'));
}

function headerBlock(block: string) {
  const headers = new Map<string, string>();
  for (const line of block.replace(/\r\n[ \t]/g, ' ').split('\r\n')) {
    const at = line.indexOf(':');
    headers.set(line.slice(0, at).toLowerCase(), line.slice(at + 1).trim());
  }
  return headers;
}

/** Read a raw message back as a mail client would: headers, then each part decoded. */
function parse(raw: string) {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, split);
  const headers = headerBlock(head);
  const boundary = /boundary="([^"]+)"/.exec(headers.get('content-type') ?? '')?.[1] ?? '';
  const parts = raw
    .slice(split + 4)
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const body = chunk.replace(/^\r\n/, '');
      const at = body.indexOf('\r\n\r\n');
      const partHeaders = headerBlock(body.slice(0, at));
      return {
        type: partHeaders.get('content-type') ?? '',
        encoding: partHeaders.get('content-transfer-encoding') ?? '',
        content: Buffer.from(body.slice(at + 4).replace(/\r\n/g, ''), 'base64').toString('utf8'),
      };
    });
  const closed = raw.includes(`\r\n--${boundary}--\r\n`);
  const plain = parts.find((p) => p.type.startsWith('text/plain'))?.content ?? '';
  // The HTML read with plain line ends: a browser does not care which.
  const html = (parts.find((p) => p.type.startsWith('text/html'))?.content ?? '').replace(/\r\n/g, '\n');
  return { headers, head, parts, closed, plain, html };
}

/** What an HTML part says once a mail client has drawn it: tags gone, entities read. */
function rendered(html: string): string {
  return html
    .replace(/<br>\n?/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('the headers', () => {
  it('go from the no-reply sender to the reports group, with Reply-To the reporter', () => {
    const { headers } = parse(compose().raw);
    expect(headers.get('from')).toBe('"Sabeel Apps No Reply" <apps-noreply@oursabeel.com>');
    expect(headers.get('to')).toBe('apps-reports@oursabeel.com');
    expect(headers.get('reply-to')).toBe('"Sara Ahmed" <sara@oursabeel.com>');
  });

  it('name the app and the reporter in the subject', () => {
    expect(parse(compose().raw).headers.get('subject')).toBe('[Sabeel Kanban] Report from Sara Ahmed');
  });

  it('make it multipart/alternative: a UTF-8 text/plain part, then a text/html one, both base64', () => {
    const { headers, parts, closed } = parse(compose().raw);
    expect(headers.get('mime-version')).toBe('1.0');
    expect(headers.get('content-type')).toMatch(/^multipart\/alternative; boundary="=_[^"]+"$/);
    expect(parts.map((p) => [p.type, p.encoding])).toEqual([
      ['text/plain; charset=UTF-8', 'base64'],
      ['text/html; charset=UTF-8', 'base64'],
    ]);
    expect(closed).toBe(true);
  });

  it('end every line with CRLF and leave no bare LF', () => {
    const { raw } = compose();
    expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('encode a non-ASCII name with RFC 2047, in the subject and in Reply-To, and it decodes back', () => {
    const name = 'Zoë Ḥasan عائشة';
    const { headers, head } = parse(compose({ displayName: name }).raw);
    // On the wire, every header byte is ASCII.
    expect(head).toMatch(/^[\x20-\x7e\r\n\t]*$/);
    expect(decodeWords(headers.get('subject') ?? '')).toBe(`[Sabeel Kanban] Report from ${name}`);
    expect(decodeWords(headers.get('reply-to') ?? '')).toBe(`${name} <sara@oursabeel.com>`);
  });

  it('keeps a quoted name from splitting the Reply-To into two addresses', () => {
    expect(formatMailbox({ name: 'Ahmed, Sara "Admin"', address: 'sara@oursabeel.com' })).toBe(
      '"Ahmed, Sara \\"Admin\\"" <sara@oursabeel.com>',
    );
  });

  it('never lets a line break in a name start a header of its own', () => {
    const { raw } = compose({ displayName: 'Sara\r\nBcc: someone@example.org' });
    const { headers } = parse(raw);
    expect(headers.has('bcc')).toBe(false);
    expect(headers.get('subject')).toBe('[Sabeel Kanban] Report from Sara Bcc: someone@example.org');
  });

  it('falls back to the address when the name is empty', () => {
    expect(parse(compose({ displayName: '' }).raw).headers.get('subject')).toBe(
      '[Sabeel Kanban] Report from sara@oursabeel.com',
    );
  });
});

describe('encodeWords', () => {
  it('keeps every encoded-word within 75 characters and never splits a character', () => {
    const long = 'عائشة '.repeat(40);
    const words = encodeWords(long).split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) {
      expect(w.length).toBeLessThanOrEqual(75);
      // Each word decodes on its own to whole characters.
      const text = Buffer.from(w.slice(10, -2), 'base64').toString('utf8');
      expect(text).not.toContain('�');
    }
    expect(decodeWords(encodeWords(long))).toBe(long);
  });
});

describe('the plain part', () => {
  it('says who, with their name, email, role and uid', () => {
    const { plain } = parse(compose().raw);
    expect(plain).toContain('Who:    Sara Ahmed <sara@oursabeel.com>');
    expect(plain).toContain('Role:   member');
    expect(plain).toContain('Uid:    u-sara');
  });

  it('says when, in the institute time zone', () => {
    const { plain } = parse(compose().raw);
    expect(plain).toMatch(/When: {3}Friday, October 16, 2026 at 10:05:00\sAM CDT \(America\/Chicago\)/);
  });

  it('says which app, version and platform, and says so when they were not sent', () => {
    expect(parse(compose().raw).plain).toContain('App:    Sabeel Kanban 0.11.5 (3945e38) on Android');
    const bare = parse(compose({ platform: undefined, appVersion: undefined }).raw).plain;
    expect(bare).toContain('App:    Sabeel Kanban (version and platform not sent)');
  });

  it('carries the text verbatim, after the details, non-ASCII and all', () => {
    const text = 'Line one — with “quotes” and عربي.\n\n  Indented line two.\n*not markdown*';
    const { plain } = parse(compose({ text }).raw);
    expect(plain.replace(/\r\n/g, '\n')).toContain(`\n\n${text}\n`);
    expect(plain.indexOf(text.split('\n')[0])).toBeGreaterThan(plain.indexOf('Uid:'));
  });

  it('breaks no sentence of its own across lines: one line per paragraph', () => {
    const lines = parse(compose().raw).plain.split('\r\n');
    expect(lines).toContain(
      'Reply to this email to answer the reporter: it goes to them, not to the app. The institute answers reports within 24 hours.',
    );
    expect(lines).toContain('Sara Ahmed reported a problem in Sabeel Kanban.');
  });

  it('names the stored report so an administrator can find it', () => {
    expect(parse(compose().raw).plain).toContain('Report: reports/r123');
  });
});

describe('the HTML part', () => {
  it('carries the same facts as the plain part', () => {
    const { plain, html } = parse(compose().raw);
    const shown = rendered(html);
    const facts = [
      'Sara Ahmed reported a problem in Sabeel Kanban.',
      'Sara Ahmed',
      'sara@oursabeel.com',
      'member',
      'u-sara',
      'Friday, October 16, 2026 at 10:05:00',
      '(America/Chicago)',
      'Sabeel Kanban 0.11.5 (3945e38) on Android',
      'reports/r123',
      'What or who are you reporting, and what is wrong?',
      'The card "Venue deposit" has a comment calling Omar names.',
      'It is the second one this week.',
      'The institute answers reports within 24 hours.',
    ];
    for (const fact of facts) {
      expect(plain, fact).toContain(fact);
      expect(shown, fact).toContain(fact);
    }
  });

  it('lets nothing the person typed become markup: < > & and both quotes are escaped', () => {
    const text = `<script>alert("x")</script> & <img src=x onerror='y'> <a href="https://evil.example">here</a>`;
    const { html } = parse(compose({ text, displayName: '<b>Sara</b> & "co"' }).raw);
    expect(html).not.toMatch(/<script|<img|<b>Sara|evil\.example">/i);
    expect(html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;img src=x onerror=&#39;y&#39;&gt;',
    );
    expect(html).toContain('&lt;b&gt;Sara&lt;/b&gt; &amp; &quot;co&quot;');
    // And it still reads as what they wrote.
    expect(rendered(html)).toContain(text);
  });

  it('keeps the person\'s line breaks as <br>', () => {
    const { html } = parse(compose({ text: 'line one\nline two\n\nline four' }).raw);
    expect(html).toContain('<p>line one<br>\nline two<br>\n<br>\nline four</p>');
  });

  it('links nothing but mailto: the reporter, and carries no style or image', () => {
    const { html } = parse(compose().raw);
    const links = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(links).toEqual(['mailto:sara@oursabeel.com']);
    expect(html).not.toMatch(/<style|style=|<img|<script|class=/i);
  });

  it('escapes the strings the helper is given, and only those', () => {
    expect(escapeHtml(`a<b>&"c"'d'`)).toBe('a&lt;b&gt;&amp;&quot;c&quot;&#39;d&#39;');
  });
});

describe('on the wire', () => {
  it('keeps a 2000-character line inside SMTP line limits', () => {
    const { raw } = compose({ text: 'x'.repeat(2000), reportId: 'a'.repeat(20) });
    for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(78);
  });
});
