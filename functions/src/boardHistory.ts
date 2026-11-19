import './setup';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { guardedEvent, sentryDsn } from './sentry';
import { getFirestore } from 'firebase-admin/firestore';
import { storedName } from './names';
import {
  withCleanExtras,
  CLONED_ENTRY_ID,
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
    const raw = (snap: { data(): Record<string, unknown> | undefined } | undefined) => {
      const data = snap?.data();
      return data ? (withCleanExtras(data) as unknown as BoardSnapshot) : null;
    };
    const before = raw(event.data?.before);
    const after = raw(event.data?.after);

    const changes = diffBoard(before, after);
    if (changes.length === 0) return;

    const db = getFirestore();
    // A clone's history opens with "cloned from", which `cloneBoard` wrote
    // with the board; a "created" line beside it would say the same twice.
    if (!before && (await db.doc(`boards/${event.params.boardId}/activity/${CLONED_ENTRY_ID}`).get()).exists) {
      return;
    }
    const actorUid = boardChangeActor(before, after);
    // The name as it is NOW, stored: an admin who is not on the board has no
    // profile there, and nobody's profile survives their leaving it.
    const actorName = await storedName(actorUid);
    // When the board was written, to the millisecond: the history is ordered
    // by it. Not `event.time`, which the emulator gives in whole seconds, so
    // two changes in one second tied and fell back on the entries' random ids.
    const at = event.data?.after?.updateTime?.toMillis() ?? Date.parse(event.time);
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
