import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { adminDb, makeUser, shutdown } from './emulatorClient';
import { runDueSoonReminders } from '../../src/notifications';

/**
 * The 08:00 due-soon reminder, through `runDueSoonReminders`, since there is
 * no pubsub emulator to fire the schedule.
 *
 * A finished card is not due on any screen, so it is not reminded about
 * either: on a board with lanes, a card in the finished column gets nothing.
 * A board without lanes has no finished column, and its last column is
 * reminded about as it always was.
 *
 * Dated far in the future so no other suite's card is due the same day.
 */
const TODAY = '2099-01-10';
const WHO = 'ds_who';

const board = (over: Record<string, unknown> = {}) => ({
  name: 'Reminders',
  description: '',
  archived: false,
  columns: [
    { id: 'todo', name: 'To Do' },
    { id: 'done', name: 'Done' },
  ],
  columnIds: ['todo', 'done'],
  memberUids: [WHO],
  memberProfiles: {},
  createdAt: 1,
  createdBy: WHO,
  ...over,
});

const card = (boardId: string, columnId: string) => ({
  boardId,
  title: `${boardId} ${columnId}`,
  description: '',
  columnId,
  rank: 'V',
  assigneeUids: [WHO],
  subscriberUids: [],
  priority: 'none',
  labelIds: [],
  archived: false,
  commentCount: 0,
  dueDate: TODAY,
  createdAt: 1,
  createdBy: WHO,
  updatedAt: 1,
  updatedBy: WHO,
});

async function reminded(cardId: string): Promise<boolean> {
  const snap = await adminDb()
    .collection(`users/${WHO}/notifications`)
    .where('cardId', '==', cardId)
    .get();
  return snap.docs.some((d) => d.data().type === 'dueSoon');
}

beforeAll(async () => {
  await makeUser({ uid: WHO, email: `${WHO}@oursabeel.com`, role: 'member', status: 'active' });
  await adminDb()
    .doc('boards/ds_lanes')
    .set(board({ lanesOn: true, lanes: [{ id: 'ln_a', name: 'A' }], doneColumnId: 'done' }));
  await adminDb().doc('boards/ds_plain').set(board());
  await adminDb().doc('cards/ds_lanes_done').set(card('ds_lanes', 'done'));
  await adminDb().doc('cards/ds_lanes_todo').set(card('ds_lanes', 'todo'));
  await adminDb().doc('cards/ds_plain_done').set(card('ds_plain', 'done'));
  await runDueSoonReminders(TODAY);
});

afterAll(async () => {
  await shutdown();
});

describe('the due-soon reminder', () => {
  it('skips a finished card on a board with lanes', async () => {
    expect(await reminded('ds_lanes_done')).toBe(false);
  });

  it('still reminds about an unfinished card on that board', async () => {
    expect(await reminded('ds_lanes_todo')).toBe(true);
  });

  it('still reminds about the last column of a board without lanes', async () => {
    expect(await reminded('ds_plain_done')).toBe(true);
  });
});
