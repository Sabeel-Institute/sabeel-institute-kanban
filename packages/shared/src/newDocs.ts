/**
 * The documents a person's new card and new comment are, built in ONE place
 * for every writer: the app, and the MCP server agents use (functions/src/mcp).
 * Both write as the person, under the same rules, so both must write the same
 * shape; a second copy of either would drift.
 */
import { extractMentions, type MentionCandidate } from './mentions';
import { rankBetween } from './rank';
import type { CardDoc, CommentDoc } from './types';

/** A new card at the foot of its column: `lastRank` is the column's last card's, or null. */
export function newCardDoc(params: {
  boardId: string;
  columnId: string;
  title: string;
  uid: string;
  lastRank: string | null;
  /** The creator's bell; only for a board member (rules hold subscribers to members). */
  subscribe: boolean;
  /** Its lane, on a board with lanes; absent is No lane. */
  laneId?: string;
  now: number;
}): CardDoc {
  return {
    boardId: params.boardId,
    title: params.title.trim(),
    description: '',
    columnId: params.columnId,
    rank: rankBetween(params.lastRank, null),
    assigneeUids: [],
    subscriberUids: params.subscribe ? [params.uid] : [],
    priority: 'none',
    labelIds: [],
    archived: false,
    commentCount: 0,
    attachmentCount: 0,
    createdAt: params.now,
    createdBy: params.uid,
    updatedAt: params.now,
    updatedBy: params.uid,
    ...(params.laneId ? { laneId: params.laneId } : {}),
  };
}

/** Who a comment mentions: never its author, whom `@all` would otherwise take. */
export function commentMentions(
  authorUid: string,
  body: string,
  candidates: readonly MentionCandidate[],
): string[] {
  return extractMentions(body, candidates).filter((u) => u !== authorUid);
}

/** A new comment; `body` already trimmed and non-empty. */
export function newCommentDoc(params: {
  authorUid: string;
  body: string;
  candidates: readonly MentionCandidate[];
  now: number;
}): CommentDoc {
  return {
    authorUid: params.authorUid,
    body: params.body,
    mentionUids: commentMentions(params.authorUid, params.body, params.candidates),
    createdAt: params.now,
  };
}
