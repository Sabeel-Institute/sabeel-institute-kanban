import './setup';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { guarded, sentryDsn } from './sentry';
import { logger } from 'firebase-functions/v2';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { canCurateLabels } from '@sabeel/shared';
import { actorOf } from './actor';

/**
 * Deleting an org-wide label.
 *
 * Labels live at `labels/{labelId}` and cards reference them by id, so removing
 * one is never a single-document act: every card carrying it has to let go of
 * it too. That is why `firestore.rules` denies client deletes outright.
 *
 * Three things a client could not do here:
 *  - Sweep across boards it cannot read. Only an admin may delete a label and
 *    only an admin reads every board — but the sweep must be complete regardless
 *    of who runs it, and the Admin SDK is what makes that guaranteed rather than
 *    incidental.
 *  - Name the actor. A delete TRIGGER cannot — Firestore does not tell it who
 *    performed the delete — which is the same reason attachment deletion is a
 *    callable rather than a trigger.
 *  - Stay recoverable if it fails halfway. See the ordering note below.
 */

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A Firestore batch holds 500 writes; stay well under it. */
const BATCH_LIMIT = 400;

function requireCurator(request: CallableRequest<unknown>): { uid: string } {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const actor = actorOf(auth);
  // ADMIN-only since board authority became per-board. Deleting a label strips
  // it from every card on every board, including boards the deleter is not on —
  // an org-wide effect, so an org-wide authority. Owning a board grants no part
  // of it.
  if (!canCurateLabels(actor)) {
    throw new HttpsError(
      'permission-denied',
      'Only an admin can change or delete a label.',
    );
  }
  return { uid: auth.uid };
}

function requireLabelId(data: { labelId?: unknown } | undefined): string {
  const labelId = data?.labelId;
  if (typeof labelId !== 'string' || !SAFE_ID.test(labelId)) {
    throw new HttpsError('invalid-argument', 'A valid labelId is required.');
  }
  return labelId;
}

/** Every card carrying this label, across every board. */
function cardsWithLabel(labelId: string) {
  return getFirestore().collection('cards').where('labelIds', 'array-contains', labelId);
}

/**
 * How many cards a deletion would strip the label from, split by whether those
 * cards are live or archived — "on 2 cards" reads very differently when one of
 * them is in the archive and invisible on every board.
 *
 * Read-and-partition rather than two `count()` aggregations, and that is a
 * deliberate index decision: `labelIds array-contains` together with
 * `archived ==` is an array-contains plus an equality, which Firestore cannot
 * serve from its automatic single-field indexes. It would need a composite —
 * this project already carries one of exactly that shape for `removeBoardMember`
 * (`boardId + assigneeUids`) — and a missing composite fails only in production,
 * which is how the attachment sweep broke once already. `select()` fetches the
 * one field, `deleteLabel` reads the same set anyway, and there are ten label
 * references in the entire database.
 */
export const countLabelUsage = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ labelId?: unknown }>) => {
  requireCurator(request);
  const labelId = requireLabelId(request.data);

  const used = await cardsWithLabel(labelId).select('archived').get();
  const archived = used.docs.filter((d) => d.data().archived === true).length;
  return { active: used.size - archived, archived };
}));

/**
 * Delete a label and strip it from every card that carries it.
 *
 * ORDER MATTERS: cards are swept FIRST, the label document last. Reversed, a
 * failure between the two steps would leave cards holding an id whose label no
 * longer exists and nothing left to find them by. This way a failure leaves the
 * label present with some cards already stripped — visibly incomplete, and
 * fixed by running it again, because `arrayRemove` is idempotent.
 *
 * No activity entry is written here. Setting `updatedBy` to the caller is enough:
 * `onCardWritten` diffs `labelIds`, sees the change and logs a `labels` entry
 * attributed to them — the same mechanism `removeBoardMember` relies on to make
 * the resulting `unassigned` entries name the remover rather than whoever last
 * touched the card.
 */
export const deleteLabel = onCall({ secrets: [sentryDsn] }, guarded(async (request: CallableRequest<{ labelId?: unknown }>) => {
  const { uid } = requireCurator(request);
  const labelId = requireLabelId(request.data);

  const db = getFirestore();
  const label = await db.doc(`labels/${labelId}`).get();
  if (!label.exists) throw new HttpsError('not-found', 'No such label.');

  const strippedFromCards = await applyDeleteLabel(labelId, uid);

  logger.info('Deleted label', {
    labelId,
    name: label.data()?.name,
    actorUid: uid,
    strippedFromCards,
  });

  return { ok: true, strippedFromCards };
}));

/**
 * Take the label off every card that carries it. Returns how many were changed.
 *
 * `updatedBy` is what makes the resulting history honest: `onCardWritten` diffs
 * `labelIds`, sees the change and logs a `labels` entry against whoever is named
 * here. Without it the log would credit whoever last edited the card. Exactly the
 * mechanism `removeBoardMember` relies on for its `unassigned` entries.
 */
async function sweepLabelFromCards(labelId: string, actorUid: string): Promise<number> {
  const db = getFirestore();
  const carrying = await cardsWithLabel(labelId).get();

  let swept = 0;
  for (let i = 0; i < carrying.docs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const card of carrying.docs.slice(i, i + BATCH_LIMIT)) {
      batch.update(card.ref, {
        labelIds: FieldValue.arrayRemove(labelId),
        updatedBy: actorUid,
        updatedAt: Date.now(),
      });
      swept += 1;
    }
    await batch.commit();
  }
  return swept;
}

/**
 * The effect, separated from its callable — see applyDeleteAttachment.
 *
 * ORDER IS THE POINT. Cards are swept FIRST and the document deleted LAST, so a
 * failure between the two leaves the label present with some cards already
 * stripped: visibly incomplete, and finished by running it again, because
 * `arrayRemove` is idempotent. Reversed, the same failure would leave cards
 * holding an id with nothing left to find them by.
 *
 * `sweep` is injectable for ONE reason: on the happy path both orders produce an
 * identical end state, so no assertion on the result can tell them apart. Passing
 * a sweep that throws is the only way to observe the ordering at all — and
 * without that, reversing the two lines below passes every other test here.
 */
export async function applyDeleteLabel(
  labelId: string,
  actorUid: string,
  sweep: (labelId: string, actorUid: string) => Promise<number> = sweepLabelFromCards,
): Promise<number> {
  const swept = await sweep(labelId, actorUid);
  await getFirestore().doc(`labels/${labelId}`).delete();
  return swept;
}
