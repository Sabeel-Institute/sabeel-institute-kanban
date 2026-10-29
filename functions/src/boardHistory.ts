import './setup';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { guardedEvent, sentryDsn } from './sentry';
import { getFirestore } from 'firebase-admin/firestore';
import {
  boardChangeActor,
  diffBoard,
  type BoardActivityDoc,
  type BoardSnapshot,
} from '@sabeel/shared';

/**
 * A board's history, written by the server so it cannot be forged — the same
 * trust model as a card's (`activity.ts`): clients cannot write
 * `boards/{id}/activity` at all.
 *
 * ONE writer for every kind of change. Renames, archiving, ownership and
 * columns are client writes; adding and removing people are callables. Both
 * land as a board write carrying the `updatedBy`/`updatedAt` stamp, so this
 * trigger sees them all and the callables write no history of their own.
 * Who did it comes from the stamp (`boardChangeActor`), which rules hold to
 * the writer.
 *
 * Entry ids come from the event id, so a duplicate delivery rewrites the same
 * entries instead of adding a second copy of each.
 */
export const onBoardWritten = onDocumentWritten(
  { document: 'boards/{boardId}', secrets: [sentryDsn] },
  guardedEvent(async (event) => {
    const before = (event.data?.before?.data() ?? null) as BoardSnapshot | null;
    const after = (event.data?.after?.data() ?? null) as BoardSnapshot | null;

    const changes = diffBoard(before, after);
    if (changes.length === 0) return;

    const db = getFirestore();
    const actorUid = boardChangeActor(before, after);
    // The name as it is NOW, stored: an admin who is not on the board has no
    // profile there, and nobody's profile survives their leaving it.
    const actorName = actorUid
      ? ((await db.doc(`users/${actorUid}`).get()).data()?.displayName as string | undefined)
      : undefined;
    const at = Date.parse(event.time);
    const idBase = event.id.replace(/[^A-Za-z0-9_-]/g, '_');

    const batch = db.batch();
    changes.forEach((change, i) => {
      const entry: BoardActivityDoc = { ...change, at, actorUid, actorName };
      // Firestore rejects undefined, so only set what exists.
      const fields = Object.fromEntries(
        Object.entries(entry).filter(([, v]) => v !== undefined),
      );
      batch.set(db.doc(`boards/${event.params.boardId}/activity/${idBase}-${i}`), fields);
    });
    await batch.commit();
  }),
);
