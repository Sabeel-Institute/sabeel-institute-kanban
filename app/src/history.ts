/**
 * Browser-history integration — NATIVE no-op (web sibling: history.web.ts).
 *
 * Android's Back is handled by `useHardwareBack` in nav.ts; there is no history
 * stack to keep in step here.
 */
export function pushHistory(): void {}
export function replaceHistory(): void {}

/** Returns false so nav.ts pops its own stack directly on native. */
export function goBackHistory(_steps = 1): boolean {
  return false;
}

export function onPopState(_cb: () => void): void {}
