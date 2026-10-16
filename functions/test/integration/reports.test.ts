import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  APP_NAME,
  PASSWORD_SIGN_IN_EMAIL,
  REPORTS_PER_HOUR,
  REPORT_TEXT_MAX,
  REPORT_TO,
} from '@sabeel/shared';
import { fileReport, type ReportSender } from '../../src/reports';
import type { ComposedMessage } from '../../src/reportMessage';
import {
  adminAuth,
  adminDb,
  callFunction,
  idTokenFor,
  makeUser,
  passwordIdToken,
  shutdown,
} from './emulatorClient';

/**
 * Report a problem, as the people involved see it.
 *
 * What it promises: a signed-in, active member's report is kept and one email
 * about it is attempted, to the reports group with Reply-To the reporter; an
 * account that may not use the app files nothing and mails nothing; nobody
 * sends a sixth in an hour; and a send that fails still keeps the report and
 * says so.
 *
 * Two ways in. Over HTTP, through the deployed callable in the functions
 * emulator, which proves the wiring (the token read through `actorOf`, the
 * emulator's sender recording `skipped`). And in process, `fileReport` against
 * the same Firestore emulator with a sender the test COUNTS and can BREAK:
 * "exactly one send" and "nothing sent" are only observable there, because the
 * emulator, rightly, sends nothing at all.
 *
 * Unique `rp_` ids, and the reviewer's address is made here and nowhere else in
 * this file, so the suites sharing one emulator run do not collide.
 */

const MEMBER = 'rp_member';
const PENDING = 'rp_pending';
const DISABLED = 'rp_disabled';
const LIMITED = 'rp_limited';
const OLD = 'rp_old';
const DIRECT = 'rp_direct';
const BROKEN = 'rp_broken';
const DIRECT_LIMIT = 'rp_direct_limit';
const DOOR_PASSWORD = 'reports-test-password-1';
let reviewerUid = '';

const reportsOf = async (uid: string) =>
  (await adminDb().collection('reports').where('uid', '==', uid).get()).docs;
const allReports = async () => (await adminDb().collection('reports').count().get()).data().count;

/** A sender that records what it was asked to send, and answers like Gmail. */
function recordingSender() {
  const sent: ComposedMessage[] = [];
  const send: ReportSender = async (message) => {
    sent.push(message);
    return { status: 'sent', messageId: `gmail-${sent.length}` };
  };
  return { sent, send };
}

beforeAll(async () => {
  await makeUser({ uid: MEMBER, email: 'rp_member@oursabeel.com', displayName: 'Rana Member', role: 'member', status: 'active' });
  await makeUser({ uid: PENDING, email: 'rp_pending@oursabeel.com' });
  await makeUser({ uid: DISABLED, email: 'rp_disabled@oursabeel.com', role: 'member', status: 'disabled' });
  await makeUser({ uid: LIMITED, email: 'rp_limited@oursabeel.com', role: 'member', status: 'active' });
  await makeUser({ uid: OLD, email: 'rp_old@oursabeel.com', role: 'member', status: 'active' });
  await makeUser({ uid: DIRECT, email: 'rp_direct@oursabeel.com', displayName: 'Dina Direct', role: 'organizer', status: 'active' });
  await makeUser({ uid: BROKEN, email: 'rp_broken@oursabeel.com', role: 'member', status: 'active' });
  await makeUser({ uid: DIRECT_LIMIT, email: 'rp_direct_limit@oursabeel.com', role: 'member', status: 'active' });

  // The review account, made as an admin makes it, given ORGANIZER claims that
  // only the Admin SDK could set: a password session is a member regardless.
  const existing = await adminAuth().getUserByEmail(PASSWORD_SIGN_IN_EMAIL).catch(() => null);
  if (existing) await adminAuth().deleteUser(existing.uid);
  reviewerUid = 'rp_reviewer';
  await makeUser({
    uid: reviewerUid,
    email: PASSWORD_SIGN_IN_EMAIL,
    password: DOOR_PASSWORD,
    role: 'organizer',
    status: 'active',
  });
});

afterAll(async () => {
  await shutdown();
});

describe('through the callable', () => {
  it('refuses a signed-out caller and stores nothing', async () => {
    const before = await allReports();
    const r = await callFunction('reportProblem', { text: 'Somebody is being rude.' });
    expect(r.body.error?.status).toBe('UNAUTHENTICATED');
    expect(await allReports()).toBe(before);
  });

  it('refuses a pending or a disabled account in a sentence, and stores nothing', async () => {
    for (const uid of [PENDING, DISABLED]) {
      const r = await callFunction('reportProblem', { text: 'A report.' }, await idTokenFor(uid));
      expect(r.body.error?.status).toBe('PERMISSION_DENIED');
      expect(r.body.error?.message).toBe('Only an approved, active account can send a report.');
      expect(await reportsOf(uid)).toHaveLength(0);
    }
  });

  it('stores exactly one report for an active member, with who sent it and what they wrote', async () => {
    const r = await callFunction(
      'reportProblem',
      { text: '  The comment on "Venue" is abusive.\n', platform: 'web', appVersion: '0.11.5 (abc1234)' },
      await idTokenFor(MEMBER),
    );
    expect(r.body.error).toBeUndefined();
    // The emulator sends nothing, and says so.
    expect(r.body.result).toMatchObject({ mail: 'skipped' });

    const docs = await reportsOf(MEMBER);
    expect(docs).toHaveLength(1);
    const d = docs[0].data();
    expect(d).toMatchObject({
      app: APP_NAME,
      uid: MEMBER,
      displayName: 'Rana Member',
      email: 'rp_member@oursabeel.com',
      role: 'member',
      text: 'The comment on "Venue" is abusive.',
      platform: 'web',
      appVersion: '0.11.5 (abc1234)',
      mail: { status: 'skipped' },
    });
    expect(d.createdAt).toBeInstanceOf(Timestamp);
    expect(docs[0].id).toBe((r.body.result as { id: string }).id);
  });

  it('refuses empty or overlong text in a sentence, and stores nothing', async () => {
    const token = await idTokenFor(LIMITED);
    for (const text of ['', '   \n  ', 'x'.repeat(REPORT_TEXT_MAX + 1)]) {
      const r = await callFunction('reportProblem', { text }, token);
      expect(r.body.error?.status).toBe('INVALID_ARGUMENT');
      expect(r.body.error?.message).toMatch(/^(Write what or who you are reporting first\.|A report can be at most 2000 characters\.)$/);
    }
    expect(await reportsOf(LIMITED)).toHaveLength(0);
  });

  it('takes a report from the review account through the password door, as a member', async () => {
    const r = await callFunction(
      'reportProblem',
      { text: 'Reviewing the report flow.' },
      await passwordIdToken(PASSWORD_SIGN_IN_EMAIL, DOOR_PASSWORD),
    );
    expect(r.body.error).toBeUndefined();
    const docs = await reportsOf(reviewerUid);
    expect(docs).toHaveLength(1);
    expect(docs[0].data()).toMatchObject({ role: 'member', email: PASSWORD_SIGN_IN_EMAIL });
  });

  it(`refuses the ${REPORTS_PER_HOUR + 1}th report within an hour and stores nothing more`, async () => {
    const token = await idTokenFor(LIMITED);
    for (let i = 1; i <= REPORTS_PER_HOUR; i++) {
      const r = await callFunction('reportProblem', { text: `Report ${i}` }, token);
      expect(r.body.error, `report ${i}`).toBeUndefined();
    }
    const over = await callFunction('reportProblem', { text: 'One too many' }, token);
    expect(over.body.error?.status).toBe('RESOURCE_EXHAUSTED');
    expect(over.body.error?.message).toMatch(/^You have sent 5 reports in the last hour/);
    const docs = await reportsOf(LIMITED);
    expect(docs).toHaveLength(REPORTS_PER_HOUR);
    expect(docs.map((d) => d.data().text)).not.toContain('One too many');
  });

  it('counts only the last hour: five older reports leave room for another', async () => {
    const longAgo = Timestamp.fromMillis(Date.now() - 61 * 60 * 1000);
    for (let i = 0; i < REPORTS_PER_HOUR; i++) {
      await adminDb().collection('reports').add({ uid: OLD, text: `old ${i}`, createdAt: longAgo });
    }
    const r = await callFunction('reportProblem', { text: 'A new one' }, await idTokenFor(OLD));
    expect(r.body.error).toBeUndefined();
    expect(await reportsOf(OLD)).toHaveLength(REPORTS_PER_HOUR + 1);
  });
});

describe('the send, counted (fileReport in process)', () => {
  it('attempts exactly one send per report: to the reports group, Reply-To the reporter', async () => {
    const { sent, send } = recordingSender();
    const out = await fileReport({ uid: DIRECT, role: 'organizer', status: 'active' }, { text: 'Please look at the Budget board.' }, send, adminDb());

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(REPORT_TO);
    expect(sent[0].replyTo).toEqual({ name: 'Dina Direct', address: 'rp_direct@oursabeel.com' });
    expect(sent[0].subject).toBe(`[${APP_NAME}] Report from Dina Direct`);
    expect(sent[0].body).toContain('Please look at the Budget board.');

    const docs = await reportsOf(DIRECT);
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(out.id);
    expect(docs[0].data().mail).toEqual({ status: 'sent', messageId: 'gmail-1' });
    expect(out.mail).toBe('sent');
  });

  it('sends nothing and stores nothing for an account that is not active', async () => {
    const { sent, send } = recordingSender();
    for (const status of ['pending', 'rejected', 'disabled'] as const) {
      await expect(
        fileReport({ uid: DIRECT, role: 'admin', status }, { text: 'x' }, send, adminDb()),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect(sent).toHaveLength(0);
    expect(await reportsOf(DIRECT)).toHaveLength(1); // the one from the test above, and no more
  });

  it(`sends nothing for the ${REPORTS_PER_HOUR + 1}th report in an hour`, async () => {
    const { sent, send } = recordingSender();
    const actor = { uid: DIRECT_LIMIT, role: 'member' as const, status: 'active' as const };
    for (let i = 0; i < REPORTS_PER_HOUR; i++) await fileReport(actor, { text: `r${i}` }, send, adminDb());
    await expect(fileReport(actor, { text: 'over' }, send, adminDb())).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(sent).toHaveLength(REPORTS_PER_HOUR);
    expect(await reportsOf(DIRECT_LIMIT)).toHaveLength(REPORTS_PER_HOUR);
  });

  it('keeps the report when the email fails, records why, and says it was not mailed', async () => {
    const failing: ReportSender = async () => {
      throw new Error('sending through Gmail: HTTP 503 Backend Error');
    };
    const out = await fileReport({ uid: BROKEN, role: 'member', status: 'active' }, { text: 'It broke.' }, failing, adminDb());
    expect(out.mail).toBe('failed');
    const docs = await reportsOf(BROKEN);
    expect(docs).toHaveLength(1);
    expect(docs[0].data()).toMatchObject({
      text: 'It broke.',
      mail: { status: 'failed', error: 'sending through Gmail: HTTP 503 Backend Error' },
    });
  });
});
