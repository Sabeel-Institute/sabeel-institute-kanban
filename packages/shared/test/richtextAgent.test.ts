import { describe, expect, it } from 'vitest';
import { fromAgentMarkdown } from '../src/richtextAgent';
import { normalizeMarkdown, parseRich, serializeRich } from '../src/richtext';

describe('rich text from an agent', () => {
  it('keeps what the app writes exactly as it is', () => {
    const app = '**Forms**\n\n- [Expense](https://example.org/x)\n- *Room* booking\n\n1. Ask\n2. Read';
    expect(fromAgentMarkdown(app)).toBe(app);
  });

  it('makes a heading of any level a bold line, with what follows beside it', () => {
    expect(fromAgentMarkdown('## Forms\nUse these.')).toBe('**Forms**\nUse these.');
    expect(fromAgentMarkdown('# **Already bold** #')).toBe('**Already bold**');
  });

  it('converts the other spellings of bold, italic and bullets', () => {
    expect(fromAgentMarkdown('__bold__ and _italic_ here')).toBe('**bold** and *italic* here');
    expect(fromAgentMarkdown('* one\n+ two')).toBe('- one\n- two');
    expect(fromAgentMarkdown('1) first\n2) second')).toBe('1. first\n2. second');
  });

  it('leaves underscores inside words and addresses alone', () => {
    expect(fromAgentMarkdown('the snake_case_name and _id')).toBe('the snake_case_name and _id');
    expect(fromAgentMarkdown('see https://example.org/_drafts_/a_b')).toBe('see https://example.org/_drafts_/a_b');
    expect(fromAgentMarkdown('[Drafts](https://example.org/_drafts_/)')).toBe('[Drafts](https://example.org/_drafts_/)');
  });

  it('flattens checkboxes, quotes, rules, code and strike-through to their words', () => {
    expect(fromAgentMarkdown('- [ ] call\n- [x] email')).toBe('- call\n- email');
    expect(fromAgentMarkdown('> quoted')).toBe('quoted');
    expect(fromAgentMarkdown('above\n---\nbelow')).toBe('above\n\nbelow');
    expect(fromAgentMarkdown('run `npm test` ~~now~~')).toBe('run npm test now');
    expect(fromAgentMarkdown('```\nline one\nline two\n```')).toBe('line one\nline two');
  });

  it('makes images and autolinks into links the app has', () => {
    expect(fromAgentMarkdown('![Map](https://example.org/m.png)')).toBe('[Map](https://example.org/m.png)');
    expect(fromAgentMarkdown('<https://example.org>')).toBe('https://example.org');
    expect(fromAgentMarkdown('[Site](https://example.org "Home")')).toBe('[Site](https://example.org)');
  });

  it('keeps a literal asterisk literal, escaped as the editors store it', () => {
    expect(fromAgentMarkdown('5 * 3')).toBe('5 \\* 3');
  });

  it('leaves alone every line it is handed back as stored, so a person’s text survives an agent’s save', () => {
    const stored = [
      '# of guests: 40',
      '',
      '> 18 only',
      '',
      'Door code `4471`, call __init__ and _really_ ~~no~~',
      '',
      '---',
      '',
      'www.x.org/_forms_/',
      '',
      '```',
    ].join('\n');
    expect(fromAgentMarkdown(stored, stored)).toBe(normalizeMarkdown(stored));
    // A line the agent added is still converted beside them.
    expect(fromAgentMarkdown(`${stored}\n\n## Added by the agent`, stored)).toBe(
      `${normalizeMarkdown(stored)}\n\n**Added by the agent**`,
    );
  });

  it('always gives the canonical form, which reads back as itself', () => {
    const samples = [
      '# Title\n\n* a\n  * nested\n\n> note with __bold__',
      'Plain text\nwith a soft break',
      '- [Link](https://example.org) and @sara',
      '',
    ];
    for (const s of samples) {
      const out = fromAgentMarkdown(s);
      expect(normalizeMarkdown(out)).toBe(out);
      expect(serializeRich(parseRich(out))).toBe(out);
    }
  });
});
