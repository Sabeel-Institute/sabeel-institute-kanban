import { describe, expect, it, vi } from 'vitest';

vi.mock('./sentry', () => ({ captureError: vi.fn() }));
const { errorText, toUserMessage } = await import('./errors');

/**
 * What a person reads when something fails. Every case is a shape this app's
 * own dependencies produce: `FunctionsError` sets `message` to the description
 * with no prefix, and `@firebase/util`'s `ErrorFactory` builds
 * `Firebase: <message> (<service>/<code>).`
 */
const GENERIC = 'Something went wrong. Try again in a moment.';
const UNREACHABLE = 'Cannot reach the server. Check your connection and try again.';

describe('errorText', () => {
  it("passes a callable's own sentence straight through", () => {
    expect(errorText(new Error("Only a board's owners can do that."))).toBe("Only a board's owners can do that.");
  });

  it.each(['unauthenticated', 'permission-denied', 'INTERNAL'])('turns the bare code %s into a sentence', (code) => {
    expect(errorText(Object.assign(new Error(code), { code: `functions/${code}` }))).toBe(GENERIC);
  });

  it('says plainly that a callable never got an answer, as on 2026-10-22', () => {
    // fetch failed or the reply was not the function's own: the SDK makes the
    // code and the message both `internal`, which the sign-in screen showed.
    expect(errorText(Object.assign(new Error('internal'), { code: 'functions/internal' }))).toBe(UNREACHABLE);
    expect(errorText(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }))).toBe(UNREACHABLE);
    expect(errorText(Object.assign(new Error('deadline-exceeded'), { code: 'functions/deadline-exceeded' }))).toBe(UNREACHABLE);
    expect(errorText(Object.assign(new Error('Firebase: Error (auth/network-request-failed).'), {
      code: 'auth/network-request-failed',
    }))).toBe(UNREACHABLE);
    expect(errorText(Object.assign(new Error('Failed to get document because the client is offline.'), {
      code: 'unavailable',
    }))).toBe(UNREACHABLE);
  });

  it('turns away the SDK talking to a developer', () => {
    expect(errorText(Object.assign(new Error('Firebase: Error (auth/user-not-found).'), { code: 'auth/user-not-found' })))
      .toBe(GENERIC);
    expect(errorText(Object.assign(new Error(
      "Firebase Storage: User does not have permission to access 'boards/b/cards/c/x.pdf'. (storage/unauthorized)",
    ), { code: 'storage/unauthorized' }))).toBe(GENERIC);
  });

  it('turns away a native module talking to a developer', () => {
    expect(errorText(new Error(
      "Call to function 'ExponentImagePicker.launchCameraAsync' has been rejected.\n→ Caused by: java.lang.SecurityException",
    ))).toBe(GENERIC);
  });

  it('says something for nothing at all', () => {
    expect(errorText(undefined)).toBe(GENERIC);
    expect(errorText(new Error(''))).toBe(GENERIC);
  });
});

describe('toUserMessage', () => {
  it('shows what errorText says, never the bare code', () => {
    expect(toUserMessage(Object.assign(new Error('internal'), { code: 'functions/internal' }), 'signIn')).toBe(UNREACHABLE);
  });
});
