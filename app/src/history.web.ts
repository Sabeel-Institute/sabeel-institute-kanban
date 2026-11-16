/**
 * Browser-history integration — WEB (native sibling: history.ts).
 *
 * A hand-rolled navigation stack is invisible to the browser, so the back button
 * left the site entirely from any screen — the web twin of the Android bug fixed
 * with BackHandler.
 *
 * The browser DRIVES: `goBackHistory` calls `history.back()` and returns true,
 * so nav.ts does not pop immediately. The resulting `popstate` is what pops our
 * stack. Popping directly as well would take two screens off for one press.
 *
 * Known limitation: routes are not serialised into history state, so the FORWARD
 * button cannot restore a screen. Depth is tracked to detect it and re-align by
 * pushing a fresh entry, which keeps back working correctly rather than
 * silently drifting. Serialising routes is the fix if forward ever matters —
 * see the note at the top of nav.ts.
 */
const subscribers = new Set<() => void>();
let depth = 0;
// A Back sent to the browser and not yet answered. A second press before the
// popstate arrives would go back from the same place again, past where the
// first was taken, and could leave the app.
let backing = false;

if (typeof window !== 'undefined') {
  window.history.replaceState({ depth: 0 }, '');
  window.addEventListener('popstate', (e) => {
    backing = false;
    const next = (e.state as { depth?: number } | null)?.depth ?? 0;
    if (next < depth) {
      // One call per step: a jump of several entries (`history.go(-n)`)
      // takes as many screens off the stack.
      const steps = depth - next;
      depth = next;
      for (let i = 0; i < steps; i += 1) subscribers.forEach((f) => f());
    } else {
      // Forward, or an entry we cannot reconstruct: re-align without navigating.
      depth = next;
      window.history.replaceState({ depth }, '');
    }
  });
}

export function pushHistory(): void {
  if (typeof window === 'undefined') return;
  depth += 1;
  window.history.pushState({ depth }, '');
}

export function replaceHistory(): void {
  if (typeof window === 'undefined') return;
  depth = 0;
  window.history.replaceState({ depth }, '');
}

export function goBackHistory(steps = 1): boolean {
  if (typeof window === 'undefined') return false;
  if (backing) return true;
  backing = true;
  // Should the browser not move (nothing to go back to), no popstate comes;
  // a press is never held up for longer than this.
  setTimeout(() => {
    backing = false;
  }, 1000);
  window.history.go(-steps);
  return true;
}

export function onPopState(cb: () => void): void {
  subscribers.add(cb);
}
