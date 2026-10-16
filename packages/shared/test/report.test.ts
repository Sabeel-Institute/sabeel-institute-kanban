import { describe, it, expect } from 'vitest';
import {
  REPORT_TEXT_MAX,
  RULES_VERSION,
  checkReportInput,
  hasAcceptedRules,
  reportTextProblem,
} from '../src/report';

describe('hasAcceptedRules', () => {
  it('is false for an account that has never accepted, which is every account before this release', () => {
    expect(hasAcceptedRules({})).toBe(false);
    expect(hasAcceptedRules({ rulesVersion: undefined })).toBe(false);
  });

  it('is false for an older version, so changed rules are shown again', () => {
    expect(hasAcceptedRules({ rulesVersion: RULES_VERSION - 1 })).toBe(false);
  });

  it('is true at the current version and above', () => {
    expect(hasAcceptedRules({ rulesVersion: RULES_VERSION })).toBe(true);
    expect(hasAcceptedRules({ rulesVersion: RULES_VERSION + 1 })).toBe(true);
  });

  it('does not take a string for the number', () => {
    expect(hasAcceptedRules({ rulesVersion: String(RULES_VERSION) })).toBe(false);
  });
});

describe('reportTextProblem', () => {
  it('refuses nothing, and nothing but space', () => {
    expect(reportTextProblem('')).not.toBeNull();
    expect(reportTextProblem('   \n\t ')).not.toBeNull();
    expect(reportTextProblem(undefined)).not.toBeNull();
    expect(reportTextProblem(42)).not.toBeNull();
  });

  it('measures the text after trimming, at both ends of the range', () => {
    expect(reportTextProblem('x')).toBeNull();
    expect(reportTextProblem(`  ${'x'.repeat(REPORT_TEXT_MAX)}  `)).toBeNull();
    expect(reportTextProblem('x'.repeat(REPORT_TEXT_MAX + 1))).toMatch(/at most 2000/);
  });
});

describe('checkReportInput', () => {
  it('keeps the text trimmed and nothing the client did not send', () => {
    expect(checkReportInput({ text: '  The card "Venue" has an abusive comment.\n' })).toEqual({
      ok: true,
      report: { text: 'The card "Venue" has an abusive comment.' },
    });
  });

  it('keeps a platform and an app version as the app writes them', () => {
    expect(
      checkReportInput({ text: 'x', platform: 'android', appVersion: '0.11.5 (3945e38+)' }),
    ).toEqual({ ok: true, report: { text: 'x', platform: 'android', appVersion: '0.11.5 (3945e38+)' } });
  });

  it('refuses a malformed platform or version rather than storing it', () => {
    expect(checkReportInput({ text: 'x', platform: 'windows' }).ok).toBe(false);
    expect(checkReportInput({ text: 'x', appVersion: 7 }).ok).toBe(false);
    expect(checkReportInput({ text: 'x', appVersion: '0.11.5\r\nBcc: someone@example.org' }).ok).toBe(false);
    expect(checkReportInput({ text: 'x', appVersion: 'v'.repeat(41) }).ok).toBe(false);
  });

  it('refuses a body that is not an object', () => {
    expect(checkReportInput(null).ok).toBe(false);
    expect(checkReportInput('text').ok).toBe(false);
  });
});
