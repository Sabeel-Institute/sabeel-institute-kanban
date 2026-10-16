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
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { PASSWORD_SIGN_IN_EMAIL, RULES_VERSION } from '@sabeel/shared';
import { firestoreHostPort } from './emulatorHosts';

let env: RulesTestEnvironment;

const ROLES = ['member', 'organizer', 'admin'] as const;
const STATUSES = ['pending', 'active', 'rejected', 'disabled'] as const;

function ctx(uid: string, role: string, status: string) {
  return env
    .authenticatedContext(uid, {
      email: `${uid}@oursabeel.com`,
      email_verified: true,
      role,
      status,
    })
    .firestore();
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-sabeel-kanban',
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
    // A representative population: one of each role, plus someone waiting.
    await setDoc(doc(db, 'users/admin1'), {
      displayName: 'Admin One',
      email: 'admin1@oursabeel.com',
      role: 'admin',
      status: 'active',
    });
    await setDoc(doc(db, 'users/org1'), {
      displayName: 'Organizer One',
      email: 'org1@oursabeel.com',
      role: 'organizer',
      status: 'active',
    });
    await setDoc(doc(db, 'users/member1'), {
      displayName: 'Member One',
      email: 'member1@oursabeel.com',
      role: 'member',
      status: 'active',
    });
    await setDoc(doc(db, 'users/pending1'), {
      displayName: 'Pending One',
      email: 'pending1@oursabeel.com',
      role: 'member',
      status: 'pending',
    });
  });
});

describe('deny-by-default floor', () => {
  it('blocks unauthenticated reads and writes anywhere', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'boards/anything')));
    await assertFails(setDoc(doc(db, 'boards/anything'), { name: 'nope' }));
    await assertFails(getDoc(doc(db, 'users/admin1')));
  });

  it('blocks even an active admin from collections no phase has opened yet', async () => {
    // Guards paths that no phase will ever open, so this test does not need
    // rewriting every time a collection is legitimately added. The point is the
    // catch-all `match /{document=**}` still denies by default: anything not
    // deliberately granted stays shut, including for admins.
    const db = ctx('admin1', 'admin', 'active');
    await assertFails(getDoc(doc(db, 'randomCollection/anything')));
    await assertFails(setDoc(doc(db, 'randomCollection/anything'), { x: 1 }));
    await assertFails(getDoc(doc(db, 'boards/b/cards/c1/madeUpSubcollection/x')));
    await assertFails(
      setDoc(doc(db, 'boards/b/cards/c1/madeUpSubcollection/x'), { x: 1 }),
    );
    await assertFails(getDoc(doc(db, 'boards/b/secrets/x')));
  });
});

describe('reading your own user doc', () => {
  it('is allowed for every role x status combination', async () => {
    // Load-bearing for the gate screens: a pending, rejected or disabled user
    // must still be able to read their OWN status, or they would see a blank
    // screen with no explanation of why they cannot get in.
    for (const role of ROLES) {
      for (const status of STATUSES) {
        const uid = `self_${role}_${status}`;
        await env.withSecurityRulesDisabled(async (c) => {
          await setDoc(doc(c.firestore(), `users/${uid}`), { role, status });
        });
        await assertSucceeds(getDoc(doc(ctx(uid, role, status), `users/${uid}`)));
      }
    }
  });
});

describe('reading OTHER user docs', () => {
  it('is allowed only for active admins', async () => {
    for (const role of ROLES) {
      for (const status of STATUSES) {
        const db = ctx(`peeker_${role}_${status}`, role, status);
        const read = getDoc(doc(db, 'users/member1'));
        if (role === 'admin' && status === 'active') {
          await assertSucceeds(read);
        } else {
          await assertFails(read);
        }
      }
    }
  });

  it('lets an active admin list the approval queue', async () => {
    await assertSucceeds(getDocs(collection(ctx('admin1', 'admin', 'active'), 'users')));
  });

  it('refuses the user list to organizers and members', async () => {
    await assertFails(getDocs(collection(ctx('org1', 'organizer', 'active'), 'users')));
    await assertFails(getDocs(collection(ctx('member1', 'member', 'active'), 'users')));
  });

  /*
   * THE PASSWORD DOOR (Faisal, 2026-10-15): one address, and that one a member.
   * Each test isolates one lock: the member lock on the one address, the
   * address lock on any other. The controls are the same claims through Google.
   */
  const session = (uid: string, email: string, role: string, sign_in_provider: 'password' | 'google.com') =>
    env
      .authenticatedContext(uid, { email, email_verified: true, role, status: 'active', firebase: { sign_in_provider } })
      .firestore();

  it('refuses the user list to the one password address holding admin claims; through Google they may', async () => {
    await assertFails(getDocs(collection(session('admin1', PASSWORD_SIGN_IN_EMAIL, 'admin', 'password'), 'users')));
    await assertSucceeds(getDocs(collection(session('admin1', PASSWORD_SIGN_IN_EMAIL, 'admin', 'google.com'), 'users')));
  });

  it('gives a password session for any other address nothing, not even its own document', async () => {
    const other = session('member1', 'member1@oursabeel.com', 'member', 'password');
    await assertFails(getDoc(doc(other, 'users/member1')));
    await assertFails(setDoc(doc(other, 'users/member1/pushTokens/t-other'), { platform: 'web', updatedAt: 1 }));
    const viaGoogle = session('member1', 'member1@oursabeel.com', 'member', 'google.com');
    await assertSucceeds(getDoc(doc(viaGoogle, 'users/member1')));
    await assertSucceeds(setDoc(doc(viaGoogle, 'users/member1/pushTokens/t-other'), { platform: 'web', updatedAt: 1 }));
    // And the one address, as a member, reads its own document.
    await assertSucceeds(getDoc(doc(session('member1', PASSWORD_SIGN_IN_EMAIL, 'member', 'password'), 'users/member1')));
  });

  it('refuses the user list to an admin who is not active', async () => {
    // Disabling an admin must actually disable them.
    for (const status of STATUSES.filter((s) => s !== 'active')) {
      await assertFails(getDocs(collection(ctx('admin1', 'admin', status), 'users')));
    }
  });
});

describe('writes to user docs are impossible from any client', () => {
  it('blocks self-escalation of role', async () => {
    // The attack this whole design exists to prevent.
    const db = ctx('member1', 'member', 'active');
    await assertFails(updateDoc(doc(db, 'users/member1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users/member1'), { role: 'organizer' }));
    // A real status change is blocked too. (Writing a field to the value it
    // ALREADY has is a no-op: `diff().affectedKeys()` reports only keys whose
    // values differ, so such a write changes nothing and is harmless. The rule
    // constrains state transitions, not the shape of the request.)
    await assertFails(updateDoc(doc(db, 'users/member1'), { status: 'disabled' }));
  });

  it('blocks a pending user activating themselves', async () => {
    const db = ctx('pending1', 'member', 'pending');
    await assertFails(updateDoc(doc(db, 'users/pending1'), { status: 'active' }));
  });

  it('blocks an organizer promoting someone', async () => {
    const db = ctx('org1', 'organizer', 'active');
    await assertFails(updateDoc(doc(db, 'users/member1'), { role: 'organizer' }));
  });

  it('blocks an ADMIN writing user docs directly — it must go through the callable', async () => {
    // Admins are authorised to change access, but not by writing Firestore.
    // Claims and the mirror would drift apart, and claims are what rules trust.
    const db = ctx('admin1', 'admin', 'active');
    await assertFails(updateDoc(doc(db, 'users/member1'), { role: 'organizer' }));
    await assertFails(setDoc(doc(db, 'users/newperson'), { role: 'member' }));
    await assertFails(deleteDoc(doc(db, 'users/member1')));
  });

  it('blocks writing profile fields that are not preferences', async () => {
    // displayName and email come from Google; letting people edit them would let
    // someone impersonate a colleague in an admin's approval queue.
    const db = ctx('member1', 'member', 'active');
    await assertFails(updateDoc(doc(db, 'users/member1'), { displayName: 'Renamed' }));
    await assertFails(updateDoc(doc(db, 'users/member1'), { email: 'x@oursabeel.com' }));
  });

  it('blocks tampering with the server audit trail', async () => {
    const db = ctx('member1', 'member', 'active');
    await assertFails(updateDoc(doc(db, 'users/member1'), { accessChangedBy: 'me' }));
  });

  it('blocks recording acceptance of the institute rules — only the acceptRules callable may', async () => {
    // The rules screen stands in front of every board until these two are set,
    // so a client that could write them would skip the screen and be recorded
    // as agreeing to text it never saw.
    const db = ctx('member1', 'member', 'active');
    await assertFails(updateDoc(doc(db, 'users/member1'), { rulesVersion: RULES_VERSION }));
    await assertFails(updateDoc(doc(db, 'users/member1'), { rulesAcceptedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(doc(db, 'users/member1'), {
        favoriteBoardIds: ['b1'],
        rulesVersion: RULES_VERSION,
        rulesAcceptedAt: serverTimestamp(),
      }),
    );
    // An admin is no different: acceptance is the person's own act.
    await assertFails(updateDoc(doc(ctx('admin1', 'admin', 'active'), 'users/admin1'), { rulesVersion: RULES_VERSION }));
    // The same person's preference write lands, so the refusals above are about
    // the two fields and not about writing at all.
    await assertSucceeds(updateDoc(doc(db, 'users/member1'), { favoriteBoardIds: ['b1'] }));
  });

  it('blocks smuggling role alongside a legitimate preference change', async () => {
    // hasOnly() is what makes this fail — a whitelist that checked only "may
    // write favourites" would let this through.
    const db = ctx('member1', 'member', 'active');
    await assertFails(
      updateDoc(doc(db, 'users/member1'), {
        favoriteBoardIds: ['b1'],
        role: 'admin',
      }),
    );
  });

  it('blocks editing someone ELSE preferences', async () => {
    const db = ctx('member1', 'member', 'active');
    await assertFails(updateDoc(doc(db, 'users/org1'), { favoriteBoardIds: ['b1'] }));
  });

  it('blocks creating a user doc for someone who never signed up', async () => {
    const db = ctx('member1', 'member', 'active');
    await assertFails(setDoc(doc(db, 'users/ghost'), { role: 'admin', status: 'active' }));
  });
});

describe('preference self-writes', () => {
  it('an active user may set their own favourites and recents', async () => {
    const db = ctx('member1', 'member', 'active');
    await assertSucceeds(
      updateDoc(doc(db, 'users/member1'), {
        favoriteBoardIds: ['b1'],
        recentBoardIds: ['b1', 'b2'],
      }),
    );
  });

  it('an active user may set notification preferences', async () => {
    const db = ctx('member1', 'member', 'active');
    await assertSucceeds(
      updateDoc(doc(db, 'users/member1'), {
        notifyPrefs: { mention: false },
        mutedBoardIds: ['b1'],
      }),
    );
  });

  it('an active user may NOT write a pushTokens field on their user doc', async () => {
    // Device tokens live in a subcollection, one document per device. The old
    // array field is gone; allowing it back would let a client hold tokens the
    // send path no longer reads, which is silent breakage rather than an error.
    const db = ctx('member1', 'member', 'active');
    await assertFails(updateDoc(doc(db, 'users/member1'), { pushTokens: ['tok'] }));
  });
});

describe('push tokens', () => {
  it('you may register, read back, and remove a token on your own doc', async () => {
    const db = ctx('member1', 'member', 'active');
    const tok = doc(db, 'users/member1/pushTokens/token-abc');
    await assertSucceeds(setDoc(tok, { platform: 'android', updatedAt: 1 }));
    await assertSucceeds(getDoc(tok));
    await assertSucceeds(deleteDoc(tok));
  });

  it('a PENDING user may register a token', async () => {
    // Registration happens at sign-in, before an admin approves the account.
    // Holding a token grants nothing: the send path checks status separately.
    const db = ctx('pending1', 'member', 'pending');
    await assertSucceeds(
      setDoc(doc(db, 'users/pending1/pushTokens/token-p'), { platform: 'android' }),
    );
  });

  it('nobody may write a token onto SOMEONE ELSE (an admin included)', async () => {
    // A token is a capability to notify a specific device. Writing one to
    // another user's collection would redirect their notifications.
    await assertFails(
      setDoc(doc(ctx('member1', 'member', 'active'), 'users/admin1/pushTokens/t'), {
        platform: 'android',
      }),
    );
    await assertFails(
      setDoc(doc(ctx('admin1', 'admin', 'active'), 'users/member1/pushTokens/t'), {
        platform: 'android',
      }),
    );
  });

  it('an iPhone registers with the Apple service that issued its token', async () => {
    const db = ctx('member1', 'member', 'active');
    for (const apnsEnvironment of ['development', 'production']) {
      await assertSucceeds(
        setDoc(doc(db, `users/member1/pushTokens/${apnsEnvironment}-tok`), {
          platform: 'ios',
          apnsEnvironment,
          updatedAt: 1,
        }),
      );
    }
  });

  it('admits exactly the two shapes, and nothing a send path would misread', async () => {
    // Each refusal beside the same write made valid, so a refusal cannot pass
    // on a malformed fixture.
    const db = ctx('member1', 'member', 'active');
    const tok = doc(db, 'users/member1/pushTokens/shape');
    const refused: Record<string, unknown>[] = [
      { platform: 'ios', updatedAt: 1 }, // which service?
      { platform: 'ios', apnsEnvironment: 'sandbox', updatedAt: 1 },
      { platform: 'android', apnsEnvironment: 'production', updatedAt: 1 },
      { platform: 'ios-simulator', updatedAt: 1 },
      { platform: 'web', updatedAt: 1, owner: 'someone' },
    ];
    for (const row of refused) await assertFails(setDoc(tok, row));
    await assertSucceeds(setDoc(tok, { platform: 'web', updatedAt: 1 }));
    await assertSucceeds(setDoc(tok, { platform: 'ios', apnsEnvironment: 'production', updatedAt: 1 }));
  });

  it("an iPhone's old 'android' row is replaced in place, not left beside the new one", async () => {
    // Every build up to v0.11.5 build 11 filed Apple's token as 'android'. The
    // token is the document id, so the current build re-registering the same
    // device writes the same document: one row, now in the iPhone's shape.
    const db = ctx('member1', 'member', 'active');
    const apple = 'ab'.repeat(32);
    await assertSucceeds(setDoc(doc(db, `users/member1/pushTokens/${apple}`), { platform: 'android', updatedAt: 1 }));
    await assertSucceeds(
      setDoc(doc(db, `users/member1/pushTokens/${apple}`), {
        platform: 'ios',
        apnsEnvironment: 'production',
        updatedAt: 2,
      }),
    );
    const rows = await getDocs(collection(db, 'users/member1/pushTokens'));
    expect(rows.docs.map((d) => [d.id, d.data()])).toEqual([
      [apple, { platform: 'ios', apnsEnvironment: 'production', updatedAt: 2 }],
    ]);
  });

  it("nobody may READ someone else's tokens", async () => {
    // Which devices a person carries is not admin business.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'users/member1/pushTokens/t'), { platform: 'android' });
    });
    await assertFails(getDoc(doc(ctx('admin1', 'admin', 'active'), 'users/member1/pushTokens/t')));
    await assertFails(getDocs(collection(ctx('org1', 'organizer', 'active'), 'users/member1/pushTokens')));
  });

  it('a PENDING user may not write preferences', async () => {
    // Nothing at all before approval.
    const db = ctx('pending1', 'member', 'pending');
    await assertFails(updateDoc(doc(db, 'users/pending1'), { favoriteBoardIds: ['b1'] }));
  });
});

describe('the notification inbox', () => {
  async function seedNotif(uid: string, id: string, read: boolean) {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `users/${uid}/notifications/${id}`), {
        type: 'mention',
        boardId: 'b1',
        actorUid: 'admin1',
        text: 'Someone mentioned you',
        read,
        at: 1,
      });
    });
  }

  // Dismissing is two writes: delete the entry, and — if it was still unread —
  // decrement the badge. Nothing on the server watches for a DELETED
  // notification (the trigger only increments on create), so if rules refused
  // the second write the badge would count entries that no longer exist. This
  // pins that both halves are permitted from a client.
  it('you may delete your own entry AND decrement your own badge', async () => {
    await seedNotif('member1', 'n1', false);
    const db = ctx('member1', 'member', 'active');
    await assertSucceeds(deleteDoc(doc(db, 'users/member1/notifications/n1')));
    await assertSucceeds(updateDoc(doc(db, 'users/member1'), { unreadNotifCount: 0 }));
  });

  it('you may mark an entry read, but not rewrite what it says', async () => {
    await seedNotif('member1', 'n1', false);
    const db = ctx('member1', 'member', 'active');
    await assertSucceeds(updateDoc(doc(db, 'users/member1/notifications/n1'), { read: true }));
    // Editing the text would let someone forge what they were told.
    await assertFails(updateDoc(doc(db, 'users/member1/notifications/n1'), { text: 'nope' }));
  });

  // Marking something UNREAD again is the same write in the other direction, and
  // the rule is phrased on the affected KEYS rather than the value — so this
  // already passes. Pinned because it is now a feature people use: a
  // value-shaped rule ("read may only become true") would break it, and nothing
  // else would notice until someone tapped the icon.
  it('you may put an entry back to unread, and adjust your own badge for it', async () => {
    await seedNotif('member1', 'n1', true);
    const db = ctx('member1', 'member', 'active');
    await assertSucceeds(
      updateDoc(doc(db, 'users/member1/notifications/n1'), { read: false }),
    );
    await assertSucceeds(updateDoc(doc(db, 'users/member1'), { unreadNotifCount: 1 }));
  });

  // `hasOnly(['read'])` means a timestamp smuggled alongside the flag is
  // refused. Worth pinning: a `readAt` is the obvious next thing to reach for,
  // and it would fail as a bare permission-denied with nothing pointing at the
  // extra field.
  it('may not smuggle another field in beside `read`', async () => {
    await seedNotif('member1', 'n1', false);
    const db = ctx('member1', 'member', 'active');
    await assertFails(
      updateDoc(doc(db, 'users/member1/notifications/n1'), {
        read: true,
        readAt: 123,
      }),
    );
  });

  it("nobody may read or clear SOMEONE ELSE's inbox, an admin included", async () => {
    await seedNotif('member1', 'n1', false);
    for (const [uid, role] of [
      ['org1', 'organizer'],
      ['admin1', 'admin'],
    ] as const) {
      const db = ctx(uid, role, 'active');
      await assertFails(getDoc(doc(db, 'users/member1/notifications/n1')));
      await assertFails(deleteDoc(doc(db, 'users/member1/notifications/n1')));
    }
  });
});

describe('operator state (meta/*)', () => {
  // The healthCheck canary stores its baseline at `meta/health`. It is operator
  // state, not app data, and is reachable only by the Admin SDK (which bypasses
  // rules). Nothing in firestore.rules matches `meta/**`, so the catch-all
  // `match /{document=**} { allow read, write: if false; }` is what denies it —
  // this pins that the catch-all really is in force, rather than assuming it.
  it('no client may read or write the health baseline, at any role', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'meta/health'), { counts: { cards: 1 } });
    });
    for (const role of ['member', 'organizer', 'admin']) {
      const db = ctx(`${role}1`, role, 'active');
      await assertFails(getDoc(doc(db, 'meta/health')));
      await assertFails(setDoc(doc(db, 'meta/health'), { counts: { cards: 0 } }));
    }
  });
});

describe('reports', () => {
  // Report a problem stores every report at `reports/{id}`, written by the
  // reportProblem callable through the Admin SDK and read by nobody in the
  // app. A client that could read one would see who reported whom; one that
  // could write one would file reports in somebody else's name, or past the
  // hourly limit the callable counts from these documents.
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'reports/r1'), {
        app: 'Sabeel Kanban',
        uid: 'member1',
        displayName: 'Member One',
        email: 'member1@oursabeel.com',
        role: 'member',
        text: 'Something on the board is wrong.',
        createdAt: 1,
        mail: { status: 'sent', messageId: 'm1' },
      });
    });
  });

  const report = {
    app: 'Sabeel Kanban',
    uid: 'member1',
    displayName: 'Member One',
    email: 'member1@oursabeel.com',
    role: 'member',
    text: 'Filed from a client.',
    createdAt: 1,
  };

  it('no active account, at any role, may read, list, create, update or delete one', async () => {
    for (const role of ROLES) {
      const uid = { member: 'member1', organizer: 'org1', admin: 'admin1' }[role];
      const db = ctx(uid, role, 'active');
      await assertFails(getDoc(doc(db, 'reports/r1')));
      await assertFails(getDocs(collection(db, 'reports')));
      await assertFails(setDoc(doc(db, 'reports/mine'), report));
      await assertFails(updateDoc(doc(db, 'reports/r1'), { mail: { status: 'sent' } }));
      await assertFails(deleteDoc(doc(db, 'reports/r1')));
    }
  });

  it('not even the reporter may read their own report back, or query for it', async () => {
    const db = ctx('member1', 'member', 'active');
    await assertFails(getDoc(doc(db, 'reports/r1')));
    await assertFails(getDocs(query(collection(db, 'reports'), where('uid', '==', 'member1'))));
  });

  it('the review account through the password door gets nothing either', async () => {
    const db = env
      .authenticatedContext('reviewer', {
        email: PASSWORD_SIGN_IN_EMAIL,
        email_verified: true,
        role: 'member',
        status: 'active',
        firebase: { sign_in_provider: 'password' },
      })
      .firestore();
    await assertFails(getDoc(doc(db, 'reports/r1')));
    await assertFails(setDoc(doc(db, 'reports/reviewer'), { ...report, uid: 'reviewer' }));
  });

  it('a signed-out client gets nothing', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'reports/r1')));
    await assertFails(setDoc(doc(db, 'reports/anon'), report));
  });
});

describe('test harness', () => {
  it('can bypass rules via withSecurityRulesDisabled', async () => {
    // If this failed, every assertFails above would be vacuously true.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'boards/seeded'), { name: 'ok' });
      expect((await getDoc(doc(c.firestore(), 'boards/seeded'))).exists()).toBe(true);
    });
  });
});
