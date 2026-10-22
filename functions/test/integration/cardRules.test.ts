import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc,
  collection,
  query,
  where,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { EMULATOR_PROJECT_ID } from '@sabeel/shared';
import { firestoreHostPort } from './emulatorHosts';

let env: RulesTestEnvironment;

function ctx(uid: string, role: string, status = 'active') {
  return env
    .authenticatedContext(uid, {
      email: `${uid}@oursabeel.com`,
      email_verified: true,
      role,
      status,
    })
    .firestore();
}

// Cards are a TOP-LEVEL collection now (`cards/{id}`) with a `boardId` field.
const card = (over: Record<string, unknown> = {}) => ({
  boardId: 'b1',
  title: 'Fix signup flow',
  description: '',
  columnId: 'c1',
  rank: 'V',
  assigneeUids: [],
  priority: 'none',
  labelIds: [],
  archived: false,
  commentCount: 0,
  createdAt: 1,
  createdBy: 'member1',
  updatedAt: 1,
  updatedBy: 'member1',
  ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
      ...firestoreHostPort(),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'boards/b1'), {
      name: 'Ops',
      description: '',
      archived: false,
      columns: [
        { id: 'c1', name: 'To Do' },
        { id: 'c2', name: 'Done' },
      ],
      columnIds: ['c1', 'c2'],
      memberUids: ['member1', 'member2'],
      boardOwnerUids: ['member1'],
      createdAt: 1,
      createdBy: 'member1',
    });
    await setDoc(doc(db, 'boards/b2'), {
      name: 'Private',
      description: '',
      archived: false,
      columns: [{ id: 'x1', name: 'To Do' }],
      columnIds: ['x1'],
      memberUids: ['outsider'],
      boardOwnerUids: ['outsider'],
      createdAt: 1,
      createdBy: 'outsider',
    });
    // A second board member1 IS on, for the successful cross-board move.
    await setDoc(doc(db, 'boards/b3'), {
      name: 'Roadmap',
      description: '',
      archived: false,
      columns: [{ id: 'd1', name: 'To Do' }],
      columnIds: ['d1'],
      memberUids: ['member1'],
      boardOwnerUids: ['member1'],
      createdAt: 1,
      createdBy: 'member1',
    });
    await setDoc(doc(db, 'cards/card1'), card());
    // A card on a board member1 is NOT on, but which they are assigned to.
    // Only possible via a data error; the read rule must not widen access
    // beyond that one card.
    await setDoc(
      doc(db, 'cards/foreign'),
      card({ boardId: 'b2', columnId: 'x1', assigneeUids: ['member1'], createdBy: 'outsider' }),
    );
    await setDoc(doc(db, 'cards/foreign2'), card({ boardId: 'b2', columnId: 'x1' }));
    // member2's card on a board member1 cannot see — for the "someone else's
    // assignments" query below.
    await setDoc(
      doc(db, 'cards/m2card'),
      card({ boardId: 'b2', columnId: 'x1', assigneeUids: ['member2'] }),
    );
    // A card carrying a ClickUp `sourceId` — the key-set restriction must not
    // make imported cards uneditable.
    await setDoc(doc(db, 'cards/imported'), card({ sourceId: 'clickup-99' }));
  });
});

describe('reading cards', () => {
  it('a board member reads cards on their board', async () => {
    await assertSucceeds(getDoc(doc(ctx('member1', 'member'), 'cards/card1')));
  });

  it('an ORGANIZER cannot read cards on a board they are not on', async () => {
    // This used to succeed: the role carried sight of every board, and with it
    // every card on every board.
    await assertFails(getDoc(doc(ctx('org1', 'organizer'), 'cards/foreign2')));
    // An admin still can, and that is the only remaining way to see everything.
    await assertSucceeds(getDoc(doc(ctx('admin1', 'admin'), 'cards/foreign2')));
  });

  it('a non-member cannot read cards on a board they are not on', async () => {
    await assertFails(getDoc(doc(ctx('member1', 'member'), 'cards/foreign2')));
  });

  it('an assignee can read the specific card assigned to them', async () => {
    // The arm that makes the My Work query legal without a parent lookup. It
    // grants exactly one card, not the board.
    await assertSucceeds(getDoc(doc(ctx('member1', 'member'), 'cards/foreign')));
  });

  it('being assigned to one card does not open the rest of that board', async () => {
    await assertFails(getDoc(doc(ctx('member1', 'member'), 'cards/foreign2')));
    await assertFails(getDoc(doc(ctx('member1', 'member'), 'boards/b2')));
  });

  it('a pending user reads nothing', async () => {
    await assertFails(getDoc(doc(ctx('member1', 'member', 'pending'), 'cards/card1')));
  });
});

describe('the My Work query (top-level cards)', () => {
  it('is allowed when constrained to your own assignments', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'cards'),
          where('assigneeUids', 'array-contains', 'member1'),
        ),
      ),
    );
  });

  it('is refused unconstrained — that would be every card in the org', async () => {
    await assertFails(getDocs(collection(ctx('member1', 'member'), 'cards')));
  });

  it('is refused when asking for someone else assignments', async () => {
    await assertFails(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'cards'),
          where('assigneeUids', 'array-contains', 'member2'),
        ),
      ),
    );
  });
});

describe('the Subscribed query, and what subscribing may NOT do', () => {
  it('is allowed when constrained to your own subscriptions', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'cards'),
          where('subscriberUids', 'array-contains', 'member1'),
        ),
      ),
    );
  });

  it('is refused when asking for someone else’s subscriptions', async () => {
    await assertFails(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'cards'),
          where('subscriberUids', 'array-contains', 'member2'),
        ),
      ),
    );
  });

  it('lets a board member subscribe themselves', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        subscriberUids: ['member1'],
        updatedBy: 'member1',
      }),
    );
  });

  it('REFUSES a subscriber who is not on the board', async () => {
    // The load-bearing one. The read rule has a subscriber arm, so without this
    // constraint adding a uid to any card you knew the id of would be a way into
    // a board you are not on.
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        subscriberUids: ['outsider'],
        updatedBy: 'member1',
      }),
    );
    // …and only the membership was in the way.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        subscriberUids: ['member2'],
        updatedBy: 'member1',
      }),
    );
  });

  it('still edits a card written before subscriberUids existed', async () => {
    // `.get('subscriberUids', [])` on both sides. With plain access every card
    // predating the field would be permanently uneditable.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        title: 'Renamed with no subscriber field present',
        updatedBy: 'member1',
      }),
    );
  });
});

describe('creating cards', () => {
  it('a board member can create one', async () => {
    await assertSucceeds(setDoc(doc(ctx('member1', 'member'), 'cards/new1'), card()));
  });

  it('a non-member of the target board cannot', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new2'),
        // member1 is not a member of b2.
        card({ boardId: 'b2', columnId: 'x1' }),
      ),
    );
  });

  it('rejects a column that does not exist on the board', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new3'),
        card({ columnId: 'not-a-column' }),
      ),
    );
  });

  it('rejects a column belonging to a DIFFERENT board', async () => {
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/new4'), card({ columnId: 'x1' })),
    );
  });

  it('rejects assigning someone who is not a board member', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new5'),
        card({ assigneeUids: ['outsider'] }),
      ),
    );
  });

  it('allows assigning an actual board member', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new6'),
        card({ assigneeUids: ['member2'] }),
      ),
    );
  });

  it('rejects a forged author', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new7'),
        card({ createdBy: 'member2', updatedBy: 'member2' }),
      ),
    );
  });

  it('rejects a forged updatedBy actor', async () => {
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/new7b'), card({ updatedBy: 'member2' })),
    );
  });

  it('rejects an empty or over-long title', async () => {
    for (const title of ['', 'x'.repeat(201)]) {
      await assertFails(
        setDoc(doc(ctx('member1', 'member'), 'cards/new8'), card({ title })),
      );
    }
  });

  it('rejects an unknown priority', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new9'),
        card({ priority: 'catastrophic' }),
      ),
    );
  });

  it('rejects a card born archived', async () => {
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/new10'), card({ archived: true })),
    );
  });

  it('rejects an unknown field on the card', async () => {
    // No arbitrary keys: an approved member could otherwise pad a card with a
    // large field that every board viewer then re-downloads.
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/new11'), card({ smuggled: 'x' })),
    );
  });

  it('rejects an over-long description', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new12'),
        card({ description: 'x'.repeat(20001) }),
      ),
    );
  });

  /**
   * WHAT UNIT DOES `size()` COUNT? Characters — not UTF-8 bytes.
   *
   * This matters and was open until it was measured. The client gate is
   * `storedLength`, which is `String.length` (UTF-16 units). If the rule
   * counted BYTES instead, a description of accented or Arabic text would pass
   * the counter, be offered a live Save button, and come back as a bare
   * `permission-denied` — the exact failure `constants.ts` documents, in a new
   * coat, and one this org would hit rather than a theoretical one.
   *
   * 20,000 x 'e-acute' is 20,000 characters but 40,000 UTF-8 bytes. It is
   * accepted, so the rule is not byte-based; one more character is rejected, so
   * the two ends agree on the unit.
   */
  it('counts the description cap in CHARACTERS, not UTF-8 bytes', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new12b'),
        card({ description: '\u00e9'.repeat(20000) }),
      ),
    );
  });

  it('and rejects the same multi-byte text one character over', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new12c'),
        card({ description: '\u00e9'.repeat(20001) }),
      ),
    );
  });

  it('allows a card carrying a sourceId (ClickUp import shape)', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new13'),
        card({ sourceId: 'clickup-123' }),
      ),
    );
  });

  it('allows a card carrying a parentId (a subtask)', async () => {
    // The key-set restriction lists parentId, or every subtask would become
    // uneditable the moment it was linked.
    await assertSucceeds(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new14'),
        card({ parentId: 'some-other-card' }),
      ),
    );
  });

  it('rejects a non-string parentId', async () => {
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/new15'), card({ parentId: 42 })),
    );
  });

  it('rejects an over-long parentId', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/new16'),
        card({ parentId: 'x'.repeat(201) }),
      ),
    );
  });
});

describe('updating cards (in-board)', () => {
  it('a member can move a card between columns on their board', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        columnId: 'c2',
        rank: 'W',
      }),
    );
  });

  it('a member can archive a card', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), { ...card(), archived: true }),
    );
  });

  it('cannot move a card to a column that does not exist', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), { ...card(), columnId: 'ghost' }),
    );
  });

  it('un-archiving alone is refused once the card’s column is gone', async () => {
    // This is why restoreCard() re-homes a card instead of only flipping
    // `archived`. A column may be deleted once it holds no LIVE cards — and the
    // message shown when deletion is blocked tells you to "move or archive them
    // first" — so archiving a column's cards and then deleting the column is a
    // documented path, and it leaves archived cards pointing at a dead column.
    // Flipping `archived` alone then carries the stale columnId into
    // wellFormed()'s columnExists() check and is rejected, which would strand
    // the card: unrestorable, uneditable, and undeletable by a member.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(
        doc(c.firestore(), 'cards/stranded'),
        card({ columnId: 'deleted-col', archived: true }),
      );
    });
    const db = ctx('member1', 'member');
    await assertFails(
      updateDoc(doc(db, 'cards/stranded'), {
        ...card({ columnId: 'deleted-col' }),
        archived: false,
      }),
    );
    // Re-homing it into a column that still exists is what restoreCard does.
    await assertSucceeds(
      updateDoc(doc(db, 'cards/stranded'), {
        ...card({ columnId: 'c1' }),
        archived: false,
      }),
    );
  });

  it('cannot assign a non-member during an update', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        assigneeUids: ['outsider'],
      }),
    );
  });

  it('cannot rewrite authorship or creation time', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        createdBy: 'member1_impostor',
      }),
    );
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), { ...card(), createdAt: 999 }),
    );
  });

  it('cannot forge the updatedBy actor', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        updatedBy: 'member2',
      }),
    );
  });

  it('a non-member cannot update', async () => {
    await assertFails(
      updateDoc(doc(ctx('stranger', 'member'), 'cards/card1'), {
        ...card(),
        title: 'Hijacked',
        updatedBy: 'stranger',
      }),
    );
  });

  it('can move a card that carries a sourceId (imported cards stay editable)', async () => {
    // The key-set restriction lists sourceId, or every imported card would become
    // read-only the moment someone tried to move or edit it.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/imported'), {
        ...card({ sourceId: 'clickup-99' }),
        columnId: 'c2',
        rank: 'W',
      }),
    );
  });

  it('can move a card that carries a parentId (subtasks stay editable)', async () => {
    // Same trap as sourceId: omit parentId from the key list and a card becomes
    // read-only the moment it is made a subtask.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card({ parentId: 'parent-card' }),
        columnId: 'c2',
        rank: 'W',
      }),
    );
  });

  it('can UNLINK a subtask by dropping parentId', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), { ...card() }),
    );
  });

  it('rejects adding an unknown field on update', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), { ...card(), smuggled: 'x' }),
    );
  });
});

describe('moving a card to another board', () => {
  it('a plain member moves a card to a board they are also on', async () => {
    // Proves a move is an EDIT, not a delete — the delete gate (owners and
    // admins) must not apply. member1 is on both b1 and b3.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        boardId: 'b3',
        columnId: 'd1',
        labelIds: [],
        assigneeUids: [],
      }),
    );
  });

  it('cannot move a card to a board you are not a member of', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        boardId: 'b2',
        columnId: 'x1',
      }),
    );
  });

  it('the destination column must exist on the destination board', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        boardId: 'b3',
        columnId: 'c1', // c1 is a b1 column, not on b3
      }),
    );
  });

  it('cannot keep an assignee who is not a member of the destination', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        ...card(),
        boardId: 'b3',
        columnId: 'd1',
        assigneeUids: ['member2'], // member2 is not on b3
      }),
    );
  });
});

describe('attachmentCount is trigger-owned', () => {
  it('refuses a card created claiming attachments', async () => {
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/forged'), card({ attachmentCount: 3 })),
    );
  });

  it('refuses a client moving the count on an existing card', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        attachmentCount: 7,
        updatedBy: 'member1',
        updatedAt: 2,
      }),
    );
  });

  it('still lets a card written BEFORE the field existed be edited', async () => {
    // card1 is seeded without attachmentCount. Pinning with plain field access
    // instead of .get(…, 0) would make every such card permanently uneditable —
    // the trap the board's activeCardCount pin already documents.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        title: 'edited fine',
        updatedBy: 'member1',
        updatedAt: 2,
      }),
    );
  });
});

describe('lastActivityAt is trigger-owned', () => {
  it('refuses a card created claiming activity', async () => {
    // A client that could set this would pin its own card to the top of
    // Search's newest-first order for as long as it liked.
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), 'cards/forged2'),
        card({ lastActivityAt: 9_999_999_999 }),
      ),
    );
  });

  it('refuses a client moving it on an existing card', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        lastActivityAt: 9_999_999_999,
        updatedBy: 'member1',
        updatedAt: 2,
      }),
    );
  });

  it('still lets a card written BEFORE the field existed be edited', async () => {
    // Same trap as attachmentCount above: plain field access instead of
    // .get(…, 0) makes every pre-existing card permanently uneditable.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        title: 'edited fine, no activity field',
        updatedBy: 'member1',
        updatedAt: 3,
      }),
    );
  });
});

describe('commentCount is trigger-owned', () => {
  /**
   * The third counter, and the one that had no pin at all.
   *
   * It was in the key list from the beginning and constrained nowhere, so any
   * active member could write it to any number they liked — and
   * `onCommentWritten` only ever INCREMENTS, so a forged value never
   * self-corrects and there is no backfill script that would rebuild it. The
   * card screen renders `Comments (N)` straight from the field.
   */
  it('refuses a card created claiming comments', async () => {
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/forged3'), card({ commentCount: 4 })),
    );
  });

  it('refuses a client moving the count on an existing card', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        commentCount: 99,
        updatedBy: 'member1',
        updatedAt: 2,
      }),
    );
  });

  it('lets an ordinary edit carry the stored count through', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        title: 'edited fine, count untouched',
        updatedBy: 'member1',
        updatedAt: 2,
      }),
    );
  });
});

describe('the stamps Search orders by cannot be set to the future', () => {
  /**
   * Pinning `lastActivityAt` alone secured nothing.
   *
   * Search orders by `lastActivityOf` = `max(lastActivityAt, updatedAt,
   * createdAt)`, and `updatedAt` is client-written with its value constrained
   * nowhere — so the pin above had an open door beside it, through which any
   * member could hold the top of "Newest first", and the bottom of "Oldest
   * first", for every colleague.
   */
  const future = () => Date.now() + 40 * 24 * 3600 * 1000;

  it('refuses an edit stamping updatedAt in the future', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        title: 'pinned to the top',
        updatedBy: 'member1',
        updatedAt: future(),
      }),
    );
  });

  it('refuses a card created with a future updatedAt or createdAt', async () => {
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/f4'), card({ updatedAt: future() })),
    );
    await assertFails(
      setDoc(doc(ctx('member1', 'member'), 'cards/f5'), card({ createdAt: future() })),
    );
  });

  it('allows an hour of clock skew, because client clocks are wrong', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        title: 'ordinary edit from a fast clock',
        updatedBy: 'member1',
        updatedAt: Date.now() + 10 * 60 * 1000,
      }),
    );
  });

  it('still allows an ordinary edit stamped now', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), 'cards/card1'), {
        title: 'ordinary edit',
        updatedBy: 'member1',
        updatedAt: Date.now(),
      }),
    );
  });

  /**
   * The test on an update is on the CHANGE, not on the value — and this is why.
   *
   * A card carrying a future stamp is reachable from data written before the
   * bound existed, or from one badly-set clock. `subscribeToCard` deliberately
   * does not restamp `updatedAt` (following a conversation is not doing work on
   * the card), so a value-based test would make that card permanently
   * un-subscribable, by nobody's fault and with no way to fix it.
   */
  describe('a card whose stored stamp is already in the future', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (c) => {
        await setDoc(
          doc(c.firestore(), 'cards/skewed'),
          card({ updatedAt: Date.now() + 40 * 24 * 3600 * 1000 }),
        );
      });
    });

    it('can still be written by a path that carries the stamp through', async () => {
      await assertSucceeds(
        updateDoc(doc(ctx('member1', 'member'), 'cards/skewed'), {
          subscriberUids: ['member1'],
          updatedBy: 'member1',
        }),
      );
    });

    it('cannot have that stamp pushed further forward', async () => {
      await assertFails(
        updateDoc(doc(ctx('member1', 'member'), 'cards/skewed'), {
          title: 'further still',
          updatedBy: 'member1',
          updatedAt: Date.now() + 80 * 24 * 3600 * 1000,
        }),
      );
    });
  });
});

describe('deleting cards', () => {
  it('a plain member CANNOT delete — they archive instead', async () => {
    // member2 is on b1 and does NOT own it; member1 does. Being on the board is
    // not the thing that grants this.
    await assertFails(deleteDoc(doc(ctx('member2', 'member'), 'cards/card1')));
  });

  it('an OWNER of the card’s board can delete', async () => {
    // member1 owns b1. Permanent deletion is board authority now, not a rank —
    // and note the actor holds the plain `member` role.
    await assertSucceeds(deleteDoc(doc(ctx('member1', 'member'), 'cards/card1')));
  });

  it('an ORGANIZER who does not own the board cannot delete', async () => {
    await assertFails(deleteDoc(doc(ctx('org1', 'organizer'), 'cards/card1')));
  });

  it('an admin can delete', async () => {
    await assertSucceeds(deleteDoc(doc(ctx('admin1', 'admin'), 'cards/card1')));
  });

  it('a disabled owner cannot delete', async () => {
    await assertFails(
      deleteDoc(doc(ctx('member1', 'member', 'disabled'), 'cards/card1')),
    );
  });
});

describe('listing cards on a board', () => {
  it('a member can list their board cards', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'cards'),
          where('boardId', '==', 'b1'),
          where('archived', '==', false),
        ),
      ),
    );
  });

  it('a non-member cannot list another board cards', async () => {
    await assertFails(
      getDocs(
        query(collection(ctx('member1', 'member'), 'cards'), where('boardId', '==', 'b2')),
      ),
    );
  });

  it('a member can list across their boards with a boardId in-query (Search)', async () => {
    // The consolidated Search query. member1 is on both b1 and b3.
    await assertSucceeds(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'cards'),
          where('boardId', 'in', ['b1', 'b3']),
          where('archived', '==', false),
        ),
      ),
    );
  });

  it('a member cannot in-query a board they are not on', async () => {
    // b2 is not member1's, so the whole in-query must be refused.
    await assertFails(
      getDocs(
        query(
          collection(ctx('member1', 'member'), 'cards'),
          where('boardId', 'in', ['b1', 'b2']),
        ),
      ),
    );
  });
});
