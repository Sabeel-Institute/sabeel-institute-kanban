import { describe, it, expect } from 'vitest';
import { REPORT_FROM, REPORT_TO } from '@sabeel/shared';
import {
  composeReportMessage,
  encodeWords,
  formatMailbox,
  type ReportForMail,
} from '../../src/reportMessage';

/**
 * What a report's email promises the administrators who read it: it reaches
 * the reports group, it comes from the no-reply sender, pressing Reply writes
 * to the person who reported, the subject names the app and the reporter, and
 * the body says who, when, from what, and then exactly what they wrote.
 *
 * Asserted on the RAW message, parsed back the way a mail client reads it
 * (unfolded headers, encoded-words decoded, the body's base64 undone), so a
 * header that is right in the structured result but mangled on the wire fails.
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

/** Read a raw message back as a mail client would. */
function parse(raw: string) {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, split).replace(/\r\n[ \t]/g, ' ');
  const headers = new Map<string, string>();
  for (const line of head.split('\r\n')) {
    const at = line.indexOf(':');
    headers.set(line.slice(0, at).toLowerCase(), line.slice(at + 1).trim());
  }
  const body = Buffer.from(raw.slice(split + 4).replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { headers, body, head };
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

  it('declare a UTF-8 plain-text body', () => {
    const { headers } = parse(compose().raw);
    expect(headers.get('mime-version')).toBe('1.0');
    expect(headers.get('content-type')).toBe('text/plain; charset=UTF-8');
    expect(headers.get('content-transfer-encoding')).toBe('base64');
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

describe('the body', () => {
  it('says who, with their name, email, role and uid', () => {
    const { body } = parse(compose().raw);
    expect(body).toContain('Who:    Sara Ahmed <sara@oursabeel.com>');
    expect(body).toContain('Role:   member');
    expect(body).toContain('Uid:    u-sara');
  });

  it('says when, in the institute time zone', () => {
    const { body } = parse(compose().raw);
    expect(body).toMatch(/When: {3}Friday, October 16, 2026 at 10:05:00\sAM CDT \(America\/Chicago\)/);
  });

  it('says which app, version and platform, and says so when they were not sent', () => {
    expect(parse(compose().raw).body).toContain('App:    Sabeel Kanban 0.11.5 (3945e38) on Android');
    const bare = parse(compose({ platform: undefined, appVersion: undefined }).raw).body;
    expect(bare).toContain('App:    Sabeel Kanban (version and platform not sent)');
  });

  it('carries the text verbatim, after the details, non-ASCII and all', () => {
    const text = 'Line one — with “quotes” and عربي.\n\n  Indented line two.\n*not markdown*';
    const { body } = parse(compose({ text }).raw);
    expect(body.replace(/\r\n/g, '\n')).toContain(`\n\n${text}\n`);
    expect(body.indexOf(text.split('\n')[0])).toBeGreaterThan(body.indexOf('Uid:'));
  });

  it('keeps a 2000-character line inside SMTP line limits on the wire', () => {
    const { raw } = compose({ text: 'x'.repeat(2000) });
    for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(78);
  });

  it('names the stored report so an administrator can find it', () => {
    expect(parse(compose().raw).body).toContain('Report: reports/r123');
  });
});
