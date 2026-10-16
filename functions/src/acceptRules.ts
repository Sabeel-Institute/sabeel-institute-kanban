import './setup';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue, type Firestore } from 'firebase-admin/firestore';
import { RULES_VERSION, canUseApp, hasAcceptedRules, type UserStatus } from '@sabeel/shared';
import { actorOf } from './actor';
import { guarded, sentryDsn } from './sentry';

/**
 * Accepting the institute's rules, once per account (docs/STORE-RELEASE.md § 4).
 *
 * The app shows the rules screen to an active account whose user document
 * does not carry the current `rulesVersion`, and nothing else until it is
 * accepted. Only this callable writes the two fields: `firestore.rules` keeps
 * them out of the self-writable list, so a client cannot mark itself as having
 * agreed to something it was never shown.
 *
 * The client says which version it SHOWED, and a version that is not the
 * current one is refused: an out-of-date bundle must not record acceptance of
 * rules the person never read.
 */

const RULES_REFUSALS = {
  inactive: 'Only an approved, active account can accept the rules.',
  stale: 'The rules have changed since this screen was loaded. Reload the app to read them.',
  noProfile: 'Your account has no profile yet. Try again in a moment.',
} as const;

/** The callable, less the token read. */
async function recordRulesAcceptance(
  actor: { uid: string; status: UserStatus },
  data: unknown,
  db: Firestore = getFirestore(),
): Promise<{ rulesVersion: number }> {
  if (!canUseApp(actor)) throw new HttpsError('permission-denied', RULES_REFUSALS.inactive);
  const shown = (data as { version?: unknown } | null)?.version;
  if (shown !== RULES_VERSION) throw new HttpsError('failed-precondition', RULES_REFUSALS.stale);

  const ref = db.doc(`users/${actor.uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('failed-precondition', RULES_REFUSALS.noProfile);
    // Accepted already (another device, a second tap): the first acceptance's
    // time is the one worth keeping.
    if (hasAcceptedRules(snap.data() ?? {})) return;
    tx.update(ref, { rulesVersion: RULES_VERSION, rulesAcceptedAt: FieldValue.serverTimestamp() });
  });
  logger.info('rules accepted', { uid: actor.uid, rulesVersion: RULES_VERSION });
  return { rulesVersion: RULES_VERSION };
}

export const acceptRules = onCall(
  { secrets: [sentryDsn] },
  guarded(async (request: CallableRequest<unknown>) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    return recordRulesAcceptance(actorOf(auth), request.data);
  }),
);
