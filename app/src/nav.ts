import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';
import { goBackHistory, onPopState, pushHistory, replaceHistory } from './history';
import type { BoardSettingsPage } from './boardSettingsPages';

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
  /** No page is the list of pages on a phone, and the first page on a wide screen. */
  | { name: 'boardSettings'; boardId: string; page?: BoardSettingsPage }
  | { name: 'boardArchive'; boardId: string }
  | { name: 'newBoard' }
  | { name: 'card'; boardId: string; cardId: string }
  | { name: 'myWork' }
  | { name: 'search' }
  | { name: 'users' }
  | { name: 'stats' }
  | { name: 'labels' }
  | { name: 'report' }
  | { name: 'help' }
  | { name: 'helpFilm'; id: string }
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

function pop() {
  back(1);
}

/** Take `steps` screens off the stack at once, never the last. */
function back(steps: number) {
  const n = Math.min(steps, stack.length - 1);
  if (n <= 0) return;
  // On web let the BROWSER drive: history.go(-n) fires popstate, which calls
  // popInternal once a step. Popping here as well would take screens off
  // twice. Returns false on native, where we pop directly.
  if (goBackHistory(n)) return;
  for (let i = 0; i < n; i += 1) popInternal();
}

/**
 * Swap the screen on top for another without a step back to it: a choice made
 * WITHIN one screen, such as a page from the side list of Board settings on a
 * wide screen. Back then leaves the screen rather than walking every page that
 * was looked at. The browser's current entry still stands for the top of the
 * stack, so history is left alone.
 */
function replace(route: Route) {
  stack = [...stack.slice(0, -1), route];
  emit();
}

/** Replace the whole stack — used when signing out, or jumping to a root tab. */
function reset(route: Route) {
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
    /** The whole stack, top last, for a screen whose Back depends on it. */
    stack: s,
    canGoBack: s.length > 1,
    push: useCallback(push, []),
    pop: useCallback(pop, []),
    back: useCallback(back, []),
    replace: useCallback(replace, []),
    reset: useCallback(reset, []),
  };
}
