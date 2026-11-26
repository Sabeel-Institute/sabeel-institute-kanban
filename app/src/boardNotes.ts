import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDocFromServer,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  normalizeMarkdown,
  NOTES_DOC_ID,
  type BoardNotesDoc,
  type NotesVersionDoc,
} from '@sabeel/shared';
import { db } from './firebase';
import { useLiveDoc, useLiveQuery } from './liveQuery';
import type { SessionUser } from './session';

/**
 * A board's notes: the page, its history, and saving it (`@sabeel/shared`
 * `boardNotes.ts` holds the rules both sides share).
 */

/** The page as the app reads it. A board with no notes has version 0 and no text. */
export interface BoardNotes {
  text: string;
  version: number;
  updatedBy?: string;
  updatedAt?: number;
}

const NONE: BoardNotes = { text: '', version: 0 };

function notesRef(boardId: string) {
  return doc(db, 'boards', boardId, 'notes', NOTES_DOC_ID);
}

/**
 * The page, live. Ready with version 0 when the board has none, which is a
 * different answer from loading: the board waits for it before drawing a
 * page for the notes, or the pager would gain a page under someone's finger.
 */
export function useBoardNotes(boardId: string) {
  return useLiveDoc<BoardNotes>(
    () => notesRef(boardId),
    [boardId],
    'board-notes',
    (d) => {
      if (!d) return NONE;
      const data = d.data as Partial<BoardNotesDoc>;
      return {
        text: typeof data.text === 'string' ? data.text : '',
        version: typeof data.version === 'number' ? data.version : 0,
        updatedBy: data.updatedBy,
        updatedAt: data.updatedAt,
      };
    },
  );
}

/** Are there notes to show? Whitespace is none. */
export function hasNotes(notes: BoardNotes | undefined): boolean {
  return !!notes && notes.text.trim().length > 0;
}

export type NotesVersion = NotesVersionDoc & { id: string };

/** The 200 latest versions, newest first; a sitting is one. */
const NOTES_VERSIONS_SHOWN = 200;

export function useNotesVersions(boardId: string) {
  return useLiveQuery<NotesVersion[]>(
    () =>
      query(
        collection(db, 'boards', boardId, 'notes', NOTES_DOC_ID, 'versions'),
        orderBy('version', 'desc'),
        limit(NOTES_VERSIONS_SHOWN),
      ),
    [boardId],
    'board-notes-versions',
    (docs) => docs.map((d) => ({ ...(d.data as unknown as NotesVersionDoc), id: d.id })),
  );
}

/**
 * The latest version alone, for the "Edited by" line on the board: one
 * document, where the history screen reads up to `NOTES_VERSIONS_SHOWN`.
 */
export function useLatestNotesVersion(boardId: string) {
  return useLiveQuery<NotesVersion | null>(
    () =>
      query(
        collection(db, 'boards', boardId, 'notes', NOTES_DOC_ID, 'versions'),
        orderBy('version', 'desc'),
        limit(1),
      ),
    [boardId],
    'board-notes-latest',
    (docs) => (docs[0] ? { ...(docs[0].data as unknown as NotesVersionDoc), id: docs[0].id } : null),
  );
}

/**
 * Who last saved the page, by the stored name first (`functions/src/names.ts`):
 * the latest version's, once the server has recorded this save. Until then,
 * the board's own member list, then "Someone".
 */
export function lastEditor(
  notes: BoardNotes,
  latest: NotesVersion | null | undefined,
  members: readonly { uid: string; displayName: string }[],
): { name: string; at: number | undefined; via?: 'agent' } {
  if (latest && latest.version === notes.version) {
    return { name: latest.byName ?? nameIn(members, latest.by), at: latest.at, via: latest.via };
  }
  return { name: nameIn(members, notes.updatedBy), at: notes.updatedAt };
}

function nameIn(members: readonly { uid: string; displayName: string }[], uid: string | undefined): string {
  return members.find((m) => m.uid === uid)?.displayName ?? 'Someone';
}

/** Someone saved over the version an edit started from. */
export class NotesConflict extends Error {
  constructor(readonly theirs: BoardNotes) {
    super('The notes changed while you were editing.');
  }
}

/**
 * Save the page over `base`, the version the edit started from.
 *
 * The rules accept only `base + 1`, so a refusal while the page has moved on
 * is a conflict, and says so with the page as it now stands; any other
 * refusal is passed on as it came. Resolves once the server has the save.
 */
export async function saveBoardNotes(
  boardId: string,
  text: string,
  base: number,
  user: SessionUser,
  restoredFrom?: string,
): Promise<void> {
  const ref = notesRef(boardId);
  const next: BoardNotesDoc = {
    // The canonical form: an emptied editor hands back a lone line break,
    // and empty must be '' for "no notes" to mean the same everywhere.
    text: normalizeMarkdown(text),
    version: base + 1,
    updatedBy: user.uid,
    updatedAt: Date.now(),
    ...(restoredFrom ? { restoredFrom } : {}),
  };
  try {
    await setDoc(ref, next);
  } catch (e) {
    const current = await getDocFromServer(ref).catch(() => null);
    const version = (current?.data()?.version as number | undefined) ?? 0;
    if (current && version !== base) {
      const data = current.data() as Partial<BoardNotesDoc> | undefined;
      throw new NotesConflict({
        text: data?.text ?? '',
        version,
        updatedBy: data?.updatedBy,
        updatedAt: data?.updatedAt,
      });
    }
    throw e;
  }
}

/** The boards whose notes panel this person keeps open on a wide screen, live. */
export function useNotesOpen(user: SessionUser) {
  return useLiveDoc<string[]>(
    () => doc(db, 'users', user.uid),
    [user.uid],
    'notes-open',
    (d) => {
      const ids = d?.data.notesOpenBoardIds;
      return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
    },
  );
}

/** One board, one way. Server-applied, so it never carries another board's state along. */
export async function setNotesOpen(user: SessionUser, boardId: string, open: boolean): Promise<void> {
  await updateDoc(doc(db, 'users', user.uid), {
    notesOpenBoardIds: open ? arrayUnion(boardId) : arrayRemove(boardId),
  });
}
