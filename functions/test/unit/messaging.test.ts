import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { PUSH_CHANNEL_ID } from '@sabeel/shared';

/**
 * Which device goes where, and what the transport's answer does to its row.
 *
 * Both transports are replaced: FCM by a stub of `getMessaging().sendEach`,
 * Apple by a stub of `sendToApns` (whose own behaviour is `apns.test.ts`).
 * What is under test is `messaging.ts` itself — the routing, the payload FCM
 * is given, the rows called dead, and the promise never to throw.
 *
 * The sender is chosen at module load, so each test re-imports.
 */

const sendEach = vi.fn();
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEach }) }));

const sendToApns = vi.fn();
vi.mock('../../src/apns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/apns')>()),
  sendToApns: (...args: unknown[]) => sendToApns(...args),
}));

const reportError = vi.fn(async (_e: unknown) => undefined);
vi.mock('../../src/sentry', () => ({ reportError: (e: unknown) => reportError(e) }));

const MESSAGE = {
  title: 'Sabeel Kanban',
  body: 'Sara assigned you "Plan the retreat"',
  data: { type: 'assigned', boardId: 'b1', cardId: 'c1', notifId: 'n1' },
};
const FCM = 'fcm-token:APA91b-abc_def';
const APPLE = 'ab'.repeat(32);

const android = (token = FCM) => ({ token, device: { platform: 'android' as const, updatedAt: 1 }, message: MESSAGE });
const web = (token = 'web-token:APA91b-xyz') => ({ token, device: { platform: 'web' as const, updatedAt: 1 }, message: MESSAGE });
const iphone = (token = APPLE, apnsEnvironment: 'production' | 'development' = 'production') => ({
  token,
  device: { platform: 'ios' as const, apnsEnvironment, updatedAt: 1 },
  message: MESSAGE,
});

const fcmAnswers = (...codes: (string | null)[]) =>
  sendEach.mockResolvedValue({
    successCount: codes.filter((c) => c === null).length,
    responses: codes.map((code) => (code === null ? { success: true } : { success: false, error: { code } })),
  });

async function messaging() {
  vi.resetModules();
  return import('../../src/messaging');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FUNCTIONS_EMULATOR', '');
  vi.stubEnv('APNS_KEY', generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  vi.stubEnv('APNS_KEY_ID', 'KEY1234567');
  vi.stubEnv('APPLE_TEAM_ID', 'TEAM123456');
  sendToApns.mockResolvedValue({ delivered: [], dead: [], failed: [] });
  fcmAnswers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('under the emulator', () => {
  it('sends nothing and prunes nothing', async () => {
    vi.stubEnv('FUNCTIONS_EMULATOR', 'true');
    const { send } = await messaging();
    await expect(send([android(), iphone()])).resolves.toEqual({ stale: [], sent: 2 });
    expect(sendEach).not.toHaveBeenCalled();
    expect(sendToApns).not.toHaveBeenCalled();
  });

  it('is only the literal "true": anything else sends for real', async () => {
    // A stray "1" or "false" must not quietly switch production off.
    for (const value of ['1', 'false', 'TRUE']) {
      vi.stubEnv('FUNCTIONS_EMULATOR', value);
      sendEach.mockClear();
      const { send } = await messaging();
      await send([android()]);
      expect(sendEach).toHaveBeenCalledTimes(1);
    }
  });
});

describe('routing', () => {
  it('sends iPhones to Apple, with their service, and everything else to FCM', async () => {
    fcmAnswers(null, null);
    sendToApns.mockResolvedValue({ delivered: [APPLE, 'cd'.repeat(32)], dead: [], failed: [] });
    const { send } = await messaging();
    const out = await send([android(), iphone(), web(), iphone('cd'.repeat(32), 'development')]);

    expect(sendEach.mock.calls[0][0].map((m: { token: string }) => m.token)).toEqual([FCM, 'web-token:APA91b-xyz']);
    const [sends, creds] = sendToApns.mock.calls[0];
    expect(sends).toEqual([
      { token: APPLE, apnsEnvironment: 'production', message: MESSAGE },
      { token: 'cd'.repeat(32), apnsEnvironment: 'development', message: MESSAGE },
    ]);
    expect(creds).toMatchObject({ keyId: 'KEY1234567', teamId: 'TEAM123456' });
    expect(out).toEqual({ stale: [], sent: 4 });
  });

  /*
   * An iPhone's row from before iPhones had rows: Apple's hex token under
   * 'android'. FCM answers it with invalid-argument, which is not a dead-token
   * code, so without this it would be sent to FCM, refused, and kept, for ever.
   */
  it("prunes an iPhone's old 'android' row unsent", async () => {
    fcmAnswers(null);
    const legacy = android(APPLE);
    const { send } = await messaging();
    const out = await send([android(), legacy]);
    expect(sendEach.mock.calls[0][0].map((m: { token: string }) => m.token)).toEqual([FCM]);
    expect(sendToApns).not.toHaveBeenCalled();
    expect(out.stale).toEqual([legacy]);
  });
});

describe('the FCM message', () => {
  /*
   * The channel contract (client half: app/src/notify.test.ts). A send that
   * names no channel does not fail; Android posts it to "Miscellaneous".
   */
  it('names the shared channel, carries the routing data flat, and has no `body` key in it', async () => {
    fcmAnswers(null);
    const { send } = await messaging();
    await send([android()]);
    const [message] = sendEach.mock.calls[0][0];
    expect(PUSH_CHANNEL_ID).toMatch(/\S/);
    expect(message).toEqual({
      token: FCM,
      notification: { title: MESSAGE.title, body: MESSAGE.body },
      data: MESSAGE.data,
      android: { notification: { channelId: PUSH_CHANNEL_ID } },
    });
    // expo-notifications on Android takes a data key named `body` as the whole
    // payload and drops its siblings.
    expect(Object.keys(message.data)).not.toContain('body');
  });
});

describe('what is pruned', () => {
  it('only the rows a transport called dead', async () => {
    const gone = android('gone:APA91b');
    const unknown = android('unknown:APA91b');
    const malformed = android('bad-message:APA91b');
    const busy = android('busy:APA91b');
    fcmAnswers(
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
      'messaging/invalid-argument',
      'messaging/server-unavailable',
    );
    const deadApple = iphone();
    const liveApple = iphone('cd'.repeat(32));
    sendToApns.mockResolvedValue({ delivered: ['cd'.repeat(32)], dead: [APPLE], failed: [] });
    const { send } = await messaging();
    const out = await send([gone, unknown, malformed, busy, deadApple, liveApple]);
    expect(out.stale).toEqual([gone, unknown, deadApple]);
    expect(out.sent).toBe(1);
  });
});

/*
 * NEVER THROWS. notify() writes the inbox before it sends; a throw would fail
 * the trigger, the retry would write every inbox entry again.
 */
describe('when a transport fails', () => {
  it('the other still delivers, nothing throws, and the failure is reported', async () => {
    sendEach.mockRejectedValue(new Error('FCM is down'));
    sendToApns.mockResolvedValue({ delivered: [APPLE], dead: [], failed: [] });
    const { send } = await messaging();
    await expect(send([android(), iphone()])).resolves.toEqual({ stale: [], sent: 1 });
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: 'FCM is down' }));
  });

  it('a function without APNS_KEY bound reaches Android anyway, and says why the iPhone did not', async () => {
    vi.stubEnv('APNS_KEY', '');
    fcmAnswers(null);
    const { send } = await messaging();
    await expect(send([android(), iphone()])).resolves.toEqual({ stale: [], sent: 1 });
    expect(sendToApns).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('APNS_KEY') }));
  });
});
