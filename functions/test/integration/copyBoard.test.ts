import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { COPY_BOARD_MAX_CARDS, SYSTEM_ACTOR, todayInOrgTz } from '@sabeel/shared';
import { adminDb, callFunction, idTokenFor, makeUser, shutdown, waitFor } from './emulatorClient';

/**
 * `copyBoard`: who may, and what a copy holds once the triggers have run.
 *
 * `boardCopy` (unit-tested in @sabeel/shared) decides what a copy holds; these
 * prove the callable's gates by the reason each refusal gives, and that the
 * copy is one whole write the triggers then treat as ordinary new cards.
 *
 * Unique ids: the emulator is shared by every suite in the run.
 */
const ORG = 'cb_org';
const ADMIN = 'cb_admin';
const MEM = 'cb_mem';
const OUTSIDER = 'cb_outsider';
const DISABLED = 'cb_disabled';

const board = (over: Record<string, unknown> = {}) => ({
  name: 'Program Template',
  description: 'Every program starts here',
  archived: false,
  columns: [
    { id: 'c_plan', name: 'Plan' },
    { id: 'c_run', name: 'Run' },
  ],
  columnIds: ['c_plan', 'c_run'],
  memberUids: [ORG, MEM],
  boardOwnerUids: [MEM],
  memberProfiles: {},
  activeCardCount: 0,
  createdAt: 1,
  createdBy: MEM,
  ...over,
});

const card = (boardId: string, over: Record<string, unknown> = {}) => ({
  boardId,
  title: 'A task',
  description: 'Do **this**',
  columnId: 'c_plan',
  rank: 'm',
  assigneeUids: [MEM],
  subscriberUids: [MEM],
  priority: 'high',
  dueDate: '2026-12-01',
  labelIds: [],
  archived: false,
  commentCount: 2,
  attachmentCount: 1,
  createdAt: 1,
  createdBy: MEM,
  updatedAt: 1,
  updatedBy: MEM,
  ...over,
});

const refusal = async (uid: string, data: unknown) => {
  const res = await callFunction('copyBoard', data, await idTokenFor(uid));
  expect(res.body.result).toBeUndefined();
  return res.body.error?.message;
};

beforeAll(async () => {
  await makeUser({ uid: ORG, email: `${ORG}@oursabeel.com`, role: 'organizer', status: 'active', displayName: 'Olive Organizer' });
  await makeUser({ uid: ADMIN, email: `${ADMIN}@oursabeel.com`, role: 'admin', status: 'active' });
  await makeUser({ uid: MEM, email: `${MEM}@oursabeel.com`, role: 'member', status: 'active' });
  await makeUser({ uid: OUTSIDER, email: `${OUTSIDER}@oursabeel.com`, role: 'organizer', status: 'active' });
  await makeUser({ uid: DISABLED, email: `${DISABLED}@oursabeel.com`, role: 'organizer', status: 'disabled' });

  await adminDb().collection('labels').doc('cb_inst').set({ name: 'CB Institute', color: '#83114F', createdAt: 1, createdBy: ADMIN });
  await adminDb().collection('labels').doc('cb_own').set({ boardId: 'cb_tmpl', name: 'CB Own', color: '#83114F', createdAt: 1, createdBy: MEM });

  await adminDb().doc('boards/cb_tmpl').set(board());
  const cards = adminDb().collection('cards');
  await cards.doc('cb_parent').set(card('cb_tmpl', { title: 'Parent', rank: 'b', labelIds: ['cb_inst', 'cb_own'] }));
  await cards.doc('cb_child').set(card('cb_tmpl', { title: 'Child', rank: 'c', parentId: 'cb_parent' }));
  await cards.doc('cb_later').set(card('cb_tmpl', { title: 'Later', columnId: 'c_run', rank: 'a' }));
  await cards.doc('cb_old').set(card('cb_tmpl', { title: 'Old', archived: true, archivedAt: 1 }));
  await cards.doc('cb_orphan_parent').set(card('cb_tmpl', { title: 'Archived parent', archived: true, archivedAt: 1 }));
  await cards.doc('cb_orphan').set(card('cb_tmpl', { title: 'Orphan', rank: 'd', parentId: 'cb_orphan_parent' }));
});

afterAll(async () => {
  await shutdown();
});

describe('copyBoard: who may', () => {
  it('refuses a plain member, because a copy is a new board', async () => {
    expect(await refusal(MEM, { boardId: 'cb_tmpl', name: 'Mine' })).toMatch(/Only organizers and admins/);
  });

  it('refuses a disabled organizer', async () => {
    expect(await refusal(DISABLED, { boardId: 'cb_tmpl', name: 'Mine' })).toMatch(/Only organizers and admins/);
  });

  it('refuses an organizer who is not on the board', async () => {
    await adminDb().doc('boards/cb_not_on').set(board({ memberUids: [MEM] }));
    expect(await refusal(OUTSIDER, { boardId: 'cb_not_on', name: 'Mine' })).toMatch(/only copy a board you are on/);
  });

  it('refuses an archived board', async () => {
    await adminDb().doc('boards/cb_archived').set(board({ archived: true }));
    expect(await refusal(ORG, { boardId: 'cb_archived', name: 'Mine' })).toMatch(/Restore this board/);
  });

  it('refuses a blank name and a missing board', async () => {
    expect(await refusal(ORG, { boardId: 'cb_tmpl', name: '   ' })).toMatch(/Give the board a name/);
    expect(await refusal(ORG, { boardId: 'cb_nowhere', name: 'Mine' })).toMatch(/No such board/);
  });

  it('lets an admin copy a board they are not on', async () => {
    await adminDb().doc('boards/cb_admin_src').set(board({ memberUids: [MEM] }));
    const res = await callFunction('copyBoard', { boardId: 'cb_admin_src', name: 'Admin copy' }, await idTokenFor(ADMIN));
    expect(res.body.error).toBeUndefined();
    const id = (res.body.result as { boardId: string }).boardId;
    const copy = (await adminDb().doc(`boards/${id}`).get()).data()!;
    expect(copy.memberUids).toEqual([ADMIN]);
    expect(copy.boardOwnerUids).toEqual([ADMIN]);
  });
});

describe('copyBoard: the copy', () => {
  let copyId = '';
  const copyCards = async () =>
    (await adminDb().collection('cards').where('boardId', '==', copyId).get()).docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string; title: string },
    );

  beforeAll(async () => {
    const res = await callFunction('copyBoard', { boardId: 'cb_tmpl', name: ' Spring Program ' }, await idTokenFor(ORG));
    expect(res.body.error).toBeUndefined();
    copyId = (res.body.result as { boardId: string }).boardId;
  });

  it('is a new board, the copier its only member and owner, with the template’s columns', async () => {
    const copy = (await adminDb().doc(`boards/${copyId}`).get()).data()!;
    expect(copy.name).toBe('Spring Program');
    expect(copy.description).toBe('Every program starts here');
    expect(copy.memberUids).toEqual([ORG]);
    expect(copy.boardOwnerUids).toEqual([ORG]);
    expect(copy.memberProfiles).toEqual({ [ORG]: { displayName: 'Olive Organizer', email: `${ORG}@oursabeel.com` } });
    expect(copy.columns.map((c: { name: string }) => c.name)).toEqual(['Plan', 'Run']);
    expect(copy.columnIds).toEqual(copy.columns.map((c: { id: string }) => c.id));
  });

  it('holds the open cards in their columns and order, without anything of one run', async () => {
    const copy = (await adminDb().doc(`boards/${copyId}`).get()).data()!;
    const [plan, run] = copy.columnIds as string[];
    const cards = await copyCards();
    const place = (c: Record<string, unknown>) => `${c.columnId === plan ? 'Plan' : c.columnId === run ? 'Run' : '?'}:${c.rank}:${c.title}`;
    expect(cards.map(place).sort()).toEqual(['Plan:b:Parent', 'Plan:c:Child', 'Plan:d:Orphan', 'Run:a:Later']);
    for (const c of cards) {
      expect(c).toMatchObject({
        description: 'Do **this**',
        assigneeUids: [],
        subscriberUids: [ORG],
        priority: 'none',
        archived: false,
        commentCount: 0,
        attachmentCount: 0,
        createdBy: ORG,
        updatedBy: ORG,
      });
      expect(c).not.toHaveProperty('dueDate');
    }
  });

  it('keeps the subtask family together and the institute’s label only', async () => {
    const cards = await copyCards();
    const byTitle = new Map(cards.map((c) => [c.title, c]));
    expect(byTitle.get('Child')!.parentId).toBe(byTitle.get('Parent')!.id);
    expect(byTitle.get('Orphan')).not.toHaveProperty('parentId');
    expect(byTitle.get('Parent')!.labelIds).toEqual(['cb_inst']);
  });

  it('leaves the template untouched', async () => {
    const parent = (await adminDb().doc('cards/cb_parent').get()).data()!;
    expect(parent.boardId).toBe('cb_tmpl');
    expect(parent.assigneeUids).toEqual([MEM]);
    expect(parent.labelIds).toEqual(['cb_inst', 'cb_own']);
  });

  it('is treated as ordinary new cards: history, card count and stats, and no notices', async () => {
    const cards = await copyCards();
    for (const c of cards) {
      await waitFor(`created entry on ${c.title}`, async () => {
        const entries = (await adminDb().collection(`cards/${c.id}/activity`).get()).docs.map((d) => d.data());
        return entries.some((e) => e.type === 'created' && e.actorUid === ORG) ? true : undefined;
      });
    }
    await waitFor('board history created entry', async () => {
      const entries = (await adminDb().collection(`boards/${copyId}/activity`).get()).docs.map((d) => d.data());
      return entries.some((e) => e.type === 'created') ? true : undefined;
    });
    await waitFor('activeCardCount 4', async () =>
      (await adminDb().doc(`boards/${copyId}`).get()).data()?.activeCardCount === 4 ? true : undefined);
    const today = todayInOrgTz();
    await waitFor('4 cards created today on the copy', async () => {
      const month = (await adminDb().doc(`stats/${copyId}/months/${today.slice(0, 7)}`).get()).data();
      return month?.days?.[today.slice(8, 10)]?.cardsCreated === 4 ? true : undefined;
    });
    for (const c of cards) {
      expect((await adminDb().doc(`pendingNotices/${c.id}`).get()).exists).toBe(false);
    }
    const inbox = await adminDb().collection(`users/${ORG}/notifications`).get();
    expect(inbox.size).toBe(0);
  });
});

/**
 * Last, and waited out: its cards fire the card triggers, which the emulator
 * runs one at a time, so a backlog left here would slow whatever runs next.
 * Stamped SYSTEM_ACTOR, which the activity trigger skips, to keep it short.
 */
describe('copyBoard: size', () => {
  it('refuses a board with more open cards than one copy takes, and writes nothing', async () => {
    await adminDb().doc('boards/cb_big').set(board());
    const batch = adminDb().batch();
    for (let i = 0; i <= COPY_BOARD_MAX_CARDS; i += 1) {
      batch.set(adminDb().doc(`cards/cb_big_${i}`), card('cb_big', { rank: `m${i}`, updatedBy: SYSTEM_ACTOR }));
    }
    await batch.commit();
    const before = (await adminDb().collection('boards').where('createdBy', '==', ORG).get()).size;
    expect(await refusal(ORG, { boardId: 'cb_big', name: 'Too big' })).toMatch(/a copy takes at most/);
    expect((await adminDb().collection('boards').where('createdBy', '==', ORG).get()).size).toBe(before);
    await waitFor(
      'the big board’s card count, so its triggers are done',
      async () => ((await adminDb().doc('boards/cb_big').get()).data()?.activeCardCount === COPY_BOARD_MAX_CARDS + 1 ? true : undefined),
      180_000,
    );
  }, 240_000);
});
