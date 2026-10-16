import { Platform } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { RULES_VERSION, type ReportPlatform } from '@sabeel/shared';
import { BUILD_INFO } from './build-info';
import { functions } from './firebase';
import { createViewStore } from './viewState';

/**
 * The institute's rules and Report a problem, from the app's side
 * (docs/STORE-RELEASE.md § 4). Both are callables: the user document is
 * written only by the server, and `reports` is not readable or writable by any
 * client at all.
 */

const acceptRulesFn = httpsCallable<{ version: number }, { rulesVersion: number }>(
  functions,
  'acceptRules',
);

/**
 * Record that this person agreed to the rules the screen SHOWED, by version:
 * the server refuses any other, so a stale bundle cannot record acceptance of
 * text the person never read. The rules screen goes away when the user
 * document's snapshot says so, not when this resolves.
 */
export async function acceptRules(): Promise<void> {
  await acceptRulesFn({ version: RULES_VERSION });
}

type MailStatus = 'sent' | 'failed' | 'skipped';

const reportFn = httpsCallable<
  { text: string; platform?: ReportPlatform; appVersion: string },
  { id: string; mail: MailStatus }
>(functions, 'reportProblem');

const PLATFORMS: readonly string[] = ['ios', 'android', 'web'];

/**
 * A callable's failures that carry no sentence of ours: the network never got
 * an answer, or the server failed in a way it did not explain (`internal`,
 * whose message is the bare word). Each gets one the person can act on.
 */
const UNEXPLAINED: Record<string, string> = {
  'functions/unavailable': 'The report did not reach the server. Check your connection and send it again.',
  'functions/deadline-exceeded': 'The report did not reach the server in time. Check your connection and send it again.',
  'functions/internal': 'Something went wrong on the server, so the report may not have been kept. Send it again in a moment.',
};

/**
 * Send a report. Resolves `mailed` when the email went (or, against the
 * emulators, would have), `saved` when the report was kept but the email
 * failed; throws a sentence the person can act on otherwise. The server's own
 * refusals — inactive, empty, over the hourly limit — are already sentences.
 */
export async function sendReport(text: string): Promise<'mailed' | 'saved'> {
  try {
    const { data } = await reportFn({
      text,
      ...(PLATFORMS.includes(Platform.OS) ? { platform: Platform.OS as ReportPlatform } : {}),
      appVersion: `${BUILD_INFO.version} (${BUILD_INFO.commit})`,
    });
    return data.mail === 'failed' ? 'saved' : 'mailed';
  } catch (e) {
    const sentence = UNEXPLAINED[(e as { code?: string }).code ?? ''];
    if (sentence) throw new Error(sentence, { cause: e });
    throw e;
  }
}

/**
 * The report being written, kept OUTSIDE the screen so Back loses none of it:
 * `App.tsx` unmounts a screen when another is pushed or it is popped, and an
 * unsent report is exactly the text a person would hate to type twice. This is
 * the survival case `viewState.ts` exists for, not a draft that should die
 * with its editor. Cleared on a send that stored the report, and emptied at
 * sign-out with every other view store, so a shared device keeps nothing.
 */
export const reportDraft = createViewStore({ text: '' });
