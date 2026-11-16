import { describe, expect, it } from 'vitest';
import { pageSummary, settingsPages, shownPage, type PageFacts } from './boardSettingsPages';

describe('settingsPages', () => {
  it('gives someone who runs the board every page, General first', () => {
    expect(settingsPages(true)).toEqual(['general', 'columns', 'people', 'labels', 'history']);
  });

  it('gives anyone else the pages they can use, and no others', () => {
    expect(settingsPages(false)).toEqual(['people', 'labels', 'history']);
  });
});

describe('shownPage', () => {
  const owner = settingsPages(true);
  const member = settingsPages(false);

  it('shows the list alone on a phone until a page is chosen', () => {
    expect(shownPage(undefined, owner, false)).toBeNull();
  });

  it('opens the first page on a wide screen', () => {
    expect(shownPage(undefined, owner, true)).toBe('general');
    expect(shownPage(undefined, member, true)).toBe('people');
  });

  it('shows the page asked for, at either width', () => {
    expect(shownPage('history', owner, false)).toBe('history');
    expect(shownPage('history', owner, true)).toBe('history');
  });

  // A live demotion re-renders a route the person can no longer use.
  it('treats a page the person cannot use as no page', () => {
    expect(shownPage('columns', member, false)).toBeNull();
    expect(shownPage('columns', member, true)).toBe('people');
  });
});

describe('pageSummary', () => {
  const facts: PageFacts = { archived: false, columns: 3, members: 4, owners: 2, ownLabels: 2 };

  it('counts what each page holds', () => {
    expect(pageSummary('general', facts)).toBe('Name, archive');
    expect(pageSummary('columns', facts)).toBe('3 columns');
    expect(pageSummary('people', facts)).toBe('4 people, 2 owners');
    expect(pageSummary('labels', facts)).toBe('2 of this board’s own');
    expect(pageSummary('history', facts)).toBe('Who changed what');
  });

  it('says one, and none, in words', () => {
    const one: PageFacts = { archived: false, columns: 1, members: 1, owners: 1, ownLabels: 0 };
    expect(pageSummary('columns', one)).toBe('1 column');
    expect(pageSummary('people', one)).toBe('1 person, 1 owner');
    expect(pageSummary('labels', one)).toBe('None of its own yet');
    expect(pageSummary('columns', { ...one, columns: 0 })).toBe('No columns');
    expect(pageSummary('people', { ...one, owners: 0 })).toBe('1 person, no owners');
  });

  it('offers Restore on an archived board', () => {
    expect(pageSummary('general', { ...facts, archived: true })).toBe('Name, restore');
  });

  // Labels that could not be counted are not "none".
  it('says nothing about labels it could not count', () => {
    expect(pageSummary('labels', { ...facts, ownLabels: null })).toBeUndefined();
  });
});
