import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_NAME_MAX,
  EMULATOR_PROJECT_ID,
  attachmentStoragePath,
} from '@sabeel/shared';
import { firestoreHostPort, storageHostPort } from './emulatorHosts';

/**
 * Rules for card attachments — the Firestore documents AND the Storage objects.
 *
 * These are the first Storage rules in this project, so this file also
 * establishes that the Storage half of the rules harness runs at all.
 *
 * `assertFails` passes when an operation fails for ANY reason, including a
 * broken connection, so a suite this full of denials can pass while proving
 * nothing. Both rule files were mutation-tested against it (flipped to
 * `if true`, every denial went red, restored) — redo that if you change either.
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
const st = (uid: string, role: string, status = 'active') => ctx(uid, role, status).storage();

const attachment = (over: Record<string, unknown> = {}) => ({
  name: 'budget.pdf',
  contentType: 'application/pdf',
  uploadedBy: 'member1',
  uploadedAt: 1,
  status: 'uploading',
  ...over,
});

const CARD = 'card1';
const OTHER_CARD = 'card2';
const attachments = (cardId: string) => `cards/${cardId}/attachments`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
      ...firestoreHostPort(),
    },
    storage: {
      rules: readFileSync('../storage.rules', 'utf8'),
      ...storageHostPort(),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    const board = (memberUids: string[], colId: string) => ({
      name: 'Ops',
      description: '',
      archived: false,
      columns: [{ id: colId, name: 'To Do' }],
      columnIds: [colId],
      memberUids,
      // The board's first member owns it. Attachment access follows membership,
      // but the surrounding rules now need the field to exist.
      boardOwnerUids: memberUids.slice(0, 1),
      createdAt: 1,
      createdBy: memberUids[0],
    });
    await setDoc(doc(db, 'boards/b1'), board(['member1', 'member2'], 'c1'));
    // A second board member1 is NOT on, to prove the rules resolve the card's
    // OWN boardId rather than assuming one.
    await setDoc(doc(db, 'boards/b2'), board(['outsider'], 'x1'));

    const card = (boardId: string) => ({
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
    await setDoc(doc(db, `cards/${CARD}`), card('b1'));
    await setDoc(doc(db, `cards/${OTHER_CARD}`), card('b2'));
    await setDoc(doc(db, `${attachments(CARD)}/existing`), attachment({ status: 'ready', sizeBytes: 4 }));
    await setDoc(doc(db, `${attachments(OTHER_CARD)}/hidden`), attachment({ uploadedBy: 'outsider' }));
  });
});

describe('reading attachments', () => {
  it('a board member can list and get', async () => {
    await assertSucceeds(getDocs(collection(fs('member1', 'member'), attachments(CARD))));
    await assertSucceeds(getDoc(doc(fs('member1', 'member'), `${attachments(CARD)}/existing`)));
  });

  it('an ORGANIZER cannot read without being a member', async () => {
    // This used to succeed on the strength of the role alone. It is the same
    // boundary `canAccessBoard` enforces for the download callable, and the two
    // must agree — that predicate IS the download authorization, because
    // storage.rules denies reads outright.
    await assertFails(getDocs(collection(fs('org1', 'organizer'), attachments(CARD))));
    await assertSucceeds(getDocs(collection(fs('admin1', 'admin'), attachments(CARD))));
  });

  it('someone on a DIFFERENT board cannot read', async () => {
    await assertFails(getDocs(collection(fs('outsider', 'member'), attachments(CARD))));
  });

  it('a member of THIS board cannot read the other board’s card', async () => {
    await assertFails(getDocs(collection(fs('member1', 'member'), attachments(OTHER_CARD))));
  });

  it('a pending account cannot read', async () => {
    await assertFails(
      getDocs(collection(fs('member1', 'member', 'pending'), attachments(CARD))),
    );
  });
});

describe('creating an attachment record', () => {
  const newRef = (db: ReturnType<typeof fs>, id = 'fresh') =>
    doc(db, `${attachments(CARD)}/${id}`);

  it('a board member can create one in the uploading state', async () => {
    await assertSucceeds(setDoc(newRef(fs('member1', 'member')), attachment()));
  });

  it('refuses a record that claims to be ready — only the server says that', async () => {
    await assertFails(
      setDoc(newRef(fs('member1', 'member')), attachment({ status: 'ready' })),
    );
  });

  it('refuses a forged uploader', async () => {
    await assertFails(
      setDoc(newRef(fs('member1', 'member')), attachment({ uploadedBy: 'member2' })),
    );
  });

  it('refuses a client-claimed sizeBytes — the server reads it off the object', async () => {
    await assertFails(
      setDoc(newRef(fs('member1', 'member')), attachment({ sizeBytes: 10 })),
    );
  });

  it('refuses smuggled extra fields', async () => {
    await assertFails(
      setDoc(newRef(fs('member1', 'member')), attachment({ storagePath: '../elsewhere' })),
    );
  });

  it('refuses an empty or over-long name', async () => {
    for (const name of ['', 'x'.repeat(256)]) {
      await assertFails(setDoc(newRef(fs('member1', 'member')), attachment({ name })));
    }
  });

  it('refuses a timestamp from the future — the sweeper decides by age', async () => {
    // Unbounded, a document claiming to be from the year 3000 is never older
    // than the sweep's cutoff, so it and its bytes stay forever.
    await assertFails(
      setDoc(newRef(fs('member1', 'member')), attachment({ uploadedAt: Date.now() + 90_000_000 })),
    );
    // Ordinary clock skew still works.
    await assertSucceeds(
      setDoc(newRef(fs('member1', 'member'), 'skewed'), attachment({ uploadedAt: Date.now() + 1_800_000 })),
    );
  });

  it('refuses a non-member and a pending account', async () => {
    await assertFails(
      setDoc(newRef(fs('outsider', 'member')), attachment({ uploadedBy: 'outsider' })),
    );
    await assertFails(
      setDoc(newRef(fs('member1', 'member', 'pending')), attachment()),
    );
  });
});

describe('attachments are never edited or deleted by a client', () => {
  const existing = (db: ReturnType<typeof fs>) => doc(db, `${attachments(CARD)}/existing`);

  it('refuses an update from the uploader, the board’s owner and an admin', async () => {
    // member1 is both the uploader and this board's owner, so the middle case is
    // covered twice over; org1 is on no board at all.
    for (const who of [
      fs('member1', 'member'),
      fs('member2', 'member'),
      fs('admin1', 'admin'),
    ]) {
      await assertFails(updateDoc(existing(who), { name: 'renamed.pdf' }));
    }
  });

  it('refuses a delete from the uploader, the board’s owner and an admin', async () => {
    // Removal is real, but it goes through the deleteAttachment callable: a
    // client deleteDoc would strand the bytes and would leave the activity log
    // unable to name who did it.
    for (const who of [
      fs('member1', 'member'),
      fs('member2', 'member'),
      fs('admin1', 'admin'),
    ]) {
      await assertFails(deleteDoc(existing(who)));
    }
  });
});

describe('storage: the attachment object', () => {
  /**
   * A DISTINCT object id per test, deliberately.
   *
   * `env.clearStorage()` returns before the emulator has finished deleting, so a
   * deletion issued in `beforeEach` can land in the MIDDLE of the next test and
   * remove an object that test just uploaded. Sharing one path made the
   * write-once assertion pass a second upload — a failure that pointed straight
   * at the rule, passed in isolation, and only appeared in the full suite.
   * Unique paths remove the dependency on clearStorage having finished; the
   * write-once test still writes twice to one path, so the rule is still
   * genuinely exercised.
   */
  const bytes = (n = 4) => new Uint8Array(n);

  it('an active user can upload once', async () => {
    const path = attachmentStoragePath(CARD, 'obj_once');
    await assertSucceeds(uploadBytes(ref(st('member1', 'member'), path), bytes()));
  });

  it('refuses an upload from a password session for any address but the one; through Google it is fine', async () => {
    // storage.rules can only ask "is this an active account"; a password
    // session for another address is not one (Faisal, 2026-10-15).
    const as = (sign_in_provider: 'password' | 'google.com') =>
      env
        .authenticatedContext('member1', {
          email: 'member1@oursabeel.com',
          email_verified: true,
          role: 'member',
          status: 'active',
          firebase: { sign_in_provider },
        })
        .storage();
    await assertFails(uploadBytes(ref(as('password'), attachmentStoragePath(CARD, 'obj_pw')), bytes()));
    await assertSucceeds(uploadBytes(ref(as('google.com'), attachmentStoragePath(CARD, 'obj_google')), bytes()));
  });

  it('is WRITE-ONCE — a second upload to the same path is refused', async () => {
    // This is also why a retry must mint a NEW attachment id.
    const path = attachmentStoragePath(CARD, 'obj_twice');
    await assertSucceeds(uploadBytes(ref(st('member1', 'member'), path), bytes()));
    await assertFails(uploadBytes(ref(st('member1', 'member'), path), bytes()));
  });

  it('refuses a client DELETE — object removal is the callable’s job', async () => {
    const path = attachmentStoragePath(CARD, 'obj_del');
    await env.withSecurityRulesDisabled(async (c) => {
      await uploadBytes(ref(c.storage(), path), bytes());
    });
    await assertFails(deleteObject(ref(st('member1', 'member'), path)));
    await assertFails(deleteObject(ref(st('admin1', 'admin'), path)));
  });

  it('refuses an upload over the size cap', async () => {
    const path = attachmentStoragePath(CARD, 'obj_big');
    await assertFails(
      uploadBytes(ref(st('member1', 'member'), path), bytes(ATTACHMENT_MAX_BYTES + 1)),
    );
  });

  it('refuses a pending account and an anonymous caller', async () => {
    const path = attachmentStoragePath(CARD, 'obj_inactive');
    await assertFails(
      uploadBytes(ref(st('member1', 'member', 'pending'), path), bytes()),
    );
    await assertFails(
      uploadBytes(ref(env.unauthenticatedContext().storage(), path), bytes()),
    );
  });

  it('denies reads to everyone — downloads are signed URLs only', async () => {
    const path = attachmentStoragePath(CARD, 'obj_read');
    await env.withSecurityRulesDisabled(async (c) => {
      await uploadBytes(ref(c.storage(), path), bytes());
    });
    for (const who of [
      st('member1', 'member'),
      st('org1', 'organizer'),
      st('admin1', 'admin'),
    ]) {
      await assertFails(getDownloadURL(ref(who, path)));
    }
  });

  it('refuses writes anywhere outside the attachments path', async () => {
    await assertFails(uploadBytes(ref(st('member1', 'member'), 'anything/else.pdf'), bytes()));
    await assertFails(
      uploadBytes(ref(st('member1', 'member'), `cards/${CARD}/notes.txt`), bytes()),
    );
  });
});

describe('the caps are stated in two places and must not drift', () => {
  it('the NAME cap matches the number enforced in firestore.rules', () => {
    const rules = readFileSync('../firestore.rules', 'utf8');
    const block = rules.slice(rules.indexOf('---- Attachments ----'));
    const m = block.match(/name\.size\(\)\s*<=\s*(\d+)/);
    expect(m, 'no name cap found in the attachments rules block').toBeTruthy();
    expect(Number(m![1])).toBe(ATTACHMENT_NAME_MAX);
  });

  it('the SIZE cap matches the number enforced in storage.rules', () => {
    const rules = readFileSync('../storage.rules', 'utf8');
    const m = rules.match(/request\.resource\.size\s*<=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(m, 'no size limit found in storage.rules').toBeTruthy();
    expect(Number(m![1]) * 1024 * 1024).toBe(ATTACHMENT_MAX_BYTES);
  });
});
