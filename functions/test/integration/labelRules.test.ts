import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { EMULATOR_PROJECT_ID, LABEL_COLORS, LABEL_NAME_MAX } from '@sabeel/shared';
import { firestoreHostPort } from './emulatorHosts';

/**
 * Rules for the `labels` collection and its two scopes.
 *
 * What these pin: a label's SCOPE decides who may add or change it. An
 * institute label (no `boardId`) is on every board and is admin work. A board's
 * own label is anyone on that board's, owner or not, and nobody else's. And
 * `boardId` never moves, or a label could be carried into a scope its mover may
 * change.
 *
 * `assertFails` passes when an operation fails for ANY reason, so every denial
 * here is paired with a positive control: the same write succeeding once the one
 * thing under test is put right. A suite of bare denials proves nothing.
 */
let env: RulesTestEnvironment;

function ctx(uid: string, role: string, status = 'active') {
  return env.authenticatedContext(uid, {
    email: `${uid}@oursabeel.com`,
    email_verified: true,
    role,
    status,
  });
}

const fs = (uid: string, role: string, status = 'active') => ctx(uid, role, status).firestore();

/** An institute label: no `boardId`. */
const institute = (over: Record<string, unknown> = {}) => ({
  name: 'Finance',
  color: LABEL_COLORS[0],
  createdAt: 1,
  createdBy: 'member1',
  ...over,
});

/**
 * A label of board b1's own, which member1 is on. The default for the shape
 * checks below, because it is the label an ordinary member may create.
 */
const label = (over: Record<string, unknown> = {}) => institute({ boardId: 'b1', ...over });

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
    for (const [id, members] of [['b1', ['member1', 'owner1']], ['b2', ['other1']]] as const) {
      await setDoc(doc(c.firestore(), `boards/${id}`), {
        name: id,
        memberUids: [...members],
        boardOwnerUids: [members[members.length - 1]],
      });
    }
    await setDoc(doc(c.firestore(), 'labels/existing'), institute({ name: 'Blocked' }));
    await setDoc(doc(c.firestore(), 'labels/own'), label({ name: 'Venue' }));
  });
});

describe('reading labels', () => {
  it('is open to every active account, on no board at all', async () => {
    // Deliberately someone with zero board memberships: a label can appear on a
    // card on any board, so scoping reads by membership would blank the chips
    // in My Work and Search, which are cross-board by definition.
    await assertSucceeds(getDocs(collection(fs('nobody', 'member'), 'labels')));
  });

  it('is closed to an account that is not approved yet', async () => {
    await assertFails(getDocs(collection(fs('pending1', 'member', 'pending'), 'labels')));
    // …and only the approval was in the way.
    await assertSucceeds(getDocs(collection(fs('pending1', 'member', 'active'), 'labels')));
  });
});

describe('creating an institute label', () => {
  it('is admin work, not organizer or member work', async () => {
    await assertFails(addDoc(collection(fs('member1', 'member'), 'labels'), institute()));
    await assertFails(
      addDoc(collection(fs('org1', 'organizer'), 'labels'), institute({ createdBy: 'org1' })),
    );
    // Only the role was in the way.
    await assertSucceeds(
      addDoc(collection(fs('admin1', 'admin'), 'labels'), institute({ createdBy: 'admin1' })),
    );
  });
});

describe('creating a board label', () => {
  it('is allowed to anyone on that board, owner or not', async () => {
    await assertSucceeds(addDoc(collection(fs('member1', 'member'), 'labels'), label()));
    await assertSucceeds(
      addDoc(collection(fs('owner1', 'member'), 'labels'), label({ createdBy: 'owner1' })),
    );
  });

  it('is refused to someone not on that board', async () => {
    await assertFails(
      addDoc(collection(fs('other1', 'member'), 'labels'), label({ createdBy: 'other1' })),
    );
    // The same person, on their own board.
    await assertSucceeds(
      addDoc(collection(fs('other1', 'member'), 'labels'), label({ createdBy: 'other1', boardId: 'b2' })),
    );
  });

  it('is allowed to an admin who is not on the board', async () => {
    await assertSucceeds(
      addDoc(collection(fs('admin1', 'admin'), 'labels'), label({ createdBy: 'admin1' })),
    );
  });

  it('refuses a board that does not exist, and a boardId that is not a string', async () => {
    await assertFails(addDoc(collection(fs('member1', 'member'), 'labels'), label({ boardId: 'nope' })));
    await assertFails(addDoc(collection(fs('member1', 'member'), 'labels'), label({ boardId: 7 })));
    await assertSucceeds(addDoc(collection(fs('member1', 'member'), 'labels'), label({ boardId: 'b1' })));
  });

  it('is refused to an account awaiting approval', async () => {
    await assertFails(
      addDoc(collection(fs('member1', 'member', 'pending'), 'labels'), label()),
    );
    await assertSucceeds(
      addDoc(collection(fs('member1', 'member', 'active'), 'labels'), label()),
    );
  });

  it('refuses a forged author', async () => {
    await assertFails(
      addDoc(collection(fs('member1', 'member'), 'labels'), label({ createdBy: 'someone-else' })),
    );
    await assertSucceeds(
      addDoc(collection(fs('member1', 'member'), 'labels'), label({ createdBy: 'member1' })),
    );
  });

  it('refuses a name longer than the cap, which the board array could never check', async () => {
    await assertFails(
      addDoc(
        collection(fs('member1', 'member'), 'labels'),
        label({ name: 'x'.repeat(LABEL_NAME_MAX + 1) }),
      ),
    );
    await assertSucceeds(
      addDoc(
        collection(fs('member1', 'member'), 'labels'),
        label({ name: 'x'.repeat(LABEL_NAME_MAX) }),
      ),
    );
  });

  it('refuses an empty name', async () => {
    await assertFails(
      addDoc(collection(fs('member1', 'member'), 'labels'), label({ name: '' })),
    );
  });

  it('refuses anything that is not a six-digit hex colour', async () => {
    for (const bad of ['red', '#fff', 'rgb(1,2,3)', '#12345g', '']) {
      await assertFails(
        addDoc(collection(fs('member1', 'member'), 'labels'), label({ color: bad })),
      );
    }
    await assertSucceeds(
      addDoc(collection(fs('member1', 'member'), 'labels'), label({ color: '#83114F' })),
    );
  });

  it('refuses a far-future createdAt, and refuses an unknown field', async () => {
    await assertFails(
      addDoc(
        collection(fs('member1', 'member'), 'labels'),
        label({ createdAt: Date.now() + 7 * 24 * 3600 * 1000 }),
      ),
    );
    await assertFails(
      addDoc(collection(fs('member1', 'member'), 'labels'), label({ archived: true })),
    );
    await assertSucceeds(
      addDoc(collection(fs('member1', 'member'), 'labels'), label({ createdAt: Date.now() })),
    );
  });

  it('refuses a document missing a required field', async () => {
    const { color: _color, ...noColour } = label();
    await assertFails(addDoc(collection(fs('member1', 'member'), 'labels'), noColour));
    await assertSucceeds(addDoc(collection(fs('member1', 'member'), 'labels'), label()));
  });
});

describe('renaming and recolouring', () => {
  /**
   * Of an INSTITUTE label: admin work, not organizer work and not member work.
   *
   * It is on every board: renaming one changes it on every card on every board,
   * including boards the editor is not on. That is an org-wide effect, so it
   * takes an org-wide authority — and owning a board grants no part of it, which
   * is precisely what a member promoted to run one board must NOT inherit.
   */
  it('of an institute label is admin work, not organizer or member work', async () => {
    await assertFails(
      updateDoc(doc(fs('member1', 'member'), 'labels/existing'), { name: 'Renamed' }),
    );
    await assertFails(
      updateDoc(doc(fs('org1', 'organizer'), 'labels/existing'), { name: 'Renamed' }),
    );
    // Only the role was in the way.
    await assertSucceeds(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { name: 'Renamed' }),
    );
  });

  it('of a board label is anyone on that board, and admins', async () => {
    await assertSucceeds(updateDoc(doc(fs('member1', 'member'), 'labels/own'), { name: 'Hall' }));
    await assertSucceeds(updateDoc(doc(fs('owner1', 'member'), 'labels/own'), { color: LABEL_COLORS[2] }));
    await assertSucceeds(updateDoc(doc(fs('admin1', 'admin'), 'labels/own'), { name: 'Hall booking' }));
  });

  it('of a board label is refused to someone not on that board', async () => {
    await assertFails(updateDoc(doc(fs('other1', 'member'), 'labels/own'), { name: 'Mine now' }));
    await assertSucceeds(updateDoc(doc(fs('member1', 'member'), 'labels/own'), { name: 'Still theirs' }));
  });

  it('never moves a label between scopes, an admin included', async () => {
    // Into another board, out to the institute, and in from it: each would put
    // the label where a different set of people may change it.
    await assertFails(updateDoc(doc(fs('member1', 'member'), 'labels/own'), { boardId: 'b2' }));
    await assertFails(updateDoc(doc(fs('admin1', 'admin'), 'labels/own'), { boardId: 'b2' }));
    await assertFails(updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { boardId: 'b1' }));
    await assertFails(updateDoc(doc(fs('member1', 'member'), 'labels/existing'), { boardId: 'b1' }));
    // The same writers changing what they may.
    await assertSucceeds(updateDoc(doc(fs('member1', 'member'), 'labels/own'), { name: 'Venue 2' }));
    await assertSucceeds(updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { name: 'Blocked 2' }));
  });

  it('lets an admin recolour', async () => {
    await assertSucceeds(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { color: LABEL_COLORS[2] }),
    );
  });

  it('will not let an admin rewrite the label’s history', async () => {
    await assertFails(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { createdBy: 'admin1' }),
    );
    await assertFails(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { createdAt: 99999 }),
    );
    await assertSucceeds(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { name: 'Still fine' }),
    );
  });

  it('will not let an admin smuggle in a new field or a bad colour', async () => {
    await assertFails(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { archived: true }),
    );
    await assertFails(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/existing'), { color: 'goldenrod' }),
    );
  });

  it('still edits a label written before createdBy existed', async () => {
    // The `.get(field, default)` guard on both sides. With plain field access a
    // label from the migration — which has no author to name — would be
    // permanently uneditable, which is worse than the drift being prevented.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'labels/legacy'), { name: 'Old', color: '#83114F' });
    });
    await assertSucceeds(
      updateDoc(doc(fs('admin1', 'admin'), 'labels/legacy'), { name: 'Old renamed' }),
    );
  });
});

describe('deleting a label', () => {
  it('is refused to everyone, including an admin', async () => {
    // Not an oversight: deleting must also strip the id from every card that
    // carries it, and no client write can do that completely or record who did
    // it. The deleteLabel callable owns this. Same shape as attachments.
    await assertFails(deleteDoc(doc(fs('member1', 'member'), 'labels/own')));
    await assertFails(deleteDoc(doc(fs('member1', 'member'), 'labels/existing')));
    await assertFails(deleteDoc(doc(fs('org1', 'organizer'), 'labels/existing')));
    await assertFails(deleteDoc(doc(fs('admin1', 'admin'), 'labels/existing')));
  });
});

describe('the board document', () => {
  it('no longer accepts a labels field', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'boards/b1'), {
        name: 'Ops',
        description: '',
        archived: false,
        columns: [{ id: 'c1', name: 'To Do' }],
        columnIds: ['c1'],
        memberUids: ['owner1'],
        boardOwnerUids: ['owner1'],
        memberProfiles: {},
        activeCardCount: 0,
        createdAt: 1,
        createdBy: 'owner1',
      });
    });
    const board = doc(fs('owner1', 'member'), 'boards/b1');
    const stamp = (at: number) => ({ updatedBy: 'owner1', updatedAt: at });
    await assertFails(
      updateDoc(board, { ...stamp(2), labels: [{ id: 'l1', name: 'X', color: '#83114F' }] }),
    );
    // The same write without the stale field goes through, so it is the field
    // being refused and not the update.
    await assertSucceeds(updateDoc(board, { ...stamp(3), name: 'Ops renamed' }));
  });
});

describe('the rules and the shared constant agree', () => {
  it('caps the name at the same number in both places', () => {
    // The cap is a literal in firestore.rules because rules cannot import — so
    // read it back out and compare, rather than letting the two drift silently.
    // Same trick device-shots.mjs uses for WIDE_BREAKPOINT.
    const rules = readFileSync('../firestore.rules', 'utf8');
    const from = rules.indexOf('match /labels/{labelId}');
    expect(from).toBeGreaterThan(-1);
    // Bounded at the NEXT match block, or the whole tail of the file comes with
    // it — including the 255-cap on attachment names, which is what this
    // assertion first tripped over.
    const to = rules.indexOf('match /', from + 'match /labels/{labelId}'.length);
    const block = rules.slice(from, to === -1 ? undefined : to);
    expect(block).toContain('allow create');

    const caps = [...block.matchAll(/name\.size\(\)\s*<=\s*(\d+)/g)].map((m) => Number(m[1]));
    // One on create, one on update — both must be the shared constant.
    expect(caps).toEqual([LABEL_NAME_MAX, LABEL_NAME_MAX]);
  });
});
