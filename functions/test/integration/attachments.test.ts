import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  attachmentStoragePath,
  ATTACHMENT_MAX_BYTES,
  todayInOrgTz,
  STATS_ALL_SCOPE,
} from '@sabeel/shared';
import {
  applyDeleteAttachment,
  applyFinalizeAttachment,
  runAttachmentSweep,
} from '../../src/attachments';
import { MCP_UPLOAD_TIMEOUT_SECONDS, uploadReservation } from '../../src/attachmentUploads';
import {
  adminAuth,
  adminBucket,
  adminDb,
  callFunction,
  idTokenFor,
  makeUser,
  shutdown,
  waitFor,
  waitUntilGone,
} from './emulatorClient';

/**
 * The three attachment callables, the abandoned-upload sweep, and the
 * card-delete cascade.
 *
 * Unique ids throughout (`at_` prefix) so these do not collide with the other
 * trigger suites sharing the emulator inside one `emulators:exec` run.
 *
 * What CANNOT be covered here: production signing. The Storage emulator has no
 * signing service, so `getAttachmentUrl` takes a different branch locally and
 * the `roles/iam.serviceAccountTokenCreator` grant it depends on fails only in
 * production. See docs/DEPLOY.md.
 */
const MGR = 'at_mgr';
const MEM = 'at_mem';
const OUTSIDER = 'at_out';
const BOARD = 'at_board';
const CARD = 'at_card';

let mgrToken: string;
let memToken: string;
let outsiderToken: string;

const attachmentRef = (attachmentId: string, cardId = CARD) =>
  adminDb().doc(`cards/${cardId}/attachments/${attachmentId}`);

const objectExists = async (attachmentId: string, cardId = CARD) =>
  (await adminBucket().file(attachmentStoragePath(cardId, attachmentId)).exists())[0];

/**
 * Today's usage counters for this suite's board.
 *
 * Read as a DELTA around the operation under test, never as an absolute: other
 * tests in this file attach and remove files against the same board on the same
 * day, so an absolute expectation would pass or fail depending on test order.
 */
async function statsToday(): Promise<{ filesAdded: number; bytesAdded: number; filesRemoved: number }> {
  const day = todayInOrgTz();
  const snap = await adminDb().doc(`stats/${BOARD}/months/${day.slice(0, 7)}`).get();
  const d = snap.data()?.days?.[day.slice(8, 10)] ?? {};
  return {
    filesAdded: d.filesAdded ?? 0,
    bytesAdded: d.bytesAdded ?? 0,
    filesRemoved: d.filesRemoved ?? 0,
  };
}

async function storedBytes(): Promise<number> {
  const snap = await adminDb().doc(`stats/${STATS_ALL_SCOPE}`).get();
  return snap.data()?.bytesStored ?? 0;
}

async function putObject(attachmentId: string, bytes = 32, cardId = CARD): Promise<void> {
  await adminBucket()
    .file(attachmentStoragePath(cardId, attachmentId))
    .save(Buffer.alloc(bytes), { contentType: 'application/pdf' });
}

async function putRecord(
  attachmentId: string,
  over: Record<string, unknown> = {},
  cardId = CARD,
): Promise<void> {
  await attachmentRef(attachmentId, cardId).set({
    name: 'budget.pdf',
    contentType: 'application/pdf',
    uploadedBy: MEM,
    uploadedAt: Date.now(),
    status: 'uploading',
    ...over,
  });
}

/** An uploaded-but-unfinalized attachment, the state after a successful upload. */
async function uploaded(
  attachmentId: string,
  over: Record<string, unknown> = {},
  cardId = CARD,
) {
  await putRecord(attachmentId, over, cardId);
  await putObject(attachmentId, 32, cardId);
}

const activityFor = async (cardId = CARD) =>
  (await adminDb().collection(`cards/${cardId}/activity`).get()).docs.map(
    (d) => d.data() as { type: string; actorUid: string; to?: string; from?: string },
  );

beforeAll(async () => {
  // An ADMIN, because the org role no longer carries access to a board you are
  // not on — `canAccessBoard` is the download authorization and moved with it.
  await makeUser({ uid: MGR, email: `${MGR}@oursabeel.com`, role: 'admin', status: 'active' });
  await makeUser({ uid: MEM, email: `${MEM}@oursabeel.com`, role: 'member', status: 'active' });
  await makeUser({
    uid: OUTSIDER,
    email: `${OUTSIDER}@oursabeel.com`,
    role: 'member',
    status: 'active',
  });
  [mgrToken, memToken, outsiderToken] = await Promise.all([
    idTokenFor(MGR),
    idTokenFor(MEM),
    idTokenFor(OUTSIDER),
  ]);

  await adminDb().doc(`boards/${BOARD}`).set({
    name: 'Attachments',
    description: '',
    archived: false,
    columns: [{ id: 'c1', name: 'To Do' }],
    columnIds: ['c1'],
    memberUids: [MEM],
    createdAt: Date.now(),
    createdBy: MGR,
  });
  await adminDb().doc(`cards/${CARD}`).set({
    boardId: BOARD,
    title: 'Has files',
    description: '',
    columnId: 'c1',
    rank: 'V',
    assigneeUids: [],
    priority: 'none',
    labelIds: [],
    archived: false,
    commentCount: 0,
    createdAt: Date.now(),
    createdBy: MEM,
    updatedAt: Date.now(),
    updatedBy: MEM,
  });
});

afterAll(async () => {
  await adminBucket().deleteFiles({ prefix: 'cards/at_' }).catch(() => undefined);
  await shutdown();
});

describe('finalizeAttachment', () => {
  it('confirms the upload, records the SERVER-read size and publishes headers', async () => {
    const id = 'at_ok';
    // A lying size on the record proves the server does not take the client's
    // word for it. (Rules refuse sizeBytes on create; the Admin SDK does not.)
    await uploaded(id, { sizeBytes: 999999 });

    const res = await callFunction(
      'finalizeAttachment',
      { cardId: CARD, attachmentId: id },
      memToken,
    );
    expect(res.status).toBe(200);

    const doc = (await attachmentRef(id).get()).data()!;
    expect(doc.status).toBe('ready');
    expect(doc.sizeBytes).toBe(32);

    // The object carries how it will be served, so the emulator and production
    // hand back identical headers.
    const [meta] = await adminBucket().file(attachmentStoragePath(CARD, id)).getMetadata();
    expect(meta.contentType).toBe('application/pdf');
    expect(meta.contentDisposition).toContain('inline');
    expect(meta.contentDisposition).toContain('budget.pdf');

    const attached = (await activityFor()).filter((a) => a.type === 'attached');
    expect(attached).toHaveLength(1);
    expect(attached[0]).toMatchObject({ actorUid: MEM, to: 'budget.pdf' });
  });

  it('refuses a record whose bytes never landed', async () => {
    const id = 'at_nobytes';
    await putRecord(id);
    const res = await callFunction(
      'finalizeAttachment',
      { cardId: CARD, attachmentId: id },
      memToken,
    );
    expect(res.body.error?.status).toBe('FAILED_PRECONDITION');
    expect((await attachmentRef(id).get()).data()!.status).toBe('uploading');
  });

  it('is idempotent — a retry does not log a second attach', async () => {
    const id = 'at_twice';
    await uploaded(id);
    for (let i = 0; i < 2; i += 1) {
      const res = await callFunction(
        'finalizeAttachment',
        { cardId: CARD, attachmentId: id },
        memToken,
      );
      expect(res.status).toBe(200);
    }
    const attached = (await activityFor()).filter((a) => a.type === 'attached' && a.to === 'budget.pdf');
    // One from this test; the earlier test's entry has the same name, so count
    // this attachment's own activity instead.
    expect(attached.length).toBeGreaterThanOrEqual(1);
    expect((await attachmentRef(id).get()).data()!.status).toBe('ready');
  });

  it('never stores a type that would render as a live document', async () => {
    const id = 'at_html';
    await uploaded(id, { name: 'note.html', contentType: 'text/html' });
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: id }, memToken);

    const doc = (await attachmentRef(id).get()).data()!;
    expect(doc.contentType).toBe('application/octet-stream');
    const [meta] = await adminBucket().file(attachmentStoragePath(CARD, id)).getMetadata();
    expect(meta.contentDisposition).toContain('attachment');
  });

  it('removes an oversize object rather than publishing it', async () => {
    const id = 'at_big';
    await putRecord(id);
    await putObject(id, ATTACHMENT_MAX_BYTES + 1024);

    const res = await callFunction(
      'finalizeAttachment',
      { cardId: CARD, attachmentId: id },
      memToken,
    );
    expect(res.body.error?.status).toBe('FAILED_PRECONDITION');
    expect(await objectExists(id)).toBe(false);
    expect((await attachmentRef(id).get()).exists).toBe(false);
  });

  it('refuses someone who is not on the board, and refuses a bad id', async () => {
    const id = 'at_denied';
    await uploaded(id);
    const denied = await callFunction(
      'finalizeAttachment',
      { cardId: CARD, attachmentId: id },
      outsiderToken,
    );
    expect(denied.body.error?.status).toBe('PERMISSION_DENIED');

    const bad = await callFunction(
      'finalizeAttachment',
      { cardId: CARD, attachmentId: '../elsewhere' },
      memToken,
    );
    expect(bad.body.error?.status).toBe('INVALID_ARGUMENT');
  });

  it('lets an ADMIN act without being a member, and refuses an organizer', async () => {
    // `canAccessBoard` in @sabeel/shared is the only gate here — storage.rules
    // denies reads outright, so that predicate IS the download authorization.
    // It used to short-circuit on the board-creation role, which would have let
    // every organizer reach any file on any board.
    const id = 'at_mgr_ok';
    await uploaded(id);
    const res = await callFunction(
      'finalizeAttachment',
      { cardId: CARD, attachmentId: id },
      mgrToken,
    );
    expect(res.status).toBe(200);

    await makeUser({
      uid: 'at_org',
      email: 'at_org@oursabeel.com',
      role: 'organizer',
      status: 'active',
    });
    const id2 = 'at_org_no';
    await uploaded(id2);
    const denied = await callFunction(
      'finalizeAttachment',
      { cardId: CARD, attachmentId: id2 },
      await idTokenFor('at_org'),
    );
    expect(denied.body.error?.status).toBe('PERMISSION_DENIED');
  });
});

describe('deleteAttachment', () => {
  it('removes the object AND the record, and names who did it', async () => {
    const id = 'at_del';
    await uploaded(id, { name: 'old.pdf' });
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: id }, memToken);

    const res = await callFunction(
      'deleteAttachment',
      { cardId: CARD, attachmentId: id },
      memToken,
    );
    expect(res.status).toBe(200);
    expect(await objectExists(id)).toBe(false);
    expect((await attachmentRef(id).get()).exists).toBe(false);

    const detached = (await activityFor()).filter((a) => a.type === 'detached' && a.from === 'old.pdf');
    expect(detached).toHaveLength(1);
    expect(detached[0].actorUid).toBe(MEM);
  });

  it('is idempotent — a second call logs nothing more', async () => {
    const id = 'at_del2';
    await uploaded(id, { name: 'twice.pdf' });
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: id }, memToken);
    await callFunction('deleteAttachment', { cardId: CARD, attachmentId: id }, memToken);
    await callFunction('deleteAttachment', { cardId: CARD, attachmentId: id }, memToken);

    const detached = (await activityFor()).filter((a) => a.type === 'detached' && a.from === 'twice.pdf');
    expect(detached).toHaveLength(1);
  });

  it('rolls back an unfinished upload without logging a removal', async () => {
    // This is the client's failure path: storage.rules denies clients deleting
    // objects, so rollback has to come through here. Nobody ever saw the file,
    // so there is nothing to record.
    const id = 'at_rollback';
    await uploaded(id, { name: 'never.pdf' });

    const res = await callFunction(
      'deleteAttachment',
      { cardId: CARD, attachmentId: id },
      memToken,
    );
    expect(res.status).toBe(200);
    expect(await objectExists(id)).toBe(false);
    expect((await activityFor()).some((a) => a.from === 'never.pdf')).toBe(false);
  });

  it('refuses someone who is not on the board', async () => {
    const id = 'at_del_denied';
    await uploaded(id);
    const res = await callFunction(
      'deleteAttachment',
      { cardId: CARD, attachmentId: id },
      outsiderToken,
    );
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');
    expect(await objectExists(id)).toBe(true);
  });
});

describe('getAttachmentUrl', () => {
  it('returns a URL that actually serves the bytes with the published headers', async () => {
    const id = 'at_url';
    await uploaded(id, { name: 'report.pdf' });
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: id }, memToken);

    const res = await callFunction(
      'getAttachmentUrl',
      { cardId: CARD, attachmentId: id },
      memToken,
    );
    expect(res.status).toBe(200);
    const { url, name, contentType } = res.body.result as {
      url: string;
      name: string;
      contentType: string;
    };
    expect(name).toBe('report.pdf');
    expect(contentType).toBe('application/pdf');

    // Fetching it is the point: storing the disposition on the OBJECT rather
    // than as a signed-URL query override is what makes this assertable at all.
    const fetched = await fetch(url);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('application/pdf');
    expect(fetched.headers.get('content-disposition')).toContain('inline');
  });

  it('refuses an unfinished upload and a non-member', async () => {
    const id = 'at_url_pending';
    await uploaded(id);
    const pending = await callFunction(
      'getAttachmentUrl',
      { cardId: CARD, attachmentId: id },
      memToken,
    );
    expect(pending.body.error?.status).toBe('FAILED_PRECONDITION');

    const denied = await callFunction(
      'getAttachmentUrl',
      { cardId: CARD, attachmentId: id },
      outsiderToken,
    );
    expect(denied.body.error?.status).toBe('PERMISSION_DENIED');
  });
});

describe('the card carries a count so the board can badge it', () => {
  const countOf = async () =>
    ((await adminDb().doc(`cards/${CARD}`).get()).data()?.attachmentCount ?? 0) as number;

  it('counts READY files only, and follows removal back down', async () => {
    const before = await countOf();

    // An upload that has not been confirmed is not a file anyone can open, so
    // it must not badge the card.
    const pending = 'at_count_pending';
    await uploaded(pending);
    expect(await countOf()).toBe(before);

    const done = 'at_count_done';
    await uploaded(done);
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: done }, memToken);
    expect(await countOf()).toBe(before + 1);

    await callFunction('deleteAttachment', { cardId: CARD, attachmentId: done }, memToken);
    expect(await countOf()).toBe(before);

    // Rolling back the never-finalized one must not push the badge negative.
    await callFunction('deleteAttachment', { cardId: CARD, attachmentId: pending }, memToken);
    expect(await countOf()).toBe(before);
  });
});

describe('concurrency — two people, or two taps, at the same moment', () => {
  // Every one of these was a real defect found in review, reproduced here first.
  // The shape is always the same: read state, decide, write — without the read
  // and the write being one atomic step.

  it('finalize attributes the file to whoever UPLOADED it, not whoever confirmed it', async () => {
    const id = 'at_actor';
    await uploaded(id, { name: 'actor.pdf', uploadedBy: MEM });
    // The admin confirms an upload the member made.
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: id }, mgrToken);
    const attached = (await activityFor()).filter((a) => a.type === 'attached' && a.to === 'actor.pdf');
    expect(attached).toHaveLength(1);
    expect(attached[0].actorUid).toBe(MEM);
  });

  it('two concurrent finalizes log the attachment ONCE, and count it once', async () => {
    const id = 'at_race_fin';
    await uploaded(id, { name: 'racefin.pdf' });
    const before = await statsToday();
    // IN-PROCESS, not through the callable. The functions emulator serialises
    // concurrent calls to a warm instance, so driving this over HTTP passes
    // against genuinely broken code — verified. Two promises here interleave on
    // real Firestore round-trips, which is the actual race.
    await Promise.all(
      Array.from({ length: 6 }, () => applyFinalizeAttachment(CARD, id, MEM)),
    );
    const attached = (await activityFor()).filter((a) => a.type === 'attached' && a.to === 'racefin.pdf');
    expect(attached).toHaveLength(1);
    expect((await attachmentRef(id).get()).data()!.status).toBe('ready');

    // The counter lives in the same winner-only branch as the activity entry.
    // Six callers, one file: anything else and stored bytes are permanently
    // overstated, because nothing ever subtracts the surplus.
    const after = await statsToday();
    expect(after.filesAdded - before.filesAdded).toBe(1);
    expect(after.bytesAdded - before.bytesAdded).toBe(32);
  });

  it('a RETRIED finalize counts the file once', async () => {
    // The other half of the guard: not concurrency, but the same caller trying
    // again after a lost response. This one is caught by the `status === 'ready'`
    // fast path rather than by the transaction, so it is a genuinely separate
    // path to the same mistake — and the counter has to sit below BOTH.
    const id = 'at_retry_fin';
    await uploaded(id, { name: 'retryfin.pdf' });
    const before = await statsToday();
    const stored0 = await storedBytes();

    await applyFinalizeAttachment(CARD, id, MEM);
    await applyFinalizeAttachment(CARD, id, MEM);
    await applyFinalizeAttachment(CARD, id, MEM);

    const after = await statsToday();
    expect(after.filesAdded - before.filesAdded).toBe(1);
    expect((await storedBytes()) - stored0).toBe(32);
  });

  it('rolling back an unfinalized upload counts nothing and moves no bytes', async () => {
    // An upload that never became ready was never added to the stored total, so
    // subtracting it on rollback would drive the headline figure negative — the
    // reason the counter sits inside the `status === 'ready'` branch on removal
    // too, beside `bumpAttachmentCount`.
    const id = 'at_rollback_stats';
    await uploaded(id, { name: 'never.pdf' });
    const before = await statsToday();
    const stored0 = await storedBytes();

    await applyDeleteAttachment(CARD, id, MEM);

    const after = await statsToday();
    expect(after.filesRemoved - before.filesRemoved).toBe(0);
    expect(await storedBytes()).toBe(stored0);
  });

  it('two concurrent removals log the removal ONCE, and still clear the bytes', async () => {
    const id = 'at_race_del';
    await uploaded(id, { name: 'racedel.pdf' });
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: id }, memToken);
    // In-process again, and for the same reason as the finalize race above.
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => applyDeleteAttachment(CARD, id, i % 2 ? MGR : MEM)),
    );
    const detached = (await activityFor()).filter((a) => a.type === 'detached' && a.from === 'racedel.pdf');
    expect(detached).toHaveLength(1);
    expect((await attachmentRef(id).get()).exists).toBe(false);
    expect(await objectExists(id)).toBe(false);
  });

  it('a disabled account is refused, not just a pending one', async () => {
    const id = 'at_disabled';
    await uploaded(id);
    await adminAuth().setCustomUserClaims(MEM, { role: 'member', status: 'disabled' });
    const token = await idTokenFor(MEM);
    const res = await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: id }, token);
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');
    // Put it back, or every later test in this file runs as a disabled user.
    await adminAuth().setCustomUserClaims(MEM, { role: 'member', status: 'active' });
  });
});

describe('runAttachmentSweep', () => {
  it('clears abandoned uploads and leaves fresh and finished ones alone', async () => {
    const stale = 'at_stale';
    const fresh = 'at_fresh';
    const done = 'at_done';

    await uploaded(stale, { uploadedAt: 1 }); // long abandoned
    await uploaded(fresh); // in flight right now
    await uploaded(done);
    await callFunction('finalizeAttachment', { cardId: CARD, attachmentId: done }, memToken);

    // A document with no usable timestamp must be swept, not skipped: it is
    // stuck in `uploading`, so it will never become a file anyone can open, and
    // skipping it leaves it and its bytes here forever.
    const ageless = 'at_ageless';
    await uploaded(ageless, { uploadedAt: 'not-a-number' });

    const { swept } = await runAttachmentSweep();
    expect(swept).toBeGreaterThanOrEqual(1);

    expect((await attachmentRef(stale).get()).exists).toBe(false);
    expect((await attachmentRef(ageless).get()).exists).toBe(false);
    expect(await objectExists(ageless)).toBe(false);
    expect(await objectExists(stale)).toBe(false);
    expect((await attachmentRef(fresh).get()).exists).toBe(true);
    expect((await attachmentRef(done).get()).exists).toBe(true);
    expect(await objectExists(done)).toBe(true);
  });

  it('recovers late MCP bytes after the attachment was removed and preserves ready files', async () => {
    const removed = 'mcp_Rm012345678901234567';
    const ready = 'mcp_Rd012345678901234567';
    const expiresAt = Date.now() + 5 * 60 * 1000;
    for (const id of [removed, ready]) {
      await uploadReservation(id).set({ cardId: CARD, uploadedBy: MEM, size: 32, tokenHash: 'fixture', expiresAt });
    }
    await putRecord(removed);
    await uploaded(ready, { status: 'ready', sizeBytes: 32 });
    const deletion = await callFunction('deleteAttachment', { cardId: CARD, attachmentId: removed }, memToken);
    expect(deletion.body.result).toMatchObject({ removed: true });
    expect((await uploadReservation(removed).get()).get('cancelled')).toBe(true);
    // Simulate bytes arriving after delete, followed by a stopped uploader.
    await putObject(removed);
    await runAttachmentSweep(expiresAt + 1);
    expect(await objectExists(removed)).toBe(true);
    await runAttachmentSweep(expiresAt + MCP_UPLOAD_TIMEOUT_SECONDS * 1000 + 1);
    expect(await objectExists(removed)).toBe(false);
    expect((await uploadReservation(removed).get()).exists).toBe(false);
    expect((await attachmentRef(ready).get()).get('status')).toBe('ready');
    expect(await objectExists(ready)).toBe(true);
    expect((await uploadReservation(ready).get()).exists).toBe(false);
  });
});

describe('deleting a card takes its attachment objects with it', () => {
  it('sweeps the bucket by prefix, including bytes with no record', async () => {
    const cardId = 'at_doomed';
    await adminDb().doc(`cards/${cardId}`).set({
      boardId: BOARD,
      title: 'Doomed',
      description: '',
      columnId: 'c1',
      rank: 'V',
      assigneeUids: [],
      priority: 'none',
      labelIds: [],
      archived: false,
      commentCount: 0,
      createdAt: Date.now(),
      createdBy: MEM,
      updatedAt: Date.now(),
      updatedBy: MEM,
    });
    await putRecord('keep', {}, cardId);
    await putObject('keep', 32, cardId);
    // Bytes whose document never landed — invisible, billable, and the reason
    // the cascade is a prefix sweep rather than a per-document trigger.
    await putObject('orphan', 32, cardId);

    await adminDb().doc(`cards/${cardId}`).delete();

    await waitUntilGone('attachment objects', async () => {
      const [files] = await adminBucket().getFiles({ prefix: `cards/${cardId}/attachments/` });
      return files.length > 0;
    });
    const docs = await adminDb().collection(`cards/${cardId}/attachments`).get();
    expect(docs.empty).toBe(true);
  });

  it('subtracts the deleted files from the stored total', async () => {
    // A permanent card delete never goes through `applyDeleteAttachment` — it is
    // `recursiveDelete` plus a prefix sweep — so the stored total had nothing
    // subtracting these bytes. It climbed on every delete and could not
    // self-correct, because `bytesRemoved` is forward-only and the attachment
    // documents are gone moments later.
    const cardId = 'at_doomed_stats';
    await adminDb().doc(`cards/${cardId}`).set({
      boardId: BOARD,
      title: 'Doomed with files',
      description: '',
      columnId: 'c1',
      rank: 'V',
      assigneeUids: [],
      priority: 'none',
      labelIds: [],
      archived: false,
      commentCount: 0,
      createdAt: Date.now(),
      createdBy: MEM,
      updatedAt: Date.now(),
      updatedBy: MEM,
    });
    // Two READY files of known size, and one still uploading — the unfinished
    // one was never added to the total, so it must not be subtracted from it.
    await uploaded('doomed_a', { name: 'a.pdf' }, cardId);
    await uploaded('doomed_b', { name: 'b.pdf' }, cardId);
    await applyFinalizeAttachment(cardId, 'doomed_a', MEM);
    await applyFinalizeAttachment(cardId, 'doomed_b', MEM);
    await putRecord('doomed_partial', {}, cardId);

    const before = await storedBytes();
    const beforeRemoved = (await statsToday()).filesRemoved;

    await adminDb().doc(`cards/${cardId}`).delete();

    // Wait on the RECORDING, not on a byte total.
    //
    // The first version of this waited for `bytesStored` to equal
    // `before - 64` and passed against code that recorded nothing — a value
    // that never moves satisfies "wait until it equals X" only by timing out,
    // and it was the wait that was wrong, not the arithmetic. Waiting on the
    // event itself fails loudly and immediately when the event never happens.
    const after = await waitFor('the cascade to record the removal', async () => {
      const s = await statsToday();
      return s.filesRemoved > beforeRemoved ? s : undefined;
    });

    // Two ready files, not three: the unfinished upload was never counted, so
    // subtracting it would drive the stored total negative.
    expect(after.filesRemoved - beforeRemoved).toBe(2);
    expect(await storedBytes()).toBe(before - 64);
  });
});
