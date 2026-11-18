import { describe, expect, it } from 'vitest';
import {
  pageSummary,
  settingsBack,
  settingsPages,
  shownPage,
  type PageFacts,
} from './boardSettingsPages';

describe('settingsPages', () => {
  it('gives someone who runs the board every page, General first', () => {
    expect(settingsPages(true, false)).toEqual([
      'general',
      'columns',
      'lanes',
      'details',
      'people',
      'labels',
      'history',
    ]);
  });

  it('gives anyone else the pages they can use, and no others', () => {
    expect(settingsPages(false, true)).toEqual(['details', 'people', 'labels', 'history']);
    // No details: nothing for them on that page, and it would be the first.
    expect(settingsPages(false, false)).toEqual(['people', 'labels', 'history']);
  });
});

describe('shownPage', () => {
  const owner = settingsPages(true, false);
  const member = settingsPages(false, true);

  it('shows the list alone on a phone until a page is chosen', () => {
    expect(shownPage(undefined, owner, false)).toBeNull();
  });

  it('opens the first page on a wide screen', () => {
    expect(shownPage(undefined, owner, true)).toBe('general');
    expect(shownPage(undefined, member, true)).toBe('details');
  });

  it('shows the page asked for, at either width', () => {
    expect(shownPage('history', owner, false)).toBe('history');
    expect(shownPage('history', owner, true)).toBe('history');
  });

  // A live demotion re-renders a route the person can no longer use.
  it('treats a page the person cannot use as no page', () => {
    expect(shownPage('columns', member, false)).toBeNull();
    expect(shownPage('columns', member, true)).toBe('details');
  });
});

describe('pageSummary', () => {
  const facts: PageFacts = {
    archived: false,
    columns: 3,
    members: 4,
    owners: 2,
    ownLabels: 2,
    lanesOn: true,
    lanes: 6,
    finishedColumn: 'Done',
    fields: 5,
    filled: 3,
  };

  it('counts what each page holds', () => {
    expect(pageSummary('general', facts)).toBe('Name, archive');
    expect(pageSummary('columns', facts)).toBe('3 columns');
    expect(pageSummary('people', facts)).toBe('4 people, 2 owners');
    expect(pageSummary('labels', facts)).toBe('2 of this board’s own');
    expect(pageSummary('history', facts)).toBe('Who changed what');
  });

  it('says one, and none, in words', () => {
    const one: PageFacts = { ...facts, columns: 1, members: 1, owners: 1, ownLabels: 0, lanes: 1 };
    expect(pageSummary('columns', one)).toBe('1 column');
    expect(pageSummary('people', one)).toBe('1 person, 1 owner');
    expect(pageSummary('labels', one)).toBe('None of its own yet');
    expect(pageSummary('columns', { ...one, columns: 0 })).toBe('No columns');
    expect(pageSummary('people', { ...one, owners: 0 })).toBe('1 person, no owners');
  });

  it('says whether lanes are on, how many, and where finished cards are', () => {
    expect(pageSummary('lanes', facts)).toBe('On, 6 lanes. Finished cards are in Done');
    expect(pageSummary('lanes', { ...facts, lanes: 1 })).toBe('On, 1 lane. Finished cards are in Done');
    expect(pageSummary('lanes', { ...facts, lanes: 0 })).toBe('On, no lanes yet');
    expect(pageSummary('lanes', { ...facts, lanesOn: false })).toBe('Off');
  });

  it('says how many details are filled in, or that there are none', () => {
    expect(pageSummary('details', facts)).toBe('3 of 5 filled in');
    expect(pageSummary('details', { ...facts, fields: 0, filled: 0 })).toBe('None yet');
  });

  it('offers Restore on an archived board', () => {
    expect(pageSummary('general', { ...facts, archived: true })).toBe('Name, restore');
  });

  // Labels that could not be counted are not "none".
  it('says nothing about labels it could not count', () => {
    expect(pageSummary('labels', { ...facts, ownLabels: null })).toBeUndefined();
  });
});

describe('settingsBack', () => {
  const board = { name: 'board', boardId: 'b' };
  const list = { name: 'boardSettings', boardId: 'b' };
  const page = { name: 'boardSettings', boardId: 'b' };

  it('leaves settings from the list on a phone', () => {
    expect(settingsBack([board, list], 'b', false, false)).toEqual({ pop: 1 });
  });

  it('goes back to the list from a page pushed over it on a phone', () => {
    expect(settingsBack([board, list, page], 'b', false, true)).toEqual({ pop: 1 });
  });

  it('shows the list from a page with none beneath, as after turning a wide screen narrow', () => {
    expect(settingsBack([board, page], 'b', false, true)).toEqual({ toList: true });
  });

  it('leaves settings from a wide screen, every entry of it, as after turning a phone wide', () => {
    expect(settingsBack([board, list, page], 'b', true, true)).toEqual({ pop: 2 });
    expect(settingsBack([board, page], 'b', true, true)).toEqual({ pop: 1 });
  });

  it('leaves settings from the list drawn on a page no longer offered, not back to the list', () => {
    expect(settingsBack([board, list, page], 'b', false, false)).toEqual({ pop: 2 });
  });

  it('counts only this board’s settings', () => {
    const other = { name: 'boardSettings', boardId: 'x' };
    expect(settingsBack([other, board, page], 'b', true, true)).toEqual({ pop: 1 });
  });
});
