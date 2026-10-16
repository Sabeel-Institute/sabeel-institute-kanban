import { ORG_TIMEZONE, type ReportPlatform } from '@sabeel/shared';

/**
 * A report as the email about it is written: pure, so every header and the body
 * are unit-tested (`reportMessage.test.ts`) without a mail server. `gmail.ts`
 * sends what this returns; `reports.ts` decides when.
 */

export interface Mailbox {
  name: string;
  address: string;
}

export interface ReportForMail {
  /** `APP_NAME`: the three apps' reports share one inbox. */
  appName: string;
  reportId: string;
  uid: string;
  displayName: string;
  email: string;
  role: string;
  text: string;
  /** When it was filed, shown in the institute's time zone. */
  filedAt: Date;
  platform?: ReportPlatform;
  appVersion?: string;
}

export interface ComposedMessage {
  to: string;
  replyTo: Mailbox;
  subject: string;
  /** The text/plain part, before transfer encoding: one line per paragraph or detail. */
  text: string;
  /** The text/html part, the same facts, every interpolated value escaped. */
  html: string;
  /** The whole RFC 5322 message, CRLF line ends, as Gmail's `raw` takes it once base64url-encoded. */
  raw: string;
}

/**
 * Header values come partly from a person's profile, so a line break in one
 * must never start a header of its own (`Bcc:`, say). Collapsed, not escaped:
 * no header here carries meaning in a line break.
 */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * Non-ASCII header text as RFC 2047 encoded-words, `=?UTF-8?B?…?=`.
 *
 * Each word stays within the RFC's 75 characters, which holds at most 45 bytes
 * of UTF-8 once base64'd, and is cut only between characters, never inside
 * one: a word that ended halfway through a character would decode to garbage.
 * The words are folded onto continuation lines, which a reader joins back
 * together without the space between them (RFC 2047 § 6.2).
 */
export function encodeWords(text: string): string {
  const words: string[] = [];
  let chunk = '';
  for (const ch of text) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

/** A header's free text: as is when it is printable ASCII, else encoded-words. */
function headerText(text: string): string {
  const line = oneLine(text);
  return PRINTABLE_ASCII.test(line) ? line : encodeWords(line);
}

/**
 * `"Name" <address>`. An ASCII name is a quoted-string, so a comma or an `@`
 * in it cannot split the header into two addresses; anything else is an
 * encoded-word, which may not appear inside quotes.
 */
export function formatMailbox({ name, address }: Mailbox): string {
  const display = oneLine(name);
  const addr = oneLine(address);
  if (!display) return `<${addr}>`;
  const phrase = PRINTABLE_ASCII.test(display)
    ? `"${display.replace(/[\\"]/g, (c) => `\\${c}`)}"`
    : encodeWords(display);
  return `${phrase} <${addr}>`;
}

/** "Friday, October 16, 2026 at 10:05:00 AM CDT", in the institute's zone. */
function institutionalTime(at: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ORG_TIMEZONE,
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(at);
}

const PLATFORM_NAMES: Record<ReportPlatform, string> = {
  ios: 'iPhone',
  android: 'Android',
  web: 'the web',
};

/** Base64 at 76 characters a line: a 2000-character line would break SMTP's 998. */
function base64Lines(text: string): string {
  return (
    Buffer.from(text, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? ''
  );
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text as HTML text: the five characters that could open a tag, an entity or an attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * The report as an email: multipart/alternative, a text/plain part and a
 * text/html part carrying the same facts.
 *
 * Both, because plain text alone reads ragged on a phone: a mail app breaks
 * it at its own fixed width. So the plain part carries no line breaks of ours
 * inside a sentence (one line per paragraph, one per detail), and the HTML
 * part lets the reader's mail app flow it: short paragraphs, the details as a
 * plain table, the person's words with their line breaks as `<br>`. No style,
 * no image, and no link but `mailto:` the reporter. Everything interpolated
 * into the HTML is escaped, the person's text above all, so what they typed
 * can never become markup in an administrator's inbox.
 */
export function composeReportMessage(
  report: ReportForMail,
  { from, to }: { from: Mailbox; to: string },
): ComposedMessage {
  const name = oneLine(report.displayName) || report.email;
  const replyTo: Mailbox = { name, address: report.email };
  const subject = `[${report.appName}] Report from ${name}`;

  const app =
    [
      report.appName,
      report.appVersion ? report.appVersion : null,
      report.platform ? `on ${PLATFORM_NAMES[report.platform]}` : null,
    ]
      .filter(Boolean)
      .join(' ') + (report.platform || report.appVersion ? '' : ' (version and platform not sent)');
  const when = `${institutionalTime(report.filedAt)} (${ORG_TIMEZONE})`;
  const said = report.text.replace(/\r\n?/g, '\n');
  const intro = `${name} reported a problem in ${report.appName}.`;
  const question = 'What or who are you reporting, and what is wrong?';
  const footer =
    'Reply to this email to answer the reporter: it goes to them, not to the app. The institute answers reports within 24 hours.';

  /** The details, once, so the two parts cannot disagree about them. */
  const details: [string, string][] = [
    ['Who', `${name} <${report.email}>`],
    ['Role', report.role],
    ['Uid', report.uid],
    ['When', when],
    ['App', app],
    ['Report', `reports/${report.reportId}`],
  ];

  const text = [
    intro,
    '',
    ...details.map(([label, value]) => `${`${label}:`.padEnd(8)}${value}`),
    '',
    question,
    '',
    said,
    '',
    '--',
    footer,
    '',
  ].join('\n');

  const cell = (label: string, value: string) =>
    label === 'Who'
      ? `${escapeHtml(name)} &lt;<a href="mailto:${escapeHtml(encodeURI(report.email))}">${escapeHtml(report.email)}</a>&gt;`
      : escapeHtml(value);
  const html = [
    '<!DOCTYPE html>',
    '<html><head><meta charset="utf-8"></head><body>',
    `<p>${escapeHtml(intro)}</p>`,
    '<table>',
    ...details.map(([label, value]) => `<tr><th align="left">${label}</th><td>${cell(label, value)}</td></tr>`),
    '</table>',
    `<p><b>${escapeHtml(question)}</b></p>`,
    `<p>${said.split('\n').map(escapeHtml).join('<br>\n')}</p>`,
    '<hr>',
    `<p>${escapeHtml(footer)}</p>`,
    '</body></html>',
    '',
  ].join('\n');

  /**
   * Starts with `=_`, which no base64 line can contain, so the boundary
   * cannot occur inside either part.
   */
  const boundary = `=_sabeel_report_${report.reportId}`;
  const part = (type: string, content: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(content.replace(/\r?\n/g, '\r\n')),
    ].join('\r\n');

  const headers = [
    `From: ${formatMailbox(from)}`,
    `To: ${to}`,
    `Reply-To: ${formatMailbox(replyTo)}`,
    `Subject: ${headerText(subject)}`,
    'MIME-Version: 1.0',
    // Folded onto a second line: with a twenty-character report id, one line
    // would run past the 78 characters a header line should keep to.
    `Content-Type: multipart/alternative;\r\n boundary="${boundary}"`,
  ];
  const raw = [
    headers.join('\r\n'),
    '',
    part('text/plain', text),
    part('text/html', html),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  return { to, replyTo, subject, text, html, raw };
}
