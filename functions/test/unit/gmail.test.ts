import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { REPORT_FROM, REPORT_TO } from '@sabeel/shared';
import { GMAIL_SEND_SCOPE, sendAsWorkspaceUser } from '../../src/gmail';
import { composeReportMessage } from '../../src/reportMessage';

/**
 * The send path whole, against a local stand-in for the three Google services
 * it calls: IAM Credentials signs the delegation token, the OAuth endpoint
 * trades it for the Workspace user's token, Gmail sends. Google cannot be
 * reached from a test, so one local HTTP server answers all three as Google
 * would and records what it was asked, the way `apns.test.ts` stands in for
 * Apple.
 *
 * Not covered here, because only Google can say: that the real delegation
 * accepts this service account and scope (proved by hand on 2026-10-16, a
 * test message to apps-reports@ from each project), and that the deployed
 * function's runtime account holds Token Creator on report-mailer
 * (docs/DEPLOY.md, verified after deploy).
 */

const SA = 'report-mailer@demo-sabeel-kanban.iam.gserviceaccount.com';
const DELEGATION = { serviceAccount: SA, user: REPORT_FROM.address };
const NOW = Date.UTC(2026, 9, 16, 15, 5, 0);

interface Seen {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

type Answer = { status: number; body: unknown };

async function fakeGoogle(answers: Partial<Record<'sign' | 'token' | 'send', Answer>> = {}) {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const path = req.url ?? '';
      seen.push({ path, headers: req.headers, body });
      const which = path.endsWith(':signJwt') ? 'sign' : path === '/token' ? 'token' : path.endsWith('/messages/send') ? 'send' : null;
      const fallback: Record<'sign' | 'token' | 'send', Answer> = {
        sign: { status: 200, body: { keyId: 'k1', signedJwt: 'signed.delegation.jwt' } },
        token: { status: 200, body: { access_token: 'user-token', token_type: 'Bearer', expires_in: 3599 } },
        send: { status: 200, body: { id: 'gmail-msg-1', threadId: 't1', labelIds: ['SENT'] } },
      };
      const answer = which ? (answers[which] ?? fallback[which]) : { status: 404, body: { error: 'not found' } };
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  opened.push(server);
  return { seen, endpoints: { iam: origin, token: `${origin}/token`, gmail: origin } };
}

const opened: Server[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

const message = composeReportMessage(
  {
    appName: 'Sabeel Kanban',
    reportId: 'r1',
    uid: 'u-sara',
    displayName: 'Sara Ahmed',
    email: 'sara@oursabeel.com',
    role: 'member',
    text: 'Somebody posted something they should not have.',
    filedAt: new Date(NOW),
  },
  { from: REPORT_FROM, to: REPORT_TO },
);

describe('sendAsWorkspaceUser', () => {
  it('signs as report-mailer for apps-noreply with gmail.send only, trades the token, and sends the message', async () => {
    const google = await fakeGoogle();
    const out = await sendAsWorkspaceUser(message.raw, DELEGATION, {
      endpoints: google.endpoints,
      accessToken: async () => 'function-adc-token',
      now: () => NOW,
    });
    expect(out).toEqual({ messageId: 'gmail-msg-1' });
    expect(google.seen.map((s) => s.path)).toEqual([
      `/v1/projects/-/serviceAccounts/${encodeURIComponent(SA)}:signJwt`,
      '/token',
      '/gmail/v1/users/me/messages/send',
    ]);

    // 1. IAM signs with the FUNCTION's credentials, a payload naming the
    //    sender as the subject and nothing but gmail.send.
    const [sign, token, send] = google.seen;
    expect(sign.headers.authorization).toBe('Bearer function-adc-token');
    const payload = JSON.parse((JSON.parse(sign.body) as { payload: string }).payload);
    expect(payload).toEqual({
      iss: SA,
      sub: 'apps-noreply@oursabeel.com',
      scope: GMAIL_SEND_SCOPE,
      aud: google.endpoints.token,
      iat: NOW / 1000,
      exp: NOW / 1000 + 3600,
    });

    // 2. The signed JWT is the assertion of a jwt-bearer grant.
    const form = new URLSearchParams(token.body);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(form.get('assertion')).toBe('signed.delegation.jwt');
    expect(token.headers.authorization).toBeUndefined();

    // 3. Gmail is called as the USER, with the message base64url-encoded, byte for byte.
    expect(send.headers.authorization).toBe('Bearer user-token');
    const raw = Buffer.from((JSON.parse(send.body) as { raw: string }).raw, 'base64url').toString('utf8');
    expect(raw).toBe(message.raw);
    expect(raw).toContain('\r\nTo: apps-reports@oursabeel.com\r\n');
    expect(raw).toContain('\r\nReply-To: "Sara Ahmed" <sara@oursabeel.com>\r\n');
  });

  it('names the step and Google\'s words when signing is refused, and sends nothing', async () => {
    const google = await fakeGoogle({
      sign: { status: 403, body: { error: { code: 403, message: "Permission 'iam.serviceAccounts.signJwt' denied" } } },
    });
    await expect(
      sendAsWorkspaceUser(message.raw, DELEGATION, { endpoints: google.endpoints, accessToken: async () => 't', now: () => NOW }),
    ).rejects.toThrow(/^signing the delegation token: HTTP 403 Permission 'iam\.serviceAccounts\.signJwt' denied$/);
    expect(google.seen.map((s) => s.path).some((p) => p.endsWith('/messages/send'))).toBe(false);
  });

  it('names the exchange when delegation is not authorised for the scope', async () => {
    const google = await fakeGoogle({
      token: { status: 401, body: { error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method.' } },
    });
    await expect(
      sendAsWorkspaceUser(message.raw, DELEGATION, { endpoints: google.endpoints, accessToken: async () => 't', now: () => NOW }),
    ).rejects.toThrow(/^exchanging the delegation token: HTTP 401 Client is unauthorized/);
    expect(google.seen).toHaveLength(2);
  });

  it('names Gmail when it refuses the message', async () => {
    const google = await fakeGoogle({
      send: { status: 400, body: { error: { code: 400, message: 'Invalid To header' } } },
    });
    await expect(
      sendAsWorkspaceUser(message.raw, DELEGATION, { endpoints: google.endpoints, accessToken: async () => 't', now: () => NOW }),
    ).rejects.toThrow(/^sending through Gmail: HTTP 400 Invalid To header$/);
  });

  it('fails, rather than reporting a send, when Gmail answers without an id', async () => {
    const google = await fakeGoogle({ send: { status: 200, body: {} } });
    await expect(
      sendAsWorkspaceUser(message.raw, DELEGATION, { endpoints: google.endpoints, accessToken: async () => 't', now: () => NOW }),
    ).rejects.toThrow(/no message id/);
  });
});
