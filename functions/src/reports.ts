import './setup';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  APP_NAME,
  REPORTS_PER_HOUR,
  REPORT_FROM,
  REPORT_TO,
  canUseApp,
  checkReportInput,
  type ReportPlatform,
  type Role,
  type UserStatus,
} from '@sabeel/shared';
import { actorOf } from './actor';
import { sendAsWorkspaceUser } from './gmail';
import { composeReportMessage, type ComposedMessage } from './reportMessage';
import { guarded, reportError, sentryDsn } from './sentry';

/**
 * Report a problem: a member tells the institute's administrators about a
 * post or a person (docs/STORE-RELEASE.md § 4).
 *
 * The report is STORED first, in `reports/{id}`, and then emailed from
 * `apps-noreply@` to the `apps-reports@` group with Reply-To set to the
 * reporter. Nobody reviews reports inside the app; the stored copy is the
 * record that one was made, and what the email says if it did not go. A send
 * that fails is recorded on the document and NOT retried: the person is told
 * their report was saved but not mailed, and the failure reaches Sentry.
 *
 * Clients can neither read nor write `reports` (firestore.rules); the Admin SDK
 * here is the only writer.
 */

type MailStatus = 'sent' | 'failed' | 'skipped';

interface ReportDoc {
  app: string;
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  text: string;
  /** Firestore's own clock, never the client's. */
  createdAt: Timestamp;
  platform?: ReportPlatform;
  appVersion?: string;
  /** The email's outcome. Absent only if the function died between storing the report and sending it. */
  mail?: { status: MailStatus; messageId?: string; error?: string };
}

/** What happened to the email: Gmail's id, or `skipped` where nothing may be sent. A throw is a failed send. */
export type ReportSender = (
  message: ComposedMessage,
) => Promise<{ status: 'sent'; messageId: string } | { status: 'skipped' }>;

const HOUR_MS = 60 * 60 * 1000;

/** The sentences a refused reporter reads. */
const REPORT_REFUSALS = {
  inactive: 'Only an approved, active account can send a report.',
  tooMany: `You have sent ${REPORTS_PER_HOUR} reports in the last hour, which is as many as one account can. Try again later.`,
  noProfile: 'Your account has no profile yet, so the report cannot say who sent it.',
} as const;

/**
 * File one report for `actor`: refuse it, or store it and then send it.
 *
 * Exported for the integration suite, which runs it against the Firestore
 * emulator with a sender it can count and break. The callable below is this
 * plus the token read and the sender chosen for the environment.
 */
export async function fileReport(
  actor: { uid: string; role: Role; status: UserStatus },
  data: unknown,
  send: ReportSender,
  db: Firestore = getFirestore(),
): Promise<{ id: string; mail: MailStatus }> {
  // Nothing is read, stored or sent for an account that may not use the app.
  if (!canUseApp(actor)) throw new HttpsError('permission-denied', REPORT_REFUSALS.inactive);

  const checked = checkReportInput(data);
  if (!checked.ok) throw new HttpsError('invalid-argument', checked.reason);
  const input = checked.report;

  const profile = (await db.doc(`users/${actor.uid}`).get()).data();
  if (!profile || typeof profile.email !== 'string') {
    throw new HttpsError('failed-precondition', REPORT_REFUSALS.noProfile);
  }
  const displayName = typeof profile.displayName === 'string' ? profile.displayName : '';
  const email = profile.email;

  const ref = db.collection('reports').doc();
  const doc: Omit<ReportDoc, 'createdAt'> & { createdAt: FieldValue } = {
    app: APP_NAME,
    uid: actor.uid,
    displayName,
    email,
    role: actor.role,
    text: input.text,
    createdAt: FieldValue.serverTimestamp(),
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
  };

  /**
   * The hourly limit, counted from the stored reports and in the same
   * transaction as the write, so two reports sent at once cannot both see
   * room for one more.
   *
   * The query is EVERY report of the last hour, filtered to this account in
   * memory, rather than `uid ==` plus `createdAt >`. That pair would need a
   * composite index, and a missing composite fails only in production, where
   * the emulator never checked it. A single-field range is served by the
   * automatic index, and the institute's whole last hour is at most a few
   * hundred small documents however many people report.
   */
  await db.runTransaction(async (tx) => {
    const since = Timestamp.fromMillis(Date.now() - HOUR_MS);
    const recent = await tx.get(
      db.collection('reports').where('createdAt', '>', since).select('uid'),
    );
    const mine = recent.docs.filter((d) => d.get('uid') === actor.uid).length;
    if (mine >= REPORTS_PER_HOUR) throw new HttpsError('resource-exhausted', REPORT_REFUSALS.tooMany);
    tx.create(ref, doc);
  });

  const message = composeReportMessage(
    {
      appName: APP_NAME,
      reportId: ref.id,
      uid: actor.uid,
      displayName,
      email,
      role: actor.role,
      text: input.text,
      filedAt: new Date(),
      ...(input.platform ? { platform: input.platform } : {}),
      ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    },
    { from: REPORT_FROM, to: REPORT_TO },
  );

  let mail: NonNullable<ReportDoc['mail']>;
  try {
    const outcome = await send(message);
    mail = outcome.status === 'sent' ? { status: 'sent', messageId: outcome.messageId } : { status: 'skipped' };
  } catch (e) {
    mail = { status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    logger.error('report saved but not mailed', { reportId: ref.id, error: mail.error });
    await reportError(e);
  }
  await ref.update({ mail });

  logger.info('report filed', { reportId: ref.id, uid: actor.uid, mail: mail.status });
  return { id: ref.id, mail: mail.status };
}

/**
 * The service account that signs as the sender. Per project, in
 * `functions/.env.<project>`; its function's runtime account needs
 * `roles/iam.serviceAccountTokenCreator` on it (docs/DEPLOY.md).
 */
const REPORT_MAILER = defineString('REPORT_MAILER_SERVICE_ACCOUNT', {
  description: 'The service account Report a problem signs as: report-mailer@<project>.iam.gserviceaccount.com',
});

const gmailSender: ReportSender = async (message) => {
  const { messageId } = await sendAsWorkspaceUser(message.raw, {
    serviceAccount: REPORT_MAILER.value(),
    user: REPORT_FROM.address,
  });
  return { status: 'sent', messageId };
};

/**
 * Under the emulator nothing is sent: there is no Gmail to reach, and a test
 * run must never mail the institute. The composed message is logged instead,
 * so a local run still shows what would have gone.
 */
const emulatorSender: ReportSender = async (message) => {
  logger.info('[emulator] report email not sent', {
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
  });
  return { status: 'skipped' };
};

/** Chosen once at load. `FUNCTIONS_EMULATOR` is set by the emulator alone, and only to "true". */
const sender: ReportSender = process.env.FUNCTIONS_EMULATOR === 'true' ? emulatorSender : gmailSender;

export const reportProblem = onCall(
  { secrets: [sentryDsn] },
  guarded(async (request: CallableRequest<unknown>) => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
    return fileReport(actorOf(auth), request.data, sender);
  }),
);
