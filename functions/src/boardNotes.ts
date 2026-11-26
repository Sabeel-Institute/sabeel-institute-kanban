import './setup';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { guardedEvent, sentryDsn } from './sentry';
import { storedName } from './names';
import {
  foldsIntoSitting,
  NOTES_DOC_ID,
  notesLineCounts,
  type BoardNotesDoc,
  type NotesVersionDoc,
} from '@sabeel/shared';

/**
 * A board's notes history, written by the server so it cannot be forged:
 * clients cannot write `versions` at all, and a version's name and time are
 * read here.
 *
 * One version per SITTING (`foldsIntoSitting`): a save by the person who made
 * the latest version, within ten minutes of it, replaces that version's text
 * and time instead of adding another, and its counts of lines added and
 * removed are worked out again against the version before the sitting.
 *
 * In a transaction, against the versions already written, so a repeated
 * delivery of the same save changes nothing: a save whose number the latest
 * version has reached is already recorded. A late delivery of an older save
 * is dropped the same way. Saves are a person's, seconds apart at the least,
 * and a later one already holds its text, so the cost is a line that names
 * the later writer only.
 */
export const onBoardNotesWritten = onDocumentWritten(
  { document: 'boards/{boardId}/notes/{noteId}', secrets: [sentryDsn] },
  guardedEvent(async (event) => {
    if (event.params.noteId !== NOTES_DOC_ID) return;
    const after = event.data?.after?.data() as BoardNotesDoc | undefined;
    if (!after || typeof after.version !== 'number') return;
    const before = event.data?.before?.data() as BoardNotesDoc | undefined;
    if (before && before.version === after.version) return;

    const db = getFirestore();
    const versions = db.collection(`boards/${event.params.boardId}/notes/${NOTES_DOC_ID}/versions`);
    // When the save landed, to the millisecond (see boardHistory.ts on `event.time`).
    const at = event.data?.after?.updateTime?.toMillis() ?? Date.parse(event.time);
    const via =
      after.agentAt !== undefined && after.agentAt === after.updatedAt && after.agentAt !== before?.agentAt
        ? ('agent' as const)
        : undefined;
    const byName = await storedName(after.updatedBy);

    await db.runTransaction(async (tx) => {
      const recent = await tx.get(versions.orderBy('version', 'desc').limit(2));
      const [latest, prior] = recent.docs;
      const latestData = latest?.data() as NotesVersionDoc | undefined;
      if (latestData && latestData.version >= after.version) return;
      // A restore is recorded as one only when it is: the version it names
      // exists and holds the text saved. Otherwise any member could write a
      // "Restored the version of …" line over text that version never had.
      const named = after.restoredFrom ? await tx.get(versions.doc(after.restoredFrom)) : null;
      const restored =
        named?.exists && (named.data() as NotesVersionDoc).text === after.text ? named : null;
      const restoredFrom = restored ? after.restoredFrom : undefined;

      const save = { by: after.updatedBy, at, via, restoredFrom };
      const fold = latestData !== undefined && foldsIntoSitting(latestData, save);
      // What the sitting changed: from the version before it, or from nothing.
      const base = fold ? (prior?.data() as NotesVersionDoc | undefined) : latestData;
      const counts = notesLineCounts(base?.text ?? '', after.text);

      const entry: NotesVersionDoc = {
        text: after.text,
        version: after.version,
        by: after.updatedBy,
        at,
        startedAt: fold && latestData ? latestData.startedAt : at,
        ...counts,
        ...(byName ? { byName } : {}),
        ...(via ? { via } : {}),
        ...(restored ? { restoredFrom, restoredAt: (restored.data() as NotesVersionDoc).at } : {}),
      };
      tx.set(fold && latest ? latest.ref : versions.doc(String(after.version)), entry);
    });
  }),
);
