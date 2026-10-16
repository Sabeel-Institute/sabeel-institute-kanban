import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { goBackHistory, onPopState, pushHistory, replaceHistory } from './history';

/**
 * A tiny navigation stack.
 *
 * Deliberately not react-navigation: this app has a handful of screens, and the
 * routes below are a closed, typed union. A hand-rolled stack keeps the web and
 * Android surfaces behaving identically with no platform configuration, and it
 * is small enough to read in one sitting.
 *
 * Browser history IS wired (see ./history): each push adds an entry so the
 * browser's back button walks this stack instead of leaving the site. Routes are
 * not serialised into history state, so the forward button cannot restore a
 * screen — if that or deep links ever matter, this is the one module to replace.
 */
export type Route =
  | { name: 'boards' }
  | { name: 'board'; boardId: string }
  | { name: 'boardSettings'; boardId: string }
  | { name: 'boardArchive'; boardId: string }
  | { name: 'newBoard' }
  | { name: 'card'; boardId: string; cardId: string }
  | { name: 'myWork' }
  | { name: 'search' }
  | { name: 'users' }
  | { name: 'stats' }
  | { name: 'report' }
  | { name: 'notifications' };

let stack: Route[] = [{ name: 'boards' }];
const listeners = new Set<(s: Route[]) => void>();

function emit() {
  const snapshot = [...stack];
  listeners.forEach((l) => l(snapshot));
}

export function push(route: Route) {
  stack = [...stack, route];
  pushHistory();
  emit();
}

/** Pop without touching history — the browser has already moved. */
function popInternal() {
  if (stack.length > 1) {
    stack = stack.slice(0, -1);
    emit();
  }
}

// A browser Back walks our stack rather than leaving the site.
onPopState(popInternal);

export function pop() {
  if (stack.length <= 1) return;
  // On web let the BROWSER drive: history.back() fires popstate, which calls
  // popInternal. Popping here as well would take two screens off one press.
  // Returns false on native, where we pop directly.
  if (goBackHistory()) return;
  popInternal();
}

/** Replace the whole stack — used when signing out, or jumping to a root tab. */
export function reset(route: Route) {
  stack = [route];
  replaceHistory();
  emit();
}

/**
 * Wire Android's hardware Back — and the edge-swipe gesture, which raises the
 * same event — to this stack.
 *
 * A hand-rolled stack is invisible to Android, so without this the OS sees an
 * activity with nothing to pop and EXITS the app from any screen. Opening a
 * card and swiping back closed the whole app instead of returning to the board.
 *
 * Returning true consumes the event. Returning false at the root deliberately
 * lets Android do its normal thing and leave the app, which is what people
 * expect from the first screen.
 *
 * `BackHandler` is a no-op shim under react-native-web, so this is safe to call
 * unconditionally. Browser Back is a SEPARATE gap: this stack pushes no history
 * entries, so the browser's back button still leaves the site — that needs
 * history integration, noted at the top of this module.
 */
export function useHardwareBack() {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);
}

export function useNav() {
  const [s, setS] = useState<Route[]>(stack);
  useEffect(() => {
    listeners.add(setS);
    setS(stack);
    return () => {
      listeners.delete(setS);
    };
  }, []);

  return {
    route: s[s.length - 1],
    canGoBack: s.length > 1,
    push: useCallback(push, []),
    pop: useCallback(pop, []),
    reset: useCallback(reset, []),
  };
}
