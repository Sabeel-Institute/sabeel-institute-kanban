/**
 * The pages of Board settings, and which one a route shows.
 *
 * Board settings is a list of pages: on a phone the list is a screen and a page
 * replaces it; on a wide screen the list runs down the side with a page beside
 * it. What the list holds depends only on whether the person runs the board,
 * so it is worked out here, without React, and the screen draws it.
 */

export type BoardSettingsPage = 'general' | 'columns' | 'people' | 'labels' | 'history';

export const PAGE_TITLES: Record<BoardSettingsPage, string> = {
  general: 'General',
  columns: 'Columns',
  people: 'People',
  labels: 'Labels',
  history: 'History',
};

/**
 * In the order the list draws them.
 *
 * Someone who does not run the board gets the pages they can use: the people
 * (who to ask), the labels (a board's own are anyone-on-the-board's to change)
 * and the history. Not General or Columns drawn disabled, which reads as
 * something broken.
 */
export function settingsPages(canManage: boolean): BoardSettingsPage[] {
  return canManage
    ? ['general', 'columns', 'people', 'labels', 'history']
    : ['people', 'labels', 'history'];
}

/**
 * The page on screen, or null for the list alone.
 *
 * A wide screen always shows a page, the first in the list until another is
 * chosen. A page the person cannot use, which a live demotion leaves on the
 * stack, is treated as no page: the list on a phone, the first page on a wide
 * screen.
 */
export function shownPage(
  requested: BoardSettingsPage | undefined,
  pages: readonly BoardSettingsPage[],
  wide: boolean,
): BoardSettingsPage | null {
  if (requested && pages.includes(requested)) return requested;
  return wide ? (pages[0] ?? null) : null;
}

/** What a page holds, as the list says it under the page's name. */
export interface PageFacts {
  archived: boolean;
  columns: number;
  members: number;
  owners: number;
  /** The board's own labels; null while they load or when they could not. */
  ownLabels: number | null;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The line under a page's name in the list, or undefined for none.
 *
 * An unknown label count says nothing rather than "none": a list that could not
 * load is not a board with no labels.
 */
export function pageSummary(page: BoardSettingsPage, facts: PageFacts): string | undefined {
  switch (page) {
    case 'general':
      return facts.archived ? 'Name, restore' : 'Name, archive';
    case 'columns':
      return facts.columns === 0 ? 'No columns' : count(facts.columns, 'column', 'columns');
    case 'people':
      return `${count(facts.members, 'person', 'people')}, ${
        facts.owners === 0 ? 'no owners' : count(facts.owners, 'owner', 'owners')
      }`;
    case 'labels':
      if (facts.ownLabels === null) return undefined;
      return facts.ownLabels === 0
        ? 'None of its own yet'
        : `${facts.ownLabels} of this board’s own`;
    case 'history':
      return 'Who changed what';
  }
}
