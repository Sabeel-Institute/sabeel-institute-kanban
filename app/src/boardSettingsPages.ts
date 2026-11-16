/**
 * The pages of Board settings, and which one a route shows.
 *
 * Board settings is a list of pages: on a phone the list is a screen and a page
 * replaces it; on a wide screen the list runs down the side with a page beside
 * it. What the list holds depends only on whether the person runs the board,
 * so it is worked out here, without React, and the screen draws it.
 */

export type BoardSettingsPage =
  | 'general'
  | 'columns'
  | 'lanes'
  | 'details'
  | 'people'
  | 'labels'
  | 'history';

export const PAGE_TITLES: Record<BoardSettingsPage, string> = {
  general: 'General',
  columns: 'Columns',
  lanes: 'Lanes',
  details: 'Details',
  people: 'People',
  labels: 'Labels',
  history: 'History',
};

/**
 * In the order the list draws them.
 *
 * Someone who does not run the board gets the pages they can use: its
 * details (everyone on the board reads them), the people (who to ask), the
 * labels (a board's own are anyone-on-the-board's to change) and the history.
 * Not General or Columns drawn disabled, which reads as something broken.
 */
export function settingsPages(canManage: boolean): BoardSettingsPage[] {
  return canManage
    ? ['general', 'columns', 'lanes', 'details', 'people', 'labels', 'history']
    : ['details', 'people', 'labels', 'history'];
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

/**
 * What Back does on Board settings, from the routes on the stack (top last).
 *
 * Settings can stand on the stack as one entry or two: a page is pushed over
 * the list on a phone and replaces the top on a wide screen, and the width can
 * change while it is open (a tablet turned) or the page can stop being offered
 * (a demotion). So Back reads the stack rather than assuming its shape: from
 * the list, or anywhere on a wide screen, it leaves settings, every entry of
 * them; from a page on a phone it shows the list, the entry beneath when there
 * is one.
 */
export function settingsBack(
  stack: readonly { name: string; boardId?: string }[],
  boardId: string,
  wide: boolean,
  pageShown: boolean,
): { pop: number } | { toList: true } {
  let entries = 0;
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const r = stack[i];
    if (r.name !== 'boardSettings' || r.boardId !== boardId) break;
    entries += 1;
  }
  if (wide || !pageShown) return { pop: Math.max(1, entries) };
  return entries >= 2 ? { pop: 1 } : { toList: true };
}

/** What a page holds, as the list says it under the page's name. */
export interface PageFacts {
  archived: boolean;
  columns: number;
  members: number;
  owners: number;
  /** The board's own labels; null while they load or when they could not. */
  ownLabels: number | null;
  lanesOn: boolean;
  lanes: number;
  /** The finished column's name, while lanes are on. */
  finishedColumn: string | null;
  fields: number;
  /** Of those, the ones with a value. */
  filled: number;
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
    case 'lanes':
      if (!facts.lanesOn) return 'Off';
      if (facts.lanes === 0) return 'On, no lanes yet';
      return `On, ${count(facts.lanes, 'lane', 'lanes')}${
        facts.finishedColumn ? `. Finished cards are in ${facts.finishedColumn}` : ''
      }`;
    case 'details':
      return facts.fields === 0 ? 'None yet' : `${facts.filled} of ${facts.fields} filled in`;
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
