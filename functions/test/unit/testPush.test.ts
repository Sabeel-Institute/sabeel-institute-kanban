import { describe, it, expect } from 'vitest';
import { testMessage } from '../../src/testPush';

/**
 * What `npx sabeel-ci send-test-push` sends for the `key=value` pairs it is
 * given, and what `npx sabeel-ci check-push` probes with (no pairs). A pair the
 * app cannot open must stop the push rather than send one that opens nothing.
 */
describe('testMessage', () => {
  it('opens the app where it was when no fields are given', () => {
    expect(testMessage('Test push', 'Safe to dismiss.', {})).toEqual({
      title: 'Test push',
      body: 'Safe to dismiss.',
      data: {},
    });
  });

  it('carries the fields as a notification carries its routing data', () => {
    expect(testMessage('t', 'b', { boardId: 'b1' })).toEqual({ title: 't', body: 'b', data: { boardId: 'b1' } });
    expect(testMessage('t', 'b', { type: 'assigned', boardId: 'b1', cardId: 'c1' })?.data).toEqual({
      type: 'assigned',
      boardId: 'b1',
      cardId: 'c1',
    });
    expect(testMessage('t', 'b', { type: 'newUserPending' })?.data).toEqual({ type: 'newUserPending' });
  });

  it('refuses fields that name nothing the app opens', () => {
    // A card needs its board.
    expect(testMessage('t', 'b', { cardId: 'c1' })).toBeNull();
    // A type alone opens nothing but People.
    expect(testMessage('t', 'b', { type: 'assigned' })).toBeNull();
    expect(testMessage('t', 'b', { type: 'newUserPending', boardId: 'b1' })).toBeNull();
    // Not a field a notification carries; notifId would mark an inbox entry read.
    expect(testMessage('t', 'b', { boardId: 'b1', notifId: 'n1' })).toBeNull();
    expect(testMessage('t', 'b', { screen: 'Board' })).toBeNull();
    expect(testMessage('t', 'b', { boardId: '' })).toBeNull();
  });
});
