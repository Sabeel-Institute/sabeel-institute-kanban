/**
 * Whether the last thing a person did was press a key — NATIVE side of the
 * seam (web sibling: inputModality.web.ts). A phone draws no focus ring for a
 * touch, so there is nothing to decide.
 */
export function usingKeyboard(): boolean {
  return false;
}
