/**
 * THE HELP FILMS: one short narrated film per thing people do in the app,
 * each made twice — on a phone and on a computer — with captions.
 *
 * This list is the one source. More → Help lists from it, and
 * `scripts/tutorials` records exactly these: its check fails on a film this
 * list does not name, or on one it names and nothing records.
 *
 * Everyone sees every film, whatever their role: a member who knows what an
 * owner can do knows whom to ask. The films show the demo world, never
 * anyone's real boards, so they are plain public files on a Hosting site of
 * their own (`HELP_FILMS_ORIGIN`), put there by `scripts/tutorials/publish.mjs`
 * and never by Deploy Web, whose site is rebuilt from git on every deploy.
 */

/** Whose work a film shows: anyone's, a board owner's, or an admin's. */
export type HelpAudience = 'everyone' | 'owner' | 'admin';

/** The two cuts of every film. */
export type HelpVariant = 'phone' | 'computer';

export const HELP_VARIANTS: readonly HelpVariant[] = ['phone', 'computer'];

export interface HelpVideo {
  id: string;
  title: string;
  /** One line under the title: what the film shows. */
  summary: string;
  audience: HelpAudience;
}

export const HELP_VIDEOS: readonly HelpVideo[] = [
  { id: 'signing-in', audience: 'everyone', title: 'Signing in', summary: 'Your institute Google account, waiting for approval, and the rules.' },
  { id: 'getting-around', audience: 'everyone', title: 'Finding your way around', summary: 'Boards, My Work, Search, Alerts and More.' },
  { id: 'board', audience: 'everyone', title: 'Inside a board', summary: 'Columns, cards, and adding a card.' },
  { id: 'card', audience: 'everyone', title: 'Working on a card', summary: 'The description, due date, priority, people and labels.' },
  { id: 'comments', audience: 'everyone', title: 'Comments and mentions', summary: 'Talking on a card, mentioning someone, and following a card.' },
  { id: 'attachments', audience: 'everyone', title: 'Attachments', summary: 'Putting files on a card, opening them and removing them.' },
  { id: 'subtasks', audience: 'everyone', title: 'Subtasks', summary: 'Breaking a card into smaller cards.' },
  { id: 'moving', audience: 'everyone', title: 'Moving and sharing a card', summary: 'Into another column, and sending someone a link to it.' },
  { id: 'archiving', audience: 'everyone', title: 'Archiving a card', summary: 'Putting a card away, finding it again, and bringing it back.' },
  { id: 'bulk', audience: 'everyone', title: 'Several cards at once', summary: 'Selecting cards, and moving, assigning or archiving them together, even to another board.' },
  { id: 'my-work', audience: 'everyone', title: 'My Work', summary: 'Every card assigned to you, from every board.' },
  { id: 'search', audience: 'everyone', title: 'Search', summary: 'Finding a card by its words, and narrowing the results.' },
  { id: 'notifications', audience: 'everyone', title: 'Alerts and notifications', summary: 'What you are told about, and choosing what reaches your phone.' },
  { id: 'report', audience: 'everyone', title: 'Reporting a problem', summary: 'Telling the administrators about a post or a person.' },
  { id: 'new-board', audience: 'owner', title: 'Creating a board', summary: 'Who can, and setting one up.' },
  { id: 'board-settings', audience: 'owner', title: 'Board settings and columns', summary: 'Renaming a board, and adding, renaming and reordering columns.' },
  { id: 'board-people', audience: 'owner', title: 'Members and owners', summary: 'Adding and removing people, and sharing the running of a board.' },
  { id: 'board-archive', audience: 'owner', title: 'Deleting cards and archiving a board', summary: 'Deleting a card for good, and putting a finished board away.' },
  { id: 'people', audience: 'admin', title: 'Approving people', summary: 'New accounts waiting for you, and letting them in.' },
  { id: 'roles', audience: 'admin', title: 'Roles and access', summary: 'Admin, organizer and member, and turning an account off.' },
  { id: 'labels', audience: 'admin', title: 'Managing labels', summary: 'Renaming, recolouring and deleting labels for everyone.' },
  { id: 'stats', audience: 'admin', title: 'Stats', summary: 'How the boards are being used, and what is behind a bar.' },
];

/** The site the films are served from: public, and nothing else is on it. */
export const HELP_FILMS_ORIGIN = 'https://sabeel-kanban-help.web.app';

/** A film's file name on that site, and in the recorder's output folder. */
export function helpFilmFile(id: string, variant: HelpVariant, kind: 'video' | 'captions'): string {
  return `${id}-${variant}.${kind === 'video' ? 'mp4' : 'vtt'}`;
}

/** Where one cut of a film, or its captions, is played from. */
export function helpFilmUrl(id: string, variant: HelpVariant, kind: 'video' | 'captions'): string {
  return `${HELP_FILMS_ORIGIN}/${helpFilmFile(id, variant, kind)}`;
}
