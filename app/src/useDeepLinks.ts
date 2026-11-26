/**
 * Open shared links once the user is active.
 *
 * Mounted from the signed-in shell, so the access gate has already run: a link
 * followed while signed out lands here right after sign-in, with the launch URL
 * still captured. A card link resolves its board live (findCardBoard) because a
 * card's board can change but its id cannot; when the card is gone or the
 * recipient is not on its board, we say so rather than opening nothing.
 *
 * Navigation goes through nav's module-level `push` (`openLinkTarget`), so this effect has
 * no reactive dependencies and runs exactly once per signed-in session.
 */
import { useEffect } from 'react';
import { consumeInitialLink } from './pendingLink';
import { subscribeLinks } from './deeplink';
import { parseLinkTarget, type LinkTarget } from './links';
import { openLinkTarget } from './openLink';

export function useDeepLinks(): void {
  useEffect(() => {
    let cancelled = false;

    const open = (target: LinkTarget) => openLinkTarget(target, () => cancelled);

    void consumeInitialLink().then((target) => {
      if (target && !cancelled) void open(target);
    });

    // Native only: a link opened while the app is already running.
    const unsubscribe = subscribeLinks((url) => {
      const target = parseLinkTarget(url);
      if (target) void open(target);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
}
