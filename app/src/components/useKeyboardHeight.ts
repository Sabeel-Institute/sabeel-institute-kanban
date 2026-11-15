import { useKeyboardState } from 'react-native-keyboard-controller';

/**
 * How much of the screen the keyboard covers, in points — NATIVE (web sibling:
 * useKeyboardHeight.web.ts).
 *
 * Read from `react-native-keyboard-controller`, which follows the IME through
 * WindowInsets, and follows it into a `Modal`'s own window too (its
 * `ModalAttachedWatcher`). React Native's `Keyboard` events do not fire under
 * edge-to-edge, and the dialog window a `Modal` opens is not resized for the
 * keyboard, so nothing else here learns that the keys are up.
 */
export function useKeyboardHeight(): number {
  return useKeyboardState((k) => k.height);
}
