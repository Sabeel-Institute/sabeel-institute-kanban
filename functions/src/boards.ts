import './setup';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { guarded, sentryDsn } from './sentry';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { withCleanExtras, type BoardActivityDoc, type BoardDoc } from '@sabeel/shared';
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
  CLONED_ENTRY_ID,
  NOTES_DOC_ID,
  notesLineCounts,
  utf8Length,
  validateBoardName,
  watchKeyOnBoard,
  type BoardNotesDoc,
  type CloneSourceCard,
  type NotesVersionDoc,
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
 * Read and write both sides in one server transaction so concurrent edits are included.
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
  const { ownersLeft, unassignedCards, unsubscribedCards } = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(boardRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'No such board.');
    const board = snapshot.data() as BoardDoc;

    if (!canManageBoard(actor, board)) {
      throw new HttpsError('permission-denied', 'Only an owner of this board, or an admin, can change who is on it.');
    }
    if (uid === board.createdBy && !canUnseatCreator(actor)) {
      throw new HttpsError('permission-denied', 'Only an admin can take the person who created this board off it.');
    }

    const cards = db.collection('cards').where('boardId', '==', boardId);
    const userRef = db.doc(`users/${uid}`);
    // Assignment and subscription are also read grants. Read them in the
    // transaction so a concurrent assignment cannot outlive membership.
    const [assigned, subscribed, user] = await Promise.all([
      tx.get(cards.where('assigneeUids', 'array-contains', uid)),
      tx.get(cards.where('subscriberUids', 'array-contains', uid)),
      tx.get(userRef),
    ]);
    const userData = user.data();
    const watchedHere = ((userData?.watchedColumns as string[] | undefined) ?? []).filter((key) => watchKeyOnBoard(key, boardId));
    const lanesHere = ((userData?.watchedLanes as string[] | undefined) ?? []).filter((key) => watchKeyOnBoard(key, boardId));

    const now = Date.now();
    tx.update(boardRef, {
      memberUids: FieldValue.arrayRemove(uid),
      [`memberProfiles.${uid}`]: FieldValue.delete(),
      boardOwnerUids: FieldValue.arrayRemove(uid),
      updatedBy: actor.uid,
      updatedAt: now,
    });
    const assignedIds = new Set(assigned.docs.map((card) => card.id));
    const subscribedIds = new Set(subscribed.docs.map((card) => card.id));
    const changedCards = new Map([...assigned.docs, ...subscribed.docs].map((card) => [card.id, card.ref]));
    for (const [id, ref] of changedCards) {
      tx.update(ref, {
        // Subscription alone is not an edit or activity on the card.
        ...(assignedIds.has(id) ? { assigneeUids: FieldValue.arrayRemove(uid), updatedBy: actor.uid, updatedAt: now } : {}),
        ...(subscribedIds.has(id) ? { subscriberUids: FieldValue.arrayRemove(uid) } : {}),
      });
    }
    if (watchedHere.length || lanesHere.length) {
      tx.update(userRef, {
        ...(watchedHere.length ? { watchedColumns: FieldValue.arrayRemove(...watchedHere) } : {}),
        ...(lanesHere.length ? { watchedLanes: FieldValue.arrayRemove(...lanesHere) } : {}),
      });
    }
    return {
      ownersLeft: (board.boardOwnerUids ?? []).filter((id) => id !== uid).length,
      unassignedCards: assigned.size,
      unsubscribedCards: subscribed.size,
    };
  });
  if (ownersLeft === 0) {
    logger.warn('Board left with no owners', { boardId, removedUid: uid, actorUid: auth.uid });
  }

  logger.info('Removed board member', {
    boardId,
    uid,
    actorUid: auth.uid,
    ownersLeft,
    unassignedCards,
    unsubscribedCards,
  });

  return { ok: true, unassignedCards };
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
 * line are ONE transaction. It holds what it read only until it commits:
 * `deleteLabel` sweeps cards outside any transaction, so a label deleted while
 * a clone is made can stay on a cloned card as an id nothing shows, the same
 * accepted residual as someone adding a label while it is deleted.
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
export const cloneBoard = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ boardId?: unknown; name?: unknown; cloneId?: unknown; subscribe?: unknown }>) => {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');

  const { boardId, name, cloneId, subscribe } = request.data ?? {};
  if (typeof boardId !== 'string' || !boardId || boardId.includes('/')) {
    throw new HttpsError('invalid-argument', 'A boardId is required.');
  }
  if (typeof cloneId !== 'string' || !DOCUMENT_ID.test(cloneId)) {
    throw new HttpsError('invalid-argument', 'A cloneId is required.');
  }
  if (typeof name !== 'string') {
    throw new HttpsError('invalid-argument', 'A name is required.');
  }
  if (subscribe !== undefined && typeof subscribe !== 'boolean') {
    throw new HttpsError('invalid-argument', 'subscribe must be true or false.');
  }
  return cloneBoardFor(actorOf(auth), { boardId, name, cloneId, subscribe });
}));

export async function cloneBoardFor(
  actor: ReturnType<typeof actorOf>,
  { boardId, name, cloneId, subscribe, via }: {
    boardId: string;
    name: string;
    cloneId: string;
    subscribe?: boolean;
    via?: BoardActivityDoc['via'];
  },
) {
  if (!canCreateBoards(actor)) {
    throw new HttpsError('permission-denied', 'Only organizers and admins can clone a board, because a clone is a new board.');
  }
  const nameProblem = validateBoardName(name);
  if (nameProblem) throw new HttpsError('invalid-argument', nameProblem);

  const db = getFirestore();
  const cloneRef = db.doc(`boards/${cloneId}`);
  const provenance = cloneRef.collection('private').doc('clone');
  const now = Date.now();
  const me = await db.doc(`users/${actor.uid}`).get();

  const landed = await db.runTransaction(async (tx) => {
    const [source, already] = await Promise.all([tx.get(db.doc(`boards/${boardId}`)), tx.get(cloneRef)]);
    if (already.exists) {
      const current = already.data() as BoardDoc;
      const recorded = (await tx.get(provenance)).data();
      // Older clones have only the public history entry with the source name.
      const history = recorded ? undefined : (await tx.get(cloneRef.collection('activity').doc(CLONED_ENTRY_ID))).data();
      const sameSource = recorded
        ? recorded.sourceBoardId === boardId
        : history?.type === 'cloned' && history.actorUid === actor.uid && source.exists && history.from === source.data()?.name;
      const sameClone = current.createdBy === actor.uid && sameSource;
      if (!sameClone || (!current.memberUids?.includes(actor.uid) && !canSeeEveryBoard(actor))) {
        throw new HttpsError('already-exists', 'A board with that id already exists. Use a new id for a new clone.');
      }
      return { made: null, name: current.name };
    }
    if (!source.exists) throw new HttpsError('not-found', 'No such board.');
    const board = withCleanExtras(source.data()!) as unknown as BoardDoc;
    if (!board.memberUids.includes(actor.uid) && !canSeeEveryBoard(actor)) {
      throw new HttpsError('permission-denied', 'You can only clone a board you are on.');
    }
    if (board.archived) {
      throw new HttpsError('failed-precondition', 'Restore this board before cloning it.');
    }

    // One past the cap is enough to refuse, without reading a huge board in full.
    const [cardsSnap, labelsSnap, notesSnap] = await Promise.all([
      tx.get(
        db
          .collection('cards')
          .where('boardId', '==', boardId)
          .where('archived', '==', false)
          .limit(CLONE_BOARD_MAX_CARDS + 1),
      ),
      tx.get(db.collection('labels')),
      tx.get(db.doc(`boards/${boardId}/notes/${NOTES_DOC_ID}`)),
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
      subscribe: subscribe === true,
      copierProfile: {
        displayName: (me.data()?.displayName as string) ?? '',
        email: (me.data()?.email as string) ?? '',
      },
      now,
      newCardId: () => db.collection('cards').doc().id,
    });
    // The notes come along as text, without their history: a template's notes
    // are where a program's run-book lives (Faisal, 2026-11-25).
    const notesText = (notesSnap.data() as BoardNotesDoc | undefined)?.text ?? '';
    if (boardCloneBytes(clone) + 2 * utf8Length(notesText) > CLONE_BOARD_MAX_BYTES) {
      throw new HttpsError(
        'failed-precondition',
        'This board holds too much text to clone in one go. Shorten some long descriptions, or archive cards the clone does not need.',
      );
    }

    tx.create(cloneRef, clone.board);
    // Every line the clone writes names who cloned it (names.ts).
    const clonerName = me.data()?.displayName;
    const cloner = typeof clonerName === 'string' && clonerName ? { actorName: clonerName } : {};
    const attribution = via ? { via } : {};
    // The clone's history opens with where it came from, and that is the only
    // record of it (Faisal, 2026-11-15: a clone is only a clone). Under a fixed
    // id, so `onBoardWritten` knows not to add a "created" line of its own.
    const cloned: BoardActivityDoc = {
      type: 'cloned',
      from: board.name,
      at: now,
      actorUid: actor.uid,
      ...cloner,
      ...attribution,
    };
    tx.create(cloneRef.collection('activity').doc(CLONED_ENTRY_ID), cloned);
    tx.create(provenance, { sourceBoardId: boardId });
    if (notesText.trim()) {
      // Version 1 with its version already written, so onBoardNotesWritten
      // finds it recorded and adds nothing: its line says where it came from.
      const notesRef = cloneRef.collection('notes').doc(NOTES_DOC_ID);
      const notes: BoardNotesDoc = { text: notesText, version: 1, updatedBy: actor.uid, updatedAt: now };
      const first: NotesVersionDoc = {
        text: notesText,
        version: 1,
        by: actor.uid,
        at: now,
        startedAt: now,
        ...notesLineCounts('', notesText),
        copiedFrom: board.name,
        ...(typeof clonerName === 'string' && clonerName ? { byName: clonerName } : {}),
        ...attribution,
      };
      tx.create(notesRef, notes);
      tx.create(notesRef.collection('versions').doc('1'), first);
    }
    for (const card of clone.cards) {
      const cardRef = db.doc(`cards/${card.id}`);
      tx.create(cardRef, card.data);
      tx.create(cardRef.collection('activity').doc(), { ...card.created, ...cloner, ...attribution });
    }
    return { made: clone.cards.length, name: clone.board.name };
  });

  const { made } = landed;
  if (made !== null) {
    // Once, for the whole clone: the cards are stamped SYSTEM_ACTOR, which keeps
    // the per-card Stats increments of onCardWritten out of them (boardClone).
    await recordStat(cloneId, now, { cardsCreated: made }, actor.uid);
    logger.info('Cloned board', { from: boardId, to: cloneId, cards: made, actorUid: actor.uid });
  }
  // The name the board HAS, which differs from the one asked for when an
  // earlier try, renamed since, made it: the app renames it to this try's.
  return { boardId: cloneId, name: landed.name };
}
