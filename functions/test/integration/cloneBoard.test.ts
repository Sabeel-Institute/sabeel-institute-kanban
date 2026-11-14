import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { CLONE_BOARD_MAX_CARDS, NOTICE_MAX_WAIT_MS, SYSTEM_ACTOR, todayInOrgTz } from '@sabeel/shared';
import { adminDb, callFunction, idTokenFor, makeUser, shutdown, waitFor } from './emulatorClient';
import { runNoticeSweep } from '../../src/notices';

/**
 * `cloneBoard`: who may, and what a clone holds once the triggers have run.
 *
 * `boardClone` (unit-tested in @sabeel/shared) decides what a clone holds; these
 * prove the callable's gates by the reason each refusal gives, that a clone is
 * one whole write that keeps its own books — the count, the history and the
 * Stats exactly once, the card triggers staying out — and that asking twice
 * makes one clone.
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

/** A fresh board id, as the app makes one for each offer of a clone. */
const newId = () => adminDb().collection('boards').doc().id;

/**
 * That `check` holds for `ms`, sampled: for a figure the triggers would
 * change, had they not stayed out, some time after the write.
 */
async function stays(label: string, check: () => Promise<boolean>, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    expect(await check(), label).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const refusal = async (uid: string, data: unknown) => {
  const res = await callFunction('cloneBoard', data, await idTokenFor(uid));
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

describe('cloneBoard: who may', () => {
  it('refuses a plain member, because a clone is a new board', async () => {
    expect(await refusal(MEM, { boardId: 'cb_tmpl', name: 'Mine', cloneId: newId() })).toMatch(/Only organizers and admins/);
  });

  it('refuses a disabled organizer', async () => {
    expect(await refusal(DISABLED, { boardId: 'cb_tmpl', name: 'Mine', cloneId: newId() })).toMatch(/Only organizers and admins/);
  });

  it('refuses an organizer who is not on the board', async () => {
    await adminDb().doc('boards/cb_not_on').set(board({ memberUids: [MEM] }));
    expect(await refusal(OUTSIDER, { boardId: 'cb_not_on', name: 'Mine', cloneId: newId() })).toMatch(/only clone a board you are on/);
  });

  it('refuses an archived board', async () => {
    await adminDb().doc('boards/cb_archived').set(board({ archived: true }));
    expect(await refusal(ORG, { boardId: 'cb_archived', name: 'Mine', cloneId: newId() })).toMatch(/Restore this board/);
  });

  it('refuses a blank name and a missing board', async () => {
    expect(await refusal(ORG, { boardId: 'cb_tmpl', name: '   ', cloneId: newId() })).toMatch(/Give the board a name/);
    expect(await refusal(ORG, { boardId: 'cb_nowhere', name: 'Mine', cloneId: newId() })).toMatch(/No such board/);
    expect(await refusal(ORG, { boardId: 'cb_tmpl', name: 'Mine', cloneId: 'not/an id' })).toMatch(/A cloneId is required/);
  });

  it('lets an admin clone a board they are not on', async () => {
    await adminDb().doc('boards/cb_admin_src').set(board({ memberUids: [MEM] }));
    const res = await callFunction('cloneBoard', { boardId: 'cb_admin_src', name: 'Admin clone', cloneId: newId() }, await idTokenFor(ADMIN));
    expect(res.body.error).toBeUndefined();
    const id = (res.body.result as { boardId: string }).boardId;
    const clone = (await adminDb().doc(`boards/${id}`).get()).data()!;
    expect(clone.memberUids).toEqual([ADMIN]);
    expect(clone.boardOwnerUids).toEqual([ADMIN]);
  });
});

describe('cloneBoard: the clone', () => {
  const cloneId = newId();
  const cloneCards = async () =>
    (await adminDb().collection('cards').where('boardId', '==', cloneId).get()).docs.map(
      (d) => ({ id: d.id, ...d.data() }) as Record<string, unknown> & { id: string; title: string },
    );

  beforeAll(async () => {
    const res = await callFunction('cloneBoard', { boardId: 'cb_tmpl', name: ' Spring Program ', cloneId }, await idTokenFor(ORG));
    expect(res.body.error).toBeUndefined();
    expect(res.body.result).toEqual({ boardId: cloneId });
  });

  it('is a new board, the cloner its only member and owner, with the template’s columns', async () => {
    const clone = (await adminDb().doc(`boards/${cloneId}`).get()).data()!;
    expect(clone.name).toBe('Spring Program');
    expect(clone.description).toBe('Every program starts here');
    expect(clone.memberUids).toEqual([ORG]);
    expect(clone.boardOwnerUids).toEqual([ORG]);
    expect(clone.memberProfiles).toEqual({ [ORG]: { displayName: 'Olive Organizer', email: `${ORG}@oursabeel.com` } });
    expect(clone.columns.map((c: { name: string }) => c.name)).toEqual(['Plan', 'Run']);
    expect(clone.columnIds).toEqual(clone.columns.map((c: { id: string }) => c.id));
  });

  it('holds the open cards in their columns and order, without anything of one run', async () => {
    const clone = (await adminDb().doc(`boards/${cloneId}`).get()).data()!;
    const [plan, run] = clone.columnIds as string[];
    const cards = await cloneCards();
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
        // The clone keeps its own books, which keeps the card triggers out.
        updatedBy: SYSTEM_ACTOR,
      });
      expect(c).not.toHaveProperty('dueDate');
    }
  });

  it('keeps the subtask family together and the institute’s label only', async () => {
    const cards = await cloneCards();
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

  it('keeps its own books: one history line a card, the count and Stats once, nobody notified', async () => {
    const cards = await cloneCards();
    const ids = new Set(cards.map((c) => c.id));
    // Written with the cards, so there at once.
    expect((await adminDb().doc(`boards/${cloneId}`).get()).data()?.activeCardCount).toBe(4);
    const today = todayInOrgTz();
    const createdToday = async () =>
      (await adminDb().doc(`stats/${cloneId}/months/${today.slice(0, 7)}`).get()).data()?.days?.[today.slice(8, 10)]?.cardsCreated;
    expect(await createdToday()).toBe(4);
    const createdLines = async (id: string) =>
      (await adminDb().collection(`cards/${id}/activity`).get()).docs.map((d) => d.data()).filter((e) => e.type === 'created');
    for (const c of cards) {
      expect(await createdLines(c.id)).toEqual([{ type: 'created', actorUid: ORG, at: c.createdAt }]);
    }
    await waitFor('board history created entry', async () => {
      const entries = (await adminDb().collection(`boards/${cloneId}/activity`).get()).docs.map((d) => d.data());
      return entries.some((e) => e.type === 'created') ? true : undefined;
    });
    // Each card's "created" queues a notice, as any new card's does: once
    // they are all queued, the card triggers have had the clone too. Had they
    // not stayed out, the count, Stats and history would now be doubling.
    for (const c of cards) {
      await waitFor(`pending notice on ${c.title}`, async () =>
        (await adminDb().doc(`pendingNotices/${c.id}`).get()).exists ? true : undefined);
    }
    await stays('the count, Stats and history stay as the clone wrote them', async () => {
      if ((await adminDb().doc(`boards/${cloneId}`).get()).data()?.activeCardCount !== 4) return false;
      if ((await createdToday()) !== 4) return false;
      for (const c of cards) if ((await createdLines(c.id)).length !== 1) return false;
      return true;
    });
    // The sweep sends the queued notices to nobody: the cloner made the cards
    // and is their only follower, and the template's people are not on the clone.
    await runNoticeSweep(Date.now() + NOTICE_MAX_WAIT_MS + 1000);
    for (const c of cards) {
      expect((await adminDb().doc(`pendingNotices/${c.id}`).get()).exists).toBe(false);
    }
    for (const uid of [ORG, MEM]) {
      const inbox = await adminDb().collection(`users/${uid}/notifications`).get();
      expect(inbox.docs.map((d) => d.data()).filter((n) => ids.has(n.cardId))).toEqual([]);
    }
  });

  it('asked again with the same id, answers with the same clone and makes no second', async () => {
    const again = await callFunction('cloneBoard', { boardId: 'cb_tmpl', name: 'Spring Program', cloneId }, await idTokenFor(ORG));
    expect(again.body.result).toEqual({ boardId: cloneId });
    expect(await cloneCards()).toHaveLength(4);
    expect((await adminDb().collection('boards').where('name', '==', 'Spring Program').get()).size).toBe(1);
    // Someone else cannot take that id over.
    expect(await refusal(ADMIN, { boardId: 'cb_tmpl', name: 'Mine', cloneId })).toMatch(/already exists/);
  });
});

/**
 * Last: their cards fire the card triggers, which the emulator runs one at a
 * time. Stamped SYSTEM_ACTOR and assigned to nobody, so those return at once,
 * and the count test waits for a marker written after them.
 */
describe('cloneBoard: size', () => {
  it('refuses a board holding more text than one write takes, and writes nothing', async () => {
    await adminDb().doc('boards/cb_heavy').set(board());
    // Three bytes a character, 20,000 characters, the most a description may hold.
    const heavy = '€'.repeat(20000);
    for (let b = 0; b < 3; b += 1) {
      const batch = adminDb().batch();
      for (let i = 0; i < 50; i += 1) {
        batch.set(
          adminDb().doc(`cards/cb_heavy_${b}_${i}`),
          card('cb_heavy', { rank: `m${b}${i}`, description: heavy, assigneeUids: [], updatedBy: SYSTEM_ACTOR }),
        );
      }
      await batch.commit();
    }
    const cloneId = newId();
    expect(await refusal(ORG, { boardId: 'cb_heavy', name: 'Too heavy', cloneId })).toMatch(/too much text to clone/);
    expect((await adminDb().doc(`boards/${cloneId}`).get()).exists).toBe(false);
  });

  it('refuses a board with more open cards than one clone takes, and writes nothing', async () => {
    await adminDb().doc('boards/cb_big').set(board());
    const batch = adminDb().batch();
    for (let i = 0; i <= CLONE_BOARD_MAX_CARDS; i += 1) {
      batch.set(adminDb().doc(`cards/cb_big_${i}`), card('cb_big', { rank: `m${i}`, assigneeUids: [], updatedBy: SYSTEM_ACTOR }));
    }
    await batch.commit();
    const cloneId = newId();
    expect(await refusal(ORG, { boardId: 'cb_big', name: 'Too big', cloneId })).toMatch(
      new RegExp(`more than ${CLONE_BOARD_MAX_CARDS} open cards`),
    );
    expect((await adminDb().doc(`boards/${cloneId}`).get()).exists).toBe(false);
    // A card written after them, by a person: once its history is there, the
    // triggers queued before it have run, and nothing is left for later suites.
    await adminDb().doc('cards/cb_big_marker').set(card('cb_big', { assigneeUids: [] }));
    await waitFor(
      'the marker card’s history',
      async () => ((await adminDb().collection('cards/cb_big_marker/activity').get()).size > 0 ? true : undefined),
      60_000,
    );
  }, 120_000);
});
