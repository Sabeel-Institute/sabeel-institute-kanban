/**
 * WEB: always 0 (native sibling: useKeyboardHeight.ts), which leaves a sheet
 * where it always was in a browser.
 *
 * Not because a browser handles it: Chrome on Android (108 on) and Safari
 * shrink only the visual viewport for an on-screen keyboard, so a fixed,
 * centred dialog stays put and the keys can cover its foot. `visualViewport`
 * would give the height, but no browser test can raise a keyboard to show
 * the result, and colleagues on phones use the app.
 */
export function useKeyboardHeight(): number {
  return 0;
}
