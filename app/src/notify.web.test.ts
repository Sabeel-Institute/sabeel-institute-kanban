import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The rule this file exists to hold down: a permission request must be raised
 * DIRECTLY from the click that asked for it.
 *
 * Web push silently did nothing on every new browser because `registerPush`
 * asked for permission from a Firestore snapshot callback, and asked only after
 * `await isSupported()` — which awaits an IndexedDB `open()` that resolves from
 * an `onsuccess` task. Safari refuses a request that far from a gesture without
 * reporting anything: no prompt, permission left at 'default', and the site in
 * neither the allowed nor the blocked list.
 *
 * The e2e suites cannot catch a regression here — headless Chromium auto-grants
 * notification permission, so the broken and the fixed code both pass. These
 * assert the shape instead: that the sign-in path never asks, and that the
 * gesture path asks with nothing awaited first.
 */
vi.mock('firebase/messaging', () => ({
  isSupported: vi.fn(),
  getToken: vi.fn(),
  getMessaging: vi.fn(() => ({})),
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  setDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
}));
vi.mock('./firebase', () => ({ app: {}, db: {} }));
vi.mock('./firebase-config', () => ({ VAPID_PUBLIC_KEY: 'test-vapid-public-key' }));
vi.mock('./env', () => ({ USE_EMULATORS: false }));
vi.mock('./sentry', () => ({ captureError: vi.fn() }));

import { getToken, isSupported } from 'firebase/messaging';
import { setDoc } from 'firebase/firestore';
import { captureError } from './sentry';
import { canOpenPushSettings, enablePush, openPushSettings, registerPush, pushPromptState } from './notify.web';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

let requestPermission: ReturnType<typeof vi.fn>;

/** A browser that supports web push, in a given permission state. */
function browser(permission: 'default' | 'granted' | 'denied', answer = 'granted'): void {
  requestPermission = vi.fn(() => Promise.resolve(answer));
  const nav = {
    serviceWorker: {
      register: vi.fn(() => Promise.resolve({ scope: '/' })),
      ready: Promise.resolve({ scope: '/' }),
    },
  };
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
  Object.defineProperty(globalThis, 'PushManager', { value: class {}, configurable: true });
  Object.defineProperty(globalThis, 'Notification', {
    value: { permission, requestPermission },
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(isSupported).mockResolvedValue(true);
  asMock(getToken).mockResolvedValue('fcm-token');
});

describe('registerPush — the sign-in path', () => {
  it('never asks for permission, however supported the browser is', async () => {
    browser('default');
    await registerPush('user-1');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('registers silently when permission was already granted', async () => {
    browser('granted');
    await expect(registerPush('user-1')).resolves.toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  /**
   * It reports DELIVERABILITY, not permission. The settings screen reads this to
   * decide whether to say "enabled" — and permission granted over a device with
   * no token filed is a switch with nothing behind it.
   */
  it('reports false when permission is granted but no token can be had', async () => {
    browser('granted');
    asMock(getToken).mockResolvedValue('');
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('reports false, and writes nothing, when it was never permitted', async () => {
    browser('default');
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('enablePush — the gesture path', () => {
  /**
   * The load-bearing test. An async function runs synchronously up to its first
   * await, so if nothing is awaited before the request, it is still inside the
   * click when it is raised. Awaiting anything first — `isSupported()`, a
   * permission read, a token lookup — moves it into a later task and this fails.
   */
  it('asks synchronously, before any promise is awaited', () => {
    browser('default');
    void enablePush('user-1');
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('asks even while the support check is still pending', () => {
    browser('default');
    // Never resolves: a support check that has not answered yet must not be
    // able to delay, or swallow, the prompt.
    asMock(isSupported).mockReturnValue(new Promise(() => {}));
    void enablePush('user-1');
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it('registers the token once permission is granted', async () => {
    browser('default');
    await expect(enablePush('user-1')).resolves.toBe('granted');
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('records nothing when the prompt is declined', async () => {
    browser('default', 'denied');
    await expect(enablePush('user-1')).resolves.toBe('denied');
    expect(setDoc).not.toHaveBeenCalled();
  });

  /**
   * Granting and then failing to register is NOT a refusal. Reporting it as one
   * sends someone to un-block a permission they just allowed.
   */
  it('separates a granted-but-unregistrable device from a refusal', async () => {
    browser('default');
    asMock(isSupported).mockResolvedValue(false);
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
    expect(setDoc).not.toHaveBeenCalled();
  });

  /**
   * Callers treat this as total — the nudge and the settings screen both reset
   * their busy state in a .then. A synchronous throw from requestPermission
   * used to escape (it was raised outside the try) and leave a button spinning
   * with no way back.
   */
  it('never rejects, even when the prompt itself throws', async () => {
    browser('default');
    requestPermission.mockImplementation(() => {
      throw new TypeError('Illegal invocation');
    });
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('does not re-ask a browser that already granted', async () => {
    browser('granted');
    await expect(enablePush('user-1')).resolves.toBe('granted');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});

/**
 * The emulator flag gates REGISTRATION, never the UI state. Folding it into the
 * capability check made the whole notification screen read 'unsupported' in
 * every local run, so the button could not be seen, screenshotted or toured.
 */
describe('against the emulators', () => {
  async function loadWithEmulators() {
    vi.resetModules();
    vi.doMock('./env', () => ({ USE_EMULATORS: true }));
    const mod = await import('./notify.web');
    vi.doUnmock('./env');
    return mod;
  }

  it('still reports what the browser can do', async () => {
    browser('default');
    const { pushPromptState: state } = await loadWithEmulators();
    await expect(state()).resolves.toBe('default');
  });

  it('asks, but files no token there is no emulator to deliver to', async () => {
    browser('default');
    const { enablePush: enable } = await loadWithEmulators();
    await expect(enable('user-1')).resolves.toBe('unavailable');
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(setDoc).not.toHaveBeenCalled();
  });
});

/**
 * The blocked state branches on this. A browser offers no way to open its own
 * site settings, so the screen must show instructions there rather than a
 * button that silently does nothing.
 */
/**
 * The SYNCHRONOUS half of the support check — the part that gates the prompt.
 * Every other test hands it a fully capable browser, so without these a
 * deleted capability check would pass the whole suite while letting the app
 * call requestPermission on a browser that cannot do web push at all.
 */
/**
 * A support probe that never settles must not take the screen down with it.
 *
 * `isSupported()` opens IndexedDB, and an `open()` can neither resolve nor
 * reject — a blocked upgrade, a locked-down or private window. Unguarded, that
 * left `pushPromptState` pending for ever, so the notifications screen rendered
 * no "This device" section at all and the nudge never appeared: no throw, no
 * log, the one control the feature depends on silently absent.
 */
describe('a support check that hangs', () => {
  it('reports unsupported rather than never answering', async () => {
    vi.useFakeTimers();
    try {
      browser('default');
      asMock(isSupported).mockReturnValue(new Promise(() => {}));
      const pending = pushPromptState();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toBe('unsupported');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not file a token on a browser it could not establish support for', async () => {
    vi.useFakeTimers();
    try {
      browser('granted');
      asMock(isSupported).mockReturnValue(new Promise(() => {}));
      const pending = registerPush('user-1');
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toBe(false);
      expect(setDoc).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a browser missing a capability', () => {
  it('asks nothing when PushManager is absent', async () => {
    browser('default');
    // @ts-expect-error deleting a global we installed for the test
    delete globalThis.PushManager;
    await expect(pushPromptState()).resolves.toBe('unsupported');
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('asks nothing when the browser has no Notification at all', async () => {
    browser('default');
    const asked = requestPermission;
    // @ts-expect-error deleting a global we installed for the test
    delete globalThis.Notification;
    await expect(pushPromptState()).resolves.toBe('unsupported');
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
    expect(asked).not.toHaveBeenCalled();
  });

  it('asks nothing when there is no service worker', async () => {
    browser('default');
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    await expect(pushPromptState()).resolves.toBe('unsupported');
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('registers nothing rather than throwing', async () => {
    browser('granted');
    // @ts-expect-error deleting a global we installed for the test
    delete globalThis.PushManager;
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(setDoc).not.toHaveBeenCalled();
  });
});

/**
 * What a registration failure is REPORTED as, which is what decides whether it
 * pages anyone. The sign-in path runs silently on every visit, so a browser
 * that could not reach Google — offline at sign-in, or Google's Installations
 * service answering 503 — is the environment, not a defect: the token doc the
 * browser already holds keeps working and the next load tries again. Both
 * shapes were seen in production and both paged. Anything else on that path,
 * and every failure on the button, still does.
 */
describe('how a registration failure is reported', () => {
  /** A FirebaseError, as the SDK throws it: an Error with `code` and `customData`. */
  function firebaseError(code: string, customData?: Record<string, unknown>) {
    return Object.assign(new Error(code), { code, customData });
  }
  const levelOf = () => asMock(captureError).mock.calls[0]?.[2];
  /** 'error' is captureError's default, so "pages" means "was not demoted". */
  const pages = () => levelOf() !== 'warning';

  it('records a 503 from Google at sign-in as a warning, not an error', async () => {
    browser('granted');
    asMock(getToken).mockRejectedValue(
      firebaseError('installations/request-failed', { requestName: 'Generate Auth Token', serverCode: 503 }),
    );
    await expect(registerPush('user-1')).resolves.toBe(false);
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(levelOf()).toBe('warning');
  });

  it('records a browser offline at sign-in as a warning', async () => {
    browser('granted');
    asMock(getToken).mockRejectedValue(firebaseError('installations/app-offline'));
    await registerPush('user-1');
    expect(levelOf()).toBe('warning');
  });

  it('keeps a 4xx from Google at sign-in an error — that is the project or the key', async () => {
    browser('granted');
    asMock(getToken).mockRejectedValue(
      firebaseError('installations/request-failed', { requestName: 'Generate Auth Token', serverCode: 403 }),
    );
    await registerPush('user-1');
    expect(pages()).toBe(true);
  });

  it('keeps any other failure at sign-in an error', async () => {
    browser('granted');
    asMock(getToken).mockRejectedValue(firebaseError('messaging/token-subscribe-failed'));
    await registerPush('user-1');
    expect(pages()).toBe(true);
  });

  it('keeps every failure on the button an error, 503 included', async () => {
    browser('granted');
    asMock(getToken).mockRejectedValue(
      firebaseError('installations/request-failed', { requestName: 'Generate Auth Token', serverCode: 503 }),
    );
    await expect(enablePush('user-1')).resolves.toBe('unavailable');
    expect(captureError).toHaveBeenCalledTimes(1);
    expect(pages()).toBe(true);
  });
});

describe('opening settings', () => {
  it('is not possible from a browser', () => {
    expect(canOpenPushSettings).toBe(false);
  });

  it('is a no-op rather than a throw, so a mis-wired caller cannot crash a screen', () => {
    expect(() => openPushSettings()).not.toThrow();
  });
});

describe('pushPromptState', () => {
  it('reports a browser that can still be asked', async () => {
    browser('default');
    await expect(pushPromptState()).resolves.toBe('default');
  });

  it('reports one that has blocked notifications', async () => {
    browser('denied');
    await expect(pushPromptState()).resolves.toBe('denied');
  });

  it('reports an unsupported browser rather than offering a dead button', async () => {
    browser('default');
    asMock(isSupported).mockResolvedValue(false);
    await expect(pushPromptState()).resolves.toBe('unsupported');
  });
});
