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

const comment = (over: Record<string, unknown> = {}) => ({
  authorUid: 'member1',
  body: 'looks good to me',
  mentionUids: [],
  createdAt: 1,
  ...over,
});

const CARD = 'cards/card1';

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
      columns: [{ id: 'c1', name: 'To Do' }],
      columnIds: ['c1'],
      memberUids: ['member1', 'member2'],
      boardOwnerUids: ['member1'],
      createdAt: 1,
      createdBy: 'member1',
    });
    // A second board member1 is NOT on, to prove comment rules resolve the
    // card's OWN boardId rather than assuming one.
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
    const cardDoc = (boardId: string) => ({
      boardId,
      title: 'Fix signup',
      description: '',
      columnId: boardId === 'b1' ? 'c1' : 'x1',
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
    });
    await setDoc(doc(db, CARD), cardDoc('b1'));
    // A card on b2 (member1 can't see it) with its own comment.
    await setDoc(doc(db, 'cards/card2'), cardDoc('b2'));
    await setDoc(doc(db, 'cards/card2/comments/c2existing'), comment());
    await setDoc(doc(db, `${CARD}/comments/existing`), comment());
    // SOMEONE ELSE'S comment. Moderation is the only thing that can act on this
    // one, so the delete test below proves board authority rather than
    // self-deletion — which is what it proved while it used `existing`, whose
    // author is the very person doing the deleting.
    await setDoc(doc(db, `${CARD}/comments/byMember2`), comment({ authorUid: 'member2' }));
    await setDoc(doc(db, `${CARD}/activity/a1`), {
      type: 'created',
      actorUid: 'member1',
      at: 1,
    });
  });
});

describe('reading comments', () => {
  it('a board member can read the thread', async () => {
    await assertSucceeds(
      getDocs(collection(ctx('member1', 'member'), `${CARD}/comments`)),
    );
  });

  it('a non-member cannot', async () => {
    await assertFails(
      getDocs(collection(ctx('stranger', 'member'), `${CARD}/comments`)),
    );
  });

  it('an ORGANIZER cannot, without being a member', async () => {
    // Reading a thread follows the board, and the org role no longer carries
    // sight of every board.
    await assertFails(
      getDocs(collection(ctx('org1', 'organizer'), `${CARD}/comments`)),
    );
    // An admin still can — the one remaining way to see everything.
    await assertSucceeds(
      getDocs(collection(ctx('admin1', 'admin'), `${CARD}/comments`)),
    );
  });

  it("resolves the card's OWN board — a member of b1 cannot read a b2 card's thread", async () => {
    // card2.boardId is b2; member1 is on b1, not b2. The rule must resolve the
    // card→board link, not assume the reader's board.
    await assertFails(
      getDocs(collection(ctx('member1', 'member'), 'cards/card2/comments')),
    );
  });
});

describe('writing comments', () => {
  it('a member can comment', async () => {
    await assertSucceeds(
      setDoc(doc(ctx('member1', 'member'), `${CARD}/comments/new1`), comment()),
    );
  });

  it('cannot comment as someone else', async () => {
    // Forged authorship would make the whole thread untrustworthy.
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), `${CARD}/comments/new2`),
        comment({ authorUid: 'member2' }),
      ),
    );
  });

  it('rejects an empty or over-long body', async () => {
    for (const body of ['', 'x'.repeat(5001)]) {
      await assertFails(
        setDoc(doc(ctx('member1', 'member'), `${CARD}/comments/new3`), comment({ body })),
      );
    }
  });

  it('rejects an unknown field on the comment', async () => {
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), `${CARD}/comments/new3b`),
        comment({ smuggled: 'x' }),
      ),
    );
  });

  it('rejects mentioning someone who is not on the board', async () => {
    // A mention that notifies someone who cannot open the card is a dead end.
    await assertFails(
      setDoc(
        doc(ctx('member1', 'member'), `${CARD}/comments/new4`),
        comment({ mentionUids: ['outsider'] }),
      ),
    );
  });

  it('allows mentioning a board member', async () => {
    await assertSucceeds(
      setDoc(
        doc(ctx('member1', 'member'), `${CARD}/comments/new5`),
        comment({ mentionUids: ['member2'] }),
      ),
    );
  });

  it('a non-member cannot comment', async () => {
    await assertFails(
      setDoc(
        doc(ctx('stranger', 'member'), `${CARD}/comments/new6`),
        comment({ authorUid: 'stranger' }),
      ),
    );
  });
});

describe('editing comments', () => {
  it('the author can edit their own', async () => {
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), `${CARD}/comments/existing`), {
        ...comment(),
        body: 'revised',
        editedAt: 2,
      }),
    );
  });

  it('another member cannot edit it', async () => {
    await assertFails(
      updateDoc(doc(ctx('member2', 'member'), `${CARD}/comments/existing`), {
        ...comment(),
        body: 'tampered',
      }),
    );
  });

  it('even an OWNER of the board cannot rewrite someone else’s words', async () => {
    // `member1` owns b1. Owners moderate by DELETING, never by editing under
    // another person's name — the delete test below is the positive control.
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), `${CARD}/comments/byMember2`), {
        authorUid: 'member2',
        body: 'rewritten by an owner',
        mentionUids: [],
        createdAt: 1,
      }),
    );
  });

  it('authorship cannot be reassigned by an edit', async () => {
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), `${CARD}/comments/existing`), {
        ...comment(),
        authorUid: 'member2',
      }),
    );
  });

  it('an edit can add a mention of a board member', async () => {
    // Editing in an @mention is a normal thing to do, and the client re-derives
    // mentionUids from the edited text, so this write shape must be allowed.
    await assertSucceeds(
      updateDoc(doc(ctx('member1', 'member'), `${CARD}/comments/existing`), {
        ...comment(),
        body: 'actually @member2 should see this',
        mentionUids: ['member2'],
        editedAt: 2,
      }),
    );
  });

  it('an edit cannot mention someone who is not on the board', async () => {
    // The gap this closes: `create` enforced board membership on mentions while
    // `update` checked nothing, so the invariant held for a new comment and
    // could be walked straight past by editing one. A mention that reaches
    // someone who cannot open the card is exactly what the rule exists to stop.
    await assertFails(
      updateDoc(doc(ctx('member1', 'member'), `${CARD}/comments/existing`), {
        ...comment(),
        body: 'sneaking in @outsider',
        mentionUids: ['outsider'],
        editedAt: 2,
      }),
    );
  });
});

describe('deleting comments', () => {
  it('the author can delete their own', async () => {
    await assertSucceeds(
      deleteDoc(doc(ctx('member1', 'member'), `${CARD}/comments/existing`)),
    );
  });

  it('an OWNER of the board can delete anyone’s comment — the moderation path', async () => {
    // Moderation is a property of the BOARD, not of a rank in the organisation.
    // member1 owns b1 while holding the plain `member` role, and the comment
    // being removed is member2's — so this is moderation, not self-deletion.
    await assertSucceeds(
      deleteDoc(doc(ctx('member1', 'member'), `${CARD}/comments/byMember2`)),
    );
  });

  it('another member cannot delete someone else’s', async () => {
    await assertFails(
      deleteDoc(doc(ctx('member2', 'member'), `${CARD}/comments/existing`)),
    );
  });

  it('nor can an organizer who does not own the board', async () => {
    await assertFails(
      deleteDoc(doc(ctx('org1', 'organizer'), `${CARD}/comments/byMember2`)),
    );
    // Only board authority was in the way.
    await assertSucceeds(
      deleteDoc(doc(ctx('admin1', 'admin'), `${CARD}/comments/byMember2`)),
    );
  });
});

describe('activity is read-only to everyone', () => {
  it('a member can read it', async () => {
    await assertSucceeds(getDoc(doc(ctx('member1', 'member'), `${CARD}/activity/a1`)));
  });

  it('a non-member cannot read it', async () => {
    await assertFails(getDoc(doc(ctx('stranger', 'member'), `${CARD}/activity/a1`)));
  });

  it('NOBODY can write it — not members, not owners, not admins', async () => {
    // The log is trustworthy precisely because it cannot be forged. `member1`
    // owns this board, so the middle row is the board-authority case.
    for (const [uid, role] of [
      ['member2', 'member'],
      ['member1', 'member'],
      ['admin1', 'admin'],
    ]) {
      await assertFails(
        setDoc(doc(ctx(uid, role), `${CARD}/activity/forged`), {
          type: 'moved',
          actorUid: 'someone-else',
          at: 2,
        }),
      );
      await assertFails(
        updateDoc(doc(ctx(uid, role), `${CARD}/activity/a1`), { actorUid: 'nobody' }),
      );
      await assertFails(deleteDoc(doc(ctx(uid, role), `${CARD}/activity/a1`)));
    }
  });
});
