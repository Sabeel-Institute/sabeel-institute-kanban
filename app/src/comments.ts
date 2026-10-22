import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { extractMentions, type MentionCandidate } from '@sabeel/shared';
import { db } from './firebase';
import { useLiveQuery } from './liveQuery';
import type { SessionUser } from './session';

export interface Comment {
  id: string;
  authorUid: string;
  body: string;
  mentionUids: string[];
  createdAt: number;
  editedAt?: number;
}

// Comments are a subcollection UNDER the card (`cards/{cardId}/comments`), so
// they travel with the card automatically when it moves boards.
const commentsRef = (cardId: string) => collection(db, 'cards', cardId, 'comments');
const commentRef = (cardId: string, commentId: string) =>
  doc(db, 'cards', cardId, 'comments', commentId);

export function useComments(cardId: string) {
  return useLiveQuery<Comment[]>(
    () => query(commentsRef(cardId), orderBy('createdAt')),
    [cardId],
    'comments',
    (docs) =>
      docs.map((d) => ({
        id: d.id,
        authorUid: (d.data.authorUid as string) ?? '',
        body: (d.data.body as string) ?? '',
        mentionUids: (d.data.mentionUids as string[]) ?? [],
        createdAt: (d.data.createdAt as number) ?? 0,
        editedAt: d.data.editedAt as number | undefined,
      })),
  );
}

/**
 * Mentions are resolved on the CLIENT and stored alongside the text.
 *
 * Rules then check that every mentioned uid is a board member, so a mention can
 * never notify someone who cannot open the card it points at. Re-parsing the
 * body server-side would have to agree exactly with this parser to be useful,
 * which is a duplication waiting to drift.
 */
export async function addComment(params: {
  cardId: string;
  body: string;
  candidates: readonly MentionCandidate[];
  user: SessionUser;
}): Promise<void> {
  const body = params.body.trim();
  if (!body) return;

  await addDoc(commentsRef(params.cardId), {
    authorUid: params.user.uid,
    body,
    mentionUids: extractMentions(body, params.candidates),
    createdAt: Date.now(),
  });
}

/**
 * Edit the body, and re-derive the mentions from it.
 *
 * `mentionUids` is a parse of the text, so it has to be re-parsed whenever the
 * text changes — exactly as `addComment` does. Leaving it alone (which is what
 * this used to do) made an edit lie in both directions: adding "@sara" recorded
 * no mention and told her nothing, and deleting one left her listed as mentioned
 * by a comment that no longer names her.
 */
export async function editComment(params: {
  cardId: string;
  commentId: string;
  body: string;
  candidates: readonly MentionCandidate[];
}): Promise<void> {
  const body = params.body.trim();
  if (!body) return;

  await updateDoc(commentRef(params.cardId, params.commentId), {
    body,
    mentionUids: extractMentions(body, params.candidates),
    editedAt: Date.now(),
  });
}

export async function deleteComment(cardId: string, commentId: string): Promise<void> {
  await deleteDoc(commentRef(cardId, commentId));
}
