import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The NATIVE half of the push seam.
 *
 * It had no tests at all, which is how two real defects survived a full review:
 * `enablePush` ignored what `registerPush` returned, so a device that granted
 * permission but filed no token was reported as enabled; and `pushPromptState`
 * answered 'unsupported' whenever the app pointed at the emulators, which hid
 * the whole control from every local run. Both are asserted below.
 */
vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(() => Promise.resolve()),
  deleteNotificationChannelAsync: vi.fn(() => Promise.resolve()),
  requestPermissionsAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  getDevicePushTokenAsync: vi.fn(),
  addPushTokenListener: vi.fn(() => ({ remove: vi.fn() })),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
}));
const platform = vi.hoisted(() => ({ OS: 'android' as 'android' | 'ios' }));
vi.mock('react-native', () => ({
  Linking: { openSettings: vi.fn(() => Promise.resolve()) },
  Platform: platform,
}));
vi.mock('expo-application', () => ({
  ApplicationReleaseType: { UNKNOWN: 0, SIMULATOR: 1, ENTERPRISE: 2, DEVELOPMENT: 3, AD_HOC: 4, APP_STORE: 5 },
  getIosPushNotificationServiceEnvironmentAsync: vi.fn(),
  getIosApplicationReleaseTypeAsync: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
}));
vi.mock('./firebase', () => ({ db: {} }));
vi.mock('./env', () => ({ USE_EMULATORS: false }));
vi.mock('./sentry', () => ({ captureError: vi.fn() }));

import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { setDoc } from 'firebase/firestore';
import { enablePush, pushPromptState, registerPush } from './notify';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function device(opts: { granted: boolean; canAskAgain?: boolean; token?: string | null }) {
  const perm = { granted: opts.granted, canAskAgain: opts.canAskAgain ?? true };
  asMock(Notifications.getPermissionsAsync).mockResolvedValue(perm);
  asMock(Notifications.requestPermissionsAsync).mockResolvedValue(perm);
  asMock(Notifications.getDevicePushTokenAsync).mockResolvedValue({
    data: opts.token === undefined ? 'fcm-native-token' : opts.token,
  });
}

/** An iPhone, of the given build: what its profile says, and how it was installed. */
function iphone(profile: string | null, release: number) {
  platform.OS = 'ios';
  asMock(Application.getIosPushNotificationServiceEnvironmentAsync).mockResolvedValue(profile);
  asMock(Application.getIosApplicationReleaseTypeAsync).mockResolvedValue(release);
}

/** What the last registration filed. */
const filed = () => asMock(setDoc).mock.calls.at(-1)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'android';
});

describe('registerPush', () => {
  it('reports the token landing, not merely the permission', async () => {
    device({ granted: true });
    await expect(registerPush('user-1')).resolves.toBe(true);
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('reports false when the device yields no token', async () => {
    device({ granted: true, token: null });
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('reports false when permission is refused', async () => {
    device({ granted: false });
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });
});

/**
 * WHAT A DEVICE FILES, which decides which service the server sends it
 * through. Every iPhone filed itself as 'android' until v0.11.5 build 11, so
 * FCM was handed Apple's token, refused it, and iPhones heard nothing. The
 * rules admit exactly these shapes (functions/test/integration/rules.test.ts).
 */
describe('the row a device files', () => {
  it("an Android phone's: its platform, nothing else", async () => {
    device({ granted: true });
    await registerPush('user-1');
    expect(filed()).toEqual({ platform: 'android', updatedAt: expect.any(Number) });
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalled();
  });

  const builds: [string, string | null, number, 'development' | 'production'][] = [
    ['a debug build on the simulator (no profile; Apple sandbox)', null, 1, 'development'],
    ['a TestFlight or App Store install (no profile; production)', null, 5, 'production'],
    ['an Xcode build on a phone (a development profile)', 'development', 3, 'development'],
    ['an ad hoc build (a production profile)', 'production', 4, 'production'],
  ];

  it.each(builds)("an iPhone's, from %s: the Apple service that issued its token", async (_what, profile, release, env) => {
    device({ granted: true, token: 'ab'.repeat(32) });
    iphone(profile, release);
    await expect(registerPush('user-1')).resolves.toBe(true);
    expect(filed()).toEqual({ platform: 'ios', apnsEnvironment: env, updatedAt: expect.any(Number) });
  });

  it('an iPhone has no Android channel to make', async () => {
    device({ granted: true, token: 'ab'.repeat(32) });
    iphone(null, 1);
    await registerPush('user-1');
    expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    expect(Notifications.deleteNotificationChannelAsync).not.toHaveBeenCalled();
  });
});

describe('enablePush', () => {
  /**
   * The defect this is here for: it used to discard registerPush's result and
   * answer from the permission alone, so a granted device with no token behind
   * it was reported as 'granted' — a switch with nothing behind it.
   */
  it('is granted only when a token actually landed', async () => {
    device({ granted: true });
    await expect(enablePush('user-1')).resolves.toBe('granted');
  });

  it('is unavailable when permission was granted but no token landed', async () => {
    device({ granted: true, token: null });
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
  });

  it('is denied when the dialog was refused for good', async () => {
    device({ granted: false, canAskAgain: false });
    await expect(enablePush('user-1')).resolves.toBe('denied');
  });

  it('is denied — still askable — when the dialog was merely dismissed', async () => {
    device({ granted: false, canAskAgain: true });
    await expect(enablePush('user-1')).resolves.toBe('denied');
  });
});

/**
 * The emulator flag gates REGISTRATION, never the UI state — the same split the
 * web sibling makes. Folding it into pushPromptState made the notifications
 * screen read 'unsupported' in every emulator-backed run, hiding the control.
 */
describe('against the emulators', () => {
  async function loadWithEmulators() {
    vi.resetModules();
    vi.doMock('./env', () => ({ USE_EMULATORS: true }));
    const mod = await import('./notify');
    vi.doUnmock('./env');
    return mod;
  }

  it('still reports what the DEVICE will permit', async () => {
    device({ granted: false, canAskAgain: true });
    const { pushPromptState: state } = await loadWithEmulators();
    await expect(state()).resolves.toBe('default');
  });

  it('an Android build files no token: FCM has no emulator to deliver it', async () => {
    device({ granted: true });
    const { registerPush: reg } = await loadWithEmulators();
    await expect(reg('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  /**
   * An iPhone simulator's token comes from Apple's sandbox, which
   * scripts/send-test-push.mjs reaches, so a local build files it: that is how
   * the registration path — rules included — is proved without a phone.
   */
  it("an iPhone simulator files its sandbox token, since Apple's sandbox can deliver it", async () => {
    device({ granted: true, token: 'ab'.repeat(32) });
    iphone(null, 1);
    const { registerPush: reg } = await loadWithEmulators();
    await expect(reg('user-1')).resolves.toBe(true);
    expect(filed()).toEqual({ platform: 'ios', apnsEnvironment: 'development', updatedAt: expect.any(Number) });
  });

  /**
   * The gate sits BELOW the channel setup, and this is what says so.
   *
   * With it on the first line of registerPush — where it was — an
   * emulator-backed build could never create the channel or raise the system
   * dialog even once. That is the only build this project can put on a device,
   * so the one native surface a browser cannot reach was unreachable from the
   * only place it could be looked at, and `PUSH_CHANNEL_ID`'s importance was
   * unverifiable with it.
   *
   * It is checked on the device now: `dumpsys notification` shows exactly one
   * channel for the package, `sabeel-alerts` at `mImportance=4`.
   */
  it('still sets the channel up, and asks, before stopping at the token', async () => {
    device({ granted: true });
    const { enablePush: enable } = await loadWithEmulators();
    await enable('user-1');
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalled();
  });

  /**
   * A device that has NEVER BEEN ASKED, whose owner then says yes.
   *
   * The two permission mocks have to disagree for this to mean anything, which
   * is the whole point: `getPermissionsAsync` reports 'default' because nothing
   * has been asked yet, and `requestPermissionsAsync` grants because the person
   * taps Allow. Seeding both 'granted' — as the `device()` helper does — makes
   * this pass with the gate in either place, and the first draft of this test
   * did exactly that and proved nothing.
   *
   * With the gate at the top of registerPush the dialog never ran, so the state
   * stayed 'default' and `enablePush` called it 'denied' — a refusal invented
   * for a device that had not been asked. The nudge hides on 'denied' and
   * reports a failure only on 'unavailable', so the card vanished on a press
   * that had done nothing at all.
   */
  it('says unavailable, not denied, when the ask was granted but no token could be filed', async () => {
    // A real device, not a frozen pair of values: it starts unasked, and the
    // grant CHANGES what getPermissionsAsync reports afterwards. `enablePush`
    // re-reads the state rather than trusting the request's own return, so a
    // mock stuck at 'default' forever answers 'denied' whichever place the gate
    // is in — which is how the first draft of this test proved nothing.
    const unasked = { granted: false, canAskAgain: true };
    const allowed = { granted: true, canAskAgain: true };
    asMock(Notifications.getPermissionsAsync).mockResolvedValue(unasked);
    asMock(Notifications.requestPermissionsAsync).mockImplementation(async () => {
      asMock(Notifications.getPermissionsAsync).mockResolvedValue(allowed);
      return allowed;
    });
    const { enablePush: enable } = await loadWithEmulators();
    await expect(enable('user-1')).resolves.toBe('unavailable');
  });
});

/**
 * TOTALITY. Every caller treats these three as functions that always answer, and
 * the failure they were rewritten for is a button left spinning with no way
 * back. The web sibling asserts this; native had the same catch blocks and
 * nothing holding them down, which is how it drifted apart from web twice.
 */
describe('when the platform itself throws', () => {
  it('enablePush answers unavailable rather than rejecting', async () => {
    asMock(Notifications.requestPermissionsAsync).mockRejectedValue(
      new Error('no notification module'),
    );
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('registerPush answers false rather than rejecting', async () => {
    asMock(Notifications.getPermissionsAsync).mockRejectedValue(
      new Error('no notification module'),
    );
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  /**
   * Reported as 'unsupported', which is the honest answer: we could not find out
   * what this device permits. It is also the only one of the four that renders a
   * message with no control under it, so it cannot send anyone to a setting.
   */
  it('pushPromptState answers unsupported rather than rejecting', async () => {
    asMock(Notifications.getPermissionsAsync).mockRejectedValue(
      new Error('no notification module'),
    );
    await expect(pushPromptState()).resolves.toBe('unsupported');
  });
});

/**
 * WHICH function may raise the system dialog. The whole point of the batch, and
 * the half that was left undone on native.
 *
 * A browser enforces this by refusing a request that does not follow a click.
 * Android honours one from anywhere, so nothing but this suite holds it down —
 * and nothing did: signing in raised "Allow Kanban dev to send you
 * notifications?" over the *Waiting for approval* screen, before the account was
 * approved and before any board existed to be notified about. Android 13 spends
 * that prompt after a second refusal, so the worst moment to ask was also nearly
 * the last chance to.
 */
describe('only the button asks', () => {
  it('sign-in never raises the dialog, whatever the device would say', async () => {
    // Would grant if asked — so a passing result here cannot come from the
    // device refusing. The point is that nothing is asked at all.
    device({ granted: false, canAskAgain: true });
    asMock(Notifications.requestPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });

    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('sign-in still registers a device that was already permitted', async () => {
    device({ granted: true });
    await expect(registerPush('user-1')).resolves.toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('the button is what asks', async () => {
    device({ granted: false, canAskAgain: true });
    asMock(Notifications.requestPermissionsAsync).mockResolvedValue({
      granted: true,
      canAskAgain: true,
    });

    await expect(enablePush('user-1')).resolves.toBe('granted');
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});

describe('pushPromptState', () => {
  it('reports a device that can still be asked', async () => {
    device({ granted: false, canAskAgain: true });
    await expect(pushPromptState()).resolves.toBe('default');
  });

  it('reports a spent prompt as denied', async () => {
    device({ granted: false, canAskAgain: false });
    await expect(pushPromptState()).resolves.toBe('denied');
  });

  it('reports granted', async () => {
    device({ granted: true });
    await expect(pushPromptState()).resolves.toBe('granted');
  });
});
