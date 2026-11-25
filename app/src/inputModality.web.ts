/**
 * Whether the last thing a person did was press a key — WEB side of the seam
 * (native sibling: inputModality.ts).
 *
 * A ring drawn from react-native-web's `focused` shows after a click as well
 * as a Tab, unlike the browser's own `:focus-visible`, and focus handed back
 * after a pick then left a ring on a control the mouse had just used. A ring
 * a style draws itself asks this instead. Listened for in the capture phase,
 * so the answer is current before any handler of the app's runs.
 */
let keyboard = false;
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', () => (keyboard = true), true);
  document.addEventListener('pointerdown', () => (keyboard = false), true);
}

export function usingKeyboard(): boolean {
  return keyboard;
}
