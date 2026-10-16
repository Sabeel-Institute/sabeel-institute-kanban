/**
 * The institute's rules, and Report a problem: what every Sabeel app adds
 * because people post in it (decided by Faisal 2026-10-16; the
 * `sabeel-app-stores` skill, decision 4, and docs/STORE-RELEASE.md § 4).
 *
 * The app and the callables both read these, so neither holds its own copy of
 * a limit the other enforces.
 */

/**
 * The version of the rules text an account has accepted.
 *
 * Raise it when the text on the rules screen changes, in the same commit: every
 * account then sees the screen once more, on its next sign-in or app open. An
 * account at a HIGHER version than this build knows (a newer server, an older
 * bundle) has accepted at least this text, so it is not asked again.
 */
export const RULES_VERSION = 1;

/** Has the person behind this user document accepted the current rules? */
export function hasAcceptedRules(user: { rulesVersion?: unknown }): boolean {
  return typeof user.rulesVersion === 'number' && user.rulesVersion >= RULES_VERSION;
}

/**
 * The addresses a report travels between. The same for the three Sabeel apps:
 * `apps-noreply@` is a Workspace user nobody signs in to, which the server
 * sends as through domain-wide delegation; `apps-reports@` is a group.
 */
export const REPORT_FROM = {
  name: 'Sabeel Apps No Reply',
  address: 'apps-noreply@oursabeel.com',
} as const;
export const REPORT_TO = 'apps-reports@oursabeel.com';

/** A report's text, measured after trimming. */
export const REPORT_TEXT_MAX = 2000;

/** Reports one account may send in any hour, counted from the stored reports. */
export const REPORTS_PER_HOUR = 5;

export type ReportPlatform = 'ios' | 'android' | 'web';
const PLATFORMS: readonly ReportPlatform[] = ['ios', 'android', 'web'];

/** `0.11.5 (3945e38)`, a `+` marking a build cut with uncommitted changes. */
const APP_VERSION = /^[0-9A-Za-z.+() -]{1,40}$/;

export type ReportInput = {
  text: string;
  platform?: ReportPlatform;
  appVersion?: string;
};

/**
 * Read a report as it arrives from a client: the text trimmed and between 1
 * and `REPORT_TEXT_MAX` characters, and the platform and app version, both
 * optional, refused when present but malformed. The reason is a sentence the
 * reporter reads.
 */
export function checkReportInput(
  data: unknown,
): { ok: true; report: ReportInput } | { ok: false; reason: string } {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const problem = reportTextProblem(d.text);
  if (problem) return { ok: false, reason: problem };
  const report: ReportInput = { text: (d.text as string).trim() };
  if (d.platform !== undefined) {
    if (!PLATFORMS.includes(d.platform as ReportPlatform)) {
      return { ok: false, reason: 'The report named a platform this app does not run on.' };
    }
    report.platform = d.platform as ReportPlatform;
  }
  if (d.appVersion !== undefined) {
    if (typeof d.appVersion !== 'string' || !APP_VERSION.test(d.appVersion)) {
      return { ok: false, reason: 'The report carried an app version this app does not write.' };
    }
    report.appVersion = d.appVersion;
  }
  return { ok: true, report };
}

/**
 * What is wrong with a report's text, or null when it may be sent. The app
 * uses it to enable Send; the server to refuse what the app should have.
 */
export function reportTextProblem(text: unknown): string | null {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return 'Write what or who you are reporting first.';
  }
  if (text.trim().length > REPORT_TEXT_MAX) {
    return `A report can be at most ${REPORT_TEXT_MAX} characters.`;
  }
  return null;
}
