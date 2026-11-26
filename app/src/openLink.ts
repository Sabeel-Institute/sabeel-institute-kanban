/**
 * Opening a link to this app from inside it.
 *
 * A card's or a board's link pasted into a description, a comment or a
 * board's notes is a link to a screen of this app. Handed to the system it
 * left the app for a browser, which on a phone meant signing in again to see
 * a card one tap away. So rich text asks here first: our own links navigate,
 * everything else opens as before. Shared links arriving from outside take
 * the same path (`useDeepLinks`).
 */
import { Linking } from 'react-native';
import { notifyUser } from './alert';
import { findCardBoard } from './cards';
import { parseLinkTarget, type LinkTarget } from './links';
import { push } from './nav';
import { WEB_ORIGIN } from './share';

/** Where the app is served; on the web `WEB_ORIGIN` is wherever this tab came from. */
const PRODUCTION_ORIGIN = 'https://sabeel-institute-kanban.web.app';

/** Open a card or a board. A card's board is found live: a card can move. */
export async function openLinkTarget(target: LinkTarget, cancelled: () => boolean = () => false) {
  if (target.kind === 'board') {
    push({ name: 'board', boardId: target.boardId });
    return;
  }
  const boardId = await findCardBoard(target.cardId);
  if (cancelled()) return;
  if (boardId) {
    push({ name: 'card', boardId, cardId: target.cardId });
  } else {
    notifyUser('Card unavailable', "This card may have been deleted, or you're not a member of its board.");
  }
}

/** A link to one of this app's screens, or null for anywhere else. */
function appLinkTarget(href: string): LinkTarget | null {
  const ours = [WEB_ORIGIN, PRODUCTION_ORIGIN].some((o) => href === o || href.startsWith(`${o}/`));
  return ours ? parseLinkTarget(href) : null;
}

/** What tapping a link in rich text does. */
export function openRichHref(href: string): void {
  const target = appLinkTarget(href);
  if (target) void openLinkTarget(target);
  else void Linking.openURL(href).catch(() => undefined);
}
