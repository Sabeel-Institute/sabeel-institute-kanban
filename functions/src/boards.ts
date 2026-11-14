import './setup';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { guarded, sentryDsn } from './sentry';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import type { BoardDoc } from '@sabeel/shared';
import {
  boardClone,
  boardCloneBytes,
  canAdministerUsers,
  canCreateBoards,
  canManageBoard,
  canSeeEveryBoard,
  canUnseatCreator,
  CLONE_BOARD_MAX_BYTES,
  CLONE_BOARD_MAX_CARDS,
  validateBoardName,
  watchKeyOnBoard,
  type CloneSourceCard,
} from '@sabeel/shared';
import { actorOf } from './actor';
import { recordStat } from './stats';

/** A Firestore auto-id, as the client's `doc(collection(...)).id` makes one. */
const DOCUMENT_ID = /^[A-Za-z0-9]{20}$/;

/**
 * Removing someone from a board is a CALLABLE, not a plain client write.
 *
 * Board membership and card assignment must move together. A card is readable by
 * anyone in its `assigneeUids` — that rule is what makes the cross-board "My
 * Work" collection-group query legal without a per-card parent lookup (see
 * docs/PRODUCT_BRIEF.md § Cross-board "My Work"). So a member removed from a
 * board while still assigned to its cards would KEEP read access to them, which
 * is precisely the leak the removal was meant to close.
 *
 * Doing both halves in one server-side batch means they cannot drift.
 */
export const removeBoardMember = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ boardId?: unknown; uid?: unknown }>) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const actor = actorOf(auth);

  const boardId = request.data?.boardId;
  const uid = request.data?.uid;
  if (typeof boardId !== 'string' || !boardId) {
    throw new HttpsError('invalid-argument', 'A boardId is required.');
  }
  if (typeof uid !== 'string' || !uid) {
    throw new HttpsError('invalid-argument', 'A uid is required.');
  }

  const db = getFirestore();
  const boardRef = db.doc(`boards/${boardId}`);
  const board = await boardRef.get();
  if (!board.exists) throw new HttpsError('not-found', 'No such board.');

  // Authorised AFTER the board is read, because authority is now per-board: this
  // is `ownsBoard()` from firestore.rules, in TypeScript. The board had to be
  // fetched anyway, so the reorder costs nothing.
  if (!canManageBoard(actor, board.data() as BoardDoc)) {
    throw new HttpsError(
      'permission-denied',
      'Only an owner of this board, or an admin, can change who is on it.',
    );
  }

  /**
   * CREATOR PROTECTION, repeated here because THIS is the boundary.
   *
   * `firestore.rules` refuses a board update that takes `createdBy` out of
   * `boardOwnerUids`, and removing them from the board would do exactly that —
   * but this callable is an Admin SDK batch and rules do not see it at all. The
   * screen disables the row, and a disabled control is an affordance, not a
   * security control: without this check, any owner could unseat the person who
   * created the board by "removing" them, which is the one thing the rule exists
   * to prevent.
   *
   * It also covers the creator LEAVING, deliberately: they cannot step down
   * unaided. One sentence, no exceptions to remember, at the price of an admin
   * request on the rare handover.
   */
  if (uid === board.data()?.createdBy && !canUnseatCreator(actor)) {
    throw new HttpsError(
      'permission-denied',
      'Only an admin can take the person who created this board off it.',
    );
  }

  // Cards assigned to the person being removed. Batched with the membership
  // change so there is no window in which they are unassigned but still a
  // member, or removed but still assigned.
  const assigned = await db
    .collection('cards')
    .where('boardId', '==', boardId)
    .where('assigneeUids', 'array-contains', uid)
    .get();

  // …and cards they SUBSCRIBED to, which matters for the same reason and a
  // little more sharply. The card read rule has a subscriber arm, so leaving
  // the uid behind would keep read access to this board's cards open to someone
  // who is no longer on it — the very leak clearing `assigneeUids` prevents.
  const subscribed = await db
    .collection('cards')
    .where('boardId', '==', boardId)
    .where('subscriberUids', 'array-contains', uid)
    .get();

  // …and the columns they watch here. Not an access question — the notice
  // sweep sends arrivals to board members only — but an entry nothing can
  // ever answer is clutter, and it counts against their watch limit.
  const userRef = db.doc(`users/${uid}`);
  const watched = ((await userRef.get()).data()?.watchedColumns as string[] | undefined) ?? [];
  // Removed by value, so a column they watch elsewhere in the meantime stays.
  const watchedHere = watched.filter((k) => watchKeyOnBoard(k, boardId));

  const batch = db.batch();
  batch.update(boardRef, {
    memberUids: FieldValue.arrayRemove(uid),
    // The denormalised profile goes with the membership — leaving it behind
    // would keep a departed colleague in every assignee picker.
    [`memberProfiles.${uid}`]: FieldValue.delete(),
    // …and so does OWNERSHIP. Authority is `member AND owner`, so a leftover
    // entry grants nothing today — but `addBoardMember` only writes
    // `memberUids`, so re-adding this person later would silently hand their
    // ownership back, with no confirmation and nothing in the activity log. The
    // rules cannot catch it either: this batch is an Admin SDK write and bypasses
    // them, which is exactly why there is no subset rule to lean on.
    boardOwnerUids: FieldValue.arrayRemove(uid),
    // Who did it, for the board's history (boardHistory.ts).
    updatedBy: auth.uid,
    updatedAt: Date.now(),
  });
  for (const card of assigned.docs) {
    batch.update(card.ref, {
      assigneeUids: FieldValue.arrayRemove(uid),
      // Attribute the resulting `unassigned` activity entry to the person who
      // ran the removal. Without this, onCardWritten reads the card's existing
      // `updatedBy` — whoever last edited it — and the log names the wrong actor.
      updatedBy: auth.uid,
      updatedAt: Date.now(),
    });
  }
  for (const card of subscribed.docs) {
    // Only the subscription — no `updatedBy`/`updatedAt`. A subscription is not
    // a property of the work, so removing one is not an edit anybody should see
    // in the card's history or in the Search browse order.
    batch.update(card.ref, { subscriberUids: FieldValue.arrayRemove(uid) });
  }
  if (watchedHere.length > 0) {
    batch.update(userRef, { watchedColumns: FieldValue.arrayRemove(...watchedHere) });
  }

  await batch.commit();

  // Worth a line of its own: a board with no owners left is administrable only by
  // an admin, and nothing else in the system says so out loud.
  const ownersLeft = ((board.data()?.boardOwnerUids as string[]) ?? []).filter(
    (u) => u !== uid,
  ).length;
  if (ownersLeft === 0) {
    logger.warn('Board left with no owners', { boardId, removedUid: uid, actorUid: auth.uid });
  }

  logger.info('Removed board member', {
    boardId,
    uid,
    actorUid: auth.uid,
    ownersLeft,
    unassignedCards: assigned.size,
    unsubscribedCards: subscribed.size,
  });

  return { ok: true, unassignedCards: assigned.size };
}));

/**
 * How many cards a removal would unassign, so the UI can warn before doing it.
 * "Remove Sara?" and "Remove Sara, unassigning her from 12 cards?" are different
 * questions.
 */
export const countMemberAssignments = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ boardId?: unknown; uid?: unknown }>) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const actor = actorOf(auth);

  const boardId = request.data?.boardId;
  const uid = request.data?.uid;
  if (typeof boardId !== 'string' || typeof uid !== 'string') {
    throw new HttpsError('invalid-argument', 'boardId and uid are required.');
  }

  const db = getFirestore();
  // Costs a read the old org-role gate did not, and it is not optional: the
  // question "may you administer this board" cannot be answered without the
  // board. Same gate as the removal this figure is shown before.
  const board = await db.doc(`boards/${boardId}`).get();
  if (!board.exists) throw new HttpsError('not-found', 'No such board.');
  if (!canManageBoard(actor, board.data() as BoardDoc)) {
    throw new HttpsError('permission-denied', 'Owners of this board, and admins, only.');
  }

  const assigned = await db
    .collection('cards')
    .where('boardId', '==', boardId)
    .where('assigneeUids', 'array-contains', uid)
    .count()
    .get();

  return { count: assigned.data().count };
}));

/**
 * Boards this person is the ONLY owner of.
 *
 * Disabling an account does not touch `boardOwnerUids` — the board keeps its
 * owner, that owner just cannot act — so there is nothing structurally broken to
 * prevent, only a situation to point at. The admin is told and proceeds; the
 * alternative, blocking, would mean not being able to disable a departing
 * colleague until every board they touched had been reassigned.
 *
 * Shaped like `countMemberAssignments`: a read-only question the UI asks BEFORE
 * it acts, so the answer appears in the confirmation rather than as a surprise
 * afterwards.
 *
 * `array-contains` on a single field is served by the automatic index — no entry
 * in firestore.indexes.json and no index deploy.
 */
export const boardsSolelyOwnedBy = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ uid?: unknown }>) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const actor = actorOf(auth);
  // Admin-only because it is asked from the People screen, and because it lists
  // boards the caller may well not be on.
  if (!canAdministerUsers(actor)) {
    throw new HttpsError('permission-denied', 'Admins only.');
  }

  const uid = request.data?.uid;
  if (typeof uid !== 'string' || !uid) {
    throw new HttpsError('invalid-argument', 'A uid is required.');
  }

  const owned = await getFirestore()
    .collection('boards')
    .where('boardOwnerUids', 'array-contains', uid)
    .get();

  const sole = owned.docs
    .filter((d) => ((d.data().boardOwnerUids as string[]) ?? []).length === 1)
    // ARCHIVED boards are left out on purpose. The warning's job is "these
    // boards will have nobody able to run them", and an archived board has
    // nobody running it either way — an admin restores it if it is ever wanted.
    // Listing them would pad a confirmation dialog with boards the answer does
    // not depend on, which is how a dialog stops being read.
    .filter((d) => d.data().archived !== true)
    .map((d) => ({ id: d.id, name: (d.data().name as string) ?? '(untitled)' }));

  return { boards: sole };
}));

/**
 * Who could still be added to this board — and the ADD itself, below.
 *
 * Both are callables for one reason: `firestore.rules` allows `list` on
 * `users/` to admins alone, so a non-admin board owner could never see who
 * exists. That was a real gap rather than a design: `docs/PERMISSIONS.md`
 * promises owners "add and remove members", removal was already a callable, and
 * adding was a client write whose *enabling read* was refused. The write was
 * permitted the whole time — an owner who somehow knew a uid could add them.
 * They simply had nothing to pick from.
 *
 * Every other people-picker in the app reads `memberProfiles`, denormalised onto
 * each board for exactly that purpose. This is the only control whose subject is
 * by definition NOT on the board yet, which is why it is the only one that needs
 * the directory, and why it is the only one that broke.
 *
 * NAMES ONLY, no email addresses. A picker needs something to tap; the rule
 * comment on `users/` notes that admins "are the only ones who ever see the full
 * list", and this widens that to owners for *names* rather than for contact
 * details. Admins still read the directory directly on the People screen, which
 * is what that rule was written for.
 */
export const listAddableUsers = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ boardId?: unknown }>) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const actor = actorOf(auth);

  const boardId = request.data?.boardId;
  if (typeof boardId !== 'string' || !boardId) {
    throw new HttpsError('invalid-argument', 'A boardId is required.');
  }

  const db = getFirestore();
  const board = await db.doc(`boards/${boardId}`).get();
  if (!board.exists) throw new HttpsError('not-found', 'No such board.');

  // The same gate removal uses — `ownsBoard()` from firestore.rules, in
  // TypeScript. Authorised after the read because authority is per-board.
  if (!canManageBoard(actor, board.data() as BoardDoc)) {
    throw new HttpsError(
      'permission-denied',
      'Only an owner of this board, or an admin, can change who is on it.',
    );
  }

  const members = new Set(((board.data()?.memberUids as string[]) ?? []));
  // Only `active` accounts. Offering a pending one would let an owner route
  // around the approval queue by adding somebody to a board before an admin has
  // decided about them.
  const snap = await db.collection('users').where('status', '==', 'active').get();

  const people = snap.docs
    .filter((d) => !members.has(d.id))
    .map((d) => ({ uid: d.id, displayName: (d.data().displayName as string) ?? '' }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { people };
}));

/**
 * Add somebody to a board.
 *
 * The PROFILE COMES FROM THE SERVER, not from the caller. It used to be a client
 * write carrying `displayName` and `email` from the picker, and board update
 * validates `memberProfiles` only as `is map` — rules cannot cross-reference
 * `users/` — so an owner could write any name or address against a uid. Reading
 * it here removes the possibility rather than trying to validate it.
 */
export const addBoardMember = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ boardId?: unknown; uid?: unknown }>) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const actor = actorOf(auth);

  const boardId = request.data?.boardId;
  const uid = request.data?.uid;
  if (typeof boardId !== 'string' || !boardId) {
    throw new HttpsError('invalid-argument', 'A boardId is required.');
  }
  if (typeof uid !== 'string' || !uid) {
    throw new HttpsError('invalid-argument', 'A uid is required.');
  }

  const db = getFirestore();
  const boardRef = db.doc(`boards/${boardId}`);
  const board = await boardRef.get();
  if (!board.exists) throw new HttpsError('not-found', 'No such board.');

  if (!canManageBoard(actor, board.data() as BoardDoc)) {
    throw new HttpsError(
      'permission-denied',
      'Only an owner of this board, or an admin, can change who is on it.',
    );
  }

  const person = await db.doc(`users/${uid}`).get();
  if (!person.exists) throw new HttpsError('not-found', 'No such person.');
  if (person.data()?.status !== 'active') {
    throw new HttpsError(
      'failed-precondition',
      'That account is not active. People must be approved under People before they can join a board.',
    );
  }

  // Idempotent: adding somebody already on the board is a no-op rather than an
  // error, because two owners tapping the same name is ordinary.
  const already = ((board.data()?.memberUids as string[]) ?? []).includes(uid);
  if (!already) {
    await boardRef.update({
      memberUids: FieldValue.arrayUnion(uid),
      [`memberProfiles.${uid}`]: {
        displayName: (person.data()?.displayName as string) ?? '',
        email: (person.data()?.email as string) ?? '',
      },
      // Who did it, for the board's history (boardHistory.ts).
      updatedBy: auth.uid,
      updatedAt: Date.now(),
    });
    logger.info('Added board member', { boardId, uid, actorUid: auth.uid });
  }

  return { ok: true, added: !already };
}));

/**
 * Clone a board: its columns and open cards, under a new name, as a new board
 * whose only member and owner is the caller. `boardClone` in `@sabeel/shared`
 * decides what a clone holds; this reads, checks and writes.
 *
 * A CALLABLE, because a clone must exist whole or not at all. Rules check a new
 * card against its board as it was before the write, so a client cannot create
 * a board and its cards in one batch, and a clone made in several writes could
 * stop half-made. Here the board, every card and every card's first history
 * line are ONE transaction, which also holds still what it read: a label
 * deleted meanwhile cannot leave its id on a cloned card.
 *
 * The CALLER names the new board's id, chosen when the clone is offered. A
 * retry after a clone that landed but whose answer was lost — a phone dropping
 * its connection — finds that board and returns it, rather than making a
 * second one nobody can delete.
 *
 * A clone is a new board, so it takes what creating one does: an organizer or
 * an admin. And it reads the source, so the caller must see it: a member of
 * it, or an admin.
 */
export const cloneBoard = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ boardId?: unknown; name?: unknown; cloneId?: unknown }>) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const actor = actorOf(auth);
  if (!canCreateBoards(actor)) {
    throw new HttpsError(
      'permission-denied',
      'Only organizers and admins can clone a board, because a clone is a new board.',
    );
  }

  const boardId = request.data?.boardId;
  const name = request.data?.name;
  const cloneId = request.data?.cloneId;
  if (typeof boardId !== 'string' || !boardId) {
    throw new HttpsError('invalid-argument', 'A boardId is required.');
  }
  if (typeof cloneId !== 'string' || !DOCUMENT_ID.test(cloneId)) {
    throw new HttpsError('invalid-argument', 'A cloneId is required.');
  }
  if (typeof name !== 'string') {
    throw new HttpsError('invalid-argument', 'A name is required.');
  }
  const nameProblem = validateBoardName(name);
  if (nameProblem) throw new HttpsError('invalid-argument', nameProblem);

  const db = getFirestore();
  const cloneRef = db.doc(`boards/${cloneId}`);
  const now = Date.now();
  const me = await db.doc(`users/${actor.uid}`).get();

  const made = await db.runTransaction(async (tx) => {
    const [source, already] = await Promise.all([tx.get(db.doc(`boards/${boardId}`)), tx.get(cloneRef)]);
    if (already.exists) {
      // The same clone asked for again: its answer was lost on the way back.
      if (already.data()?.createdBy !== actor.uid) {
        throw new HttpsError('already-exists', 'That board already exists.');
      }
      return null;
    }
    if (!source.exists) throw new HttpsError('not-found', 'No such board.');
    const board = source.data() as BoardDoc;
    if (!board.memberUids.includes(actor.uid) && !canSeeEveryBoard(actor)) {
      throw new HttpsError('permission-denied', 'You can only clone a board you are on.');
    }
    if (board.archived) {
      throw new HttpsError('failed-precondition', 'Restore this board before cloning it.');
    }

    // One past the cap is enough to refuse, without reading a huge board in full.
    const [cardsSnap, labelsSnap] = await Promise.all([
      tx.get(
        db
          .collection('cards')
          .where('boardId', '==', boardId)
          .where('archived', '==', false)
          .limit(CLONE_BOARD_MAX_CARDS + 1),
      ),
      tx.get(db.collection('labels')),
    ]);
    if (cardsSnap.size > CLONE_BOARD_MAX_CARDS) {
      throw new HttpsError(
        'failed-precondition',
        `This board has more than ${CLONE_BOARD_MAX_CARDS} open cards, more than one clone can take.`,
      );
    }

    const clone = boardClone({
      source: board,
      cards: cardsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CloneSourceCard, 'id'>) })),
      labels: labelsSnap.docs.map((d) => ({ id: d.id, boardId: d.data().boardId as string | undefined })),
      boardId: cloneId,
      name,
      cloner: actor.uid,
      copierProfile: {
        displayName: (me.data()?.displayName as string) ?? '',
        email: (me.data()?.email as string) ?? '',
      },
      now,
      newCardId: () => db.collection('cards').doc().id,
    });
    if (boardCloneBytes(clone) > CLONE_BOARD_MAX_BYTES) {
      throw new HttpsError(
        'failed-precondition',
        'This board holds too much text to clone in one go. Shorten some long descriptions, or archive cards the clone does not need.',
      );
    }

    tx.create(cloneRef, clone.board);
    for (const card of clone.cards) {
      const cardRef = db.doc(`cards/${card.id}`);
      tx.create(cardRef, card.data);
      tx.create(cardRef.collection('activity').doc(), card.created);
    }
    return clone.cards.length;
  });

  if (made !== null) {
    // Once, for the whole clone: the cards are stamped SYSTEM_ACTOR, which keeps
    // the per-card Stats increments of onCardWritten out of them (boardClone).
    await recordStat(cloneId, now, { cardsCreated: made }, actor.uid);
    logger.info('Cloned board', { from: boardId, to: cloneId, cards: made, actorUid: actor.uid });
  }
  return { boardId: cloneId };
}));
