/**
 * Shared document shapes. These mirror docs/PRODUCT_BRIEF.md § Data model —
 * change them together.
 */

// ---- Users -----------------------------------------------------------------

/**
 * Org-wide role — and, since 2026-08-16, ONLY the org-wide part.
 *
 * `organizer` grants exactly one thing: creating boards. Everything else it used
 * to carry has moved:
 *
 *  - Authority over a board is now PER BOARD (`Board.boardOwnerUids`), so a plain
 *    member can run one board without gaining anything anywhere else.
 *  - Seeing every board, curating the org-wide label set, and reading Stats are
 *    all `admin` alone.
 *
 * The old `manager` value meant all three at once, which is why one predicate
 * (`canManageBoards`) ended up aliased into three unrelated decisions — see the
 * note on `canCurateLabels` in access.ts for what that cost.
 */
export type Role = 'member' | 'organizer' | 'admin';

/** Every account lands `pending`; only an admin moves it on. */
export type UserStatus = 'pending' | 'active' | 'rejected' | 'disabled';

export type NotifyEvent =
  | 'mention'
  | 'assigned'
  | 'commentOnMyCard'
  | 'commentOnSubscribed'
  | 'dueSoon'
  | 'myCardMoved'
  | 'newUserPending';

export interface UserDoc {
  displayName: string;
  email: string;
  photoUrl?: string;
  /** Mirrors the custom claim for UI display. Rules trust the TOKEN, not this. */
  status: UserStatus;
  /** Mirrors the custom claim for UI display. Rules trust the TOKEN, not this. */
  role: Role;
  notifyPrefs: Partial<Record<NotifyEvent, boolean>>;
  mutedBoardIds: string[];
  favoriteBoardIds: string[];
  recentBoardIds: string[];
  unreadNotifCount: number;
  createdAt: number;
}

// ---- Boards ----------------------------------------------------------------

export interface BoardColumn {
  id: string;
  name: string;
}

// ---- Labels ----------------------------------------------------------------

/**
 * A label, org-wide. Lives at `labels/{labelId}` — every board sees every label,
 * and a card's `labelIds` resolve against this one set wherever the card is.
 *
 * A COLLECTION rather than an array on a config document, because any active
 * member may create one: two people adding to a single array field is a lost
 * write, not a merge. One document per label is also what makes the name length
 * and colour rules-enforceable at all — rules cannot iterate a list, which is
 * why `LABEL_NAME_MAX` was client-only while labels lived on the board.
 */
export interface LabelDoc {
  name: string;
  /** From `LABEL_COLORS`. Must stay legible on the ivory background. */
  color: string;
  createdAt: number;
  createdBy: string;
}

/** A label document with its id, which is what every consumer actually holds. */
export interface Label extends LabelDoc {
  id: string;
}

export interface BoardDoc {
  name: string;
  description: string;
  archived: boolean;
  columns: BoardColumn[];
  /**
   * The ids from `columns`, duplicated as a flat array.
   *
   * Firestore rules cannot search a list of maps, so this is what lets a card
   * write be checked against "is this a real column on this board?" in one
   * cheap expression. Always written together with `columns`.
   */
  columnIds: string[];
  /** Drives `array-contains` queries for "my boards". */
  memberUids: string[];
  /**
   * Names and addresses of the board's members, denormalised.
   *
   * Only admins may list `users/*`, but every board member needs to see who is
   * on the board to assign a card or @mention someone. Without this a member
   * would hit permission-denied on the directory and simply be unable to assign
   * anyone. Written together with `memberUids`; the removeBoardMember callable
   * clears both.
   */
  memberProfiles: Record<string, { displayName: string; email: string }>;
  /**
   * Who may ADMINISTER this board — settings, columns, membership, archiving,
   * permanently deleting a card, moderating a comment.
   *
   * Orthogonal to `Role`: a plain member can own a board, and owning it grants
   * nothing anywhere else. Always read together with `memberUids` — authority is
   * `admin || (member AND owner)`, so an entry here for someone who is no longer
   * a member is inert rather than dangerous. `removeBoardMember` clears both, or
   * re-adding that person would silently restore their ownership.
   *
   * OPTIONAL because boards written before 2026-08-16 do not carry it. Rules read
   * it with `.get('boardOwnerUids', [])` throughout: plain access on a document
   * that lacks the field ERRORS, which denies the write and makes the board
   * permanently uneditable — the trap `createdAt` and `activeCardCount` already
   * document above.
   */
  boardOwnerUids?: string[];
  /**
   * Number of non-archived cards on this board, denormalised so the Boards list
   * can show it without counting cards per board per render. Server-maintained
   * by the `onCardBoardCount` trigger — never written by a client (same trust
   * model as a card's `commentCount`).
   */
  activeCardCount: number;
  createdAt: number;
  createdBy: string;
  /**
   * Who last changed the board, and when, so its history can name them.
   *
   * Rules accept a change only if it either stamps both — `updatedBy` the
   * writer, `updatedAt` a new value — or leaves both alone. The second arm is
   * for app builds older than the history, which do not know the stamp; their
   * changes are recorded without a name rather than refused. The callables
   * stamp too, with the caller. Absent on a board nobody has changed since.
   */
  updatedAt?: number;
  updatedBy?: string;
}

// ---- Cards -----------------------------------------------------------------

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export interface CardDoc {
  /**
   * The board this card is on. Cards are a TOP-LEVEL collection (`cards/{id}`),
   * not a subcollection, so the board is a field, not the path. Client-supplied
   * and rule-validated: create/update require membership of this board, and a
   * cross-board MOVE is precisely a mutation of this field (to another board the
   * user is a member of). See firestore.rules `match /cards/{cardId}`.
   */
  boardId: string;
  title: string;
  /**
   * MARKDOWN, restricted to `RICH_VOCABULARY` (bold, italic, bullet list,
   * ordered list, link). Never HTML. Legacy rows are plain text, which is
   * valid markdown — see `packages/shared/src/richtext.ts`.
   */
  description: string;
  columnId: string;
  /** Fractional base-62 rank. Only `rankBetween` in this package produces these. */
  rank: string;
  /**
   * MUST be a subset of `boardId`'s `memberUids` — rules enforce it. This is what
   * lets an assignee read a card (the "My Work" query) via the read rule's
   * assignee arm without a parent-board lookup. Breaking it breaks My Work's
   * security. A move drops any assignee who isn't a member of the destination.
   */
  assigneeUids: string[];
  /**
   * Who has subscribed to this card's COMMENTS. Not "watchers" — nothing else
   * about the card notifies them (see docs/PRODUCT_BRIEF.md).
   *
   * Subject to the same board-membership rule as `assigneeUids`, and for a
   * sharper reason: the card read rule has a subscriber arm, so subscribing is
   * a grant of read access. Membership is what keeps that from being a way into
   * a board you are not on, and `removeBoardMember` clears this for the same
   * reason it clears assignees.
   *
   * Optional because cards written before it existed do not carry it — read as
   * `?? []`, and rules compare it with `.get('subscriberUids', [])`.
   */
  subscriberUids?: string[];
  /** All-day date as `YYYY-MM-DD`. Never a timestamp — timestamps drift. */
  dueDate?: string;
  priority: Priority;
  /**
   * Ids into the org-wide `labels` collection. Labels are NOT board-scoped, so
   * these survive a cross-board move and are copied with the card — unlike
   * `parentId`, which is scoped to the cards travelling with it.
   *
   * An id whose label has been deleted resolves to nothing and renders as
   * nothing, but that is not a state the app produces: `deleteLabel` strips the
   * id from every card that carries it.
   */
  labelIds: string[];
  archived: boolean;
  archivedAt?: number;
  commentCount: number;
  /**
   * Ready attachments on this card, so the board can badge a card without
   * querying a subcollection per tile. Optional because cards written before
   * attachments existed do not carry it — read it as `?? 0`.
   *
   * Counts READY files only. A half-finished upload is not a file anyone can
   * open, and a badge that appears and then vanishes when the sweep runs would
   * be worse than no badge.
   */
  attachmentCount?: number;
  /**
   * The card this one is a subtask OF. The link lives on the CHILD so there is a
   * single source of truth: a `subtaskIds` array on the parent could disagree
   * with reality, and every reparent would be a two-document write.
   *
   * BOARD-SCOPED by convention, not by rule. Enforcing "the parent is on the same
   * board" would need the first card → card `get()` in firestore.rules — a read
   * per write plus a delete/write race — and it is not a security boundary, since
   * this is an opaque string and a child's read access comes from its own
   * `boardId`. So the picker only ever offers same-board cards, and a link that
   * goes stale (parent moved or deleted) simply renders as nothing. A cross-board
   * move clears it unless the parent is travelling too. `labelIds` used to be
   * cleared alongside it and no longer is — labels are org-wide, so they mean
   * the same thing on every board.
   */
  parentId?: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  /**
   * When a comment or a file last moved on this card. TRIGGER-OWNED — rules pin
   * it across a client update, exactly as `attachmentCount` is pinned.
   *
   * It exists because `updatedAt` cannot answer "what has been happening":
   * that field is client-written on a card EDIT, and neither posting a comment
   * nor attaching a file edits a card field. Neither timestamp is the whole
   * answer alone, so read them through `lastActivityOf` in `search.ts` — which
   * takes the MAX of the two plus `createdAt`, never either on its own.
   *
   * Optional because cards written before it existed do not carry it, which is
   * also why there was no backfill: the fallback IS the old value.
   */
  lastActivityAt?: number;
  /** Stable id from a ClickUp import, making re-runs idempotent. */
  sourceId?: string;
}

// ---- Comments & activity ---------------------------------------------------

export interface CommentDoc {
  authorUid: string;
  body: string;
  mentionUids: string[];
  createdAt: number;
  editedAt?: number;
}

/**
 * A file on a card. Lives at `cards/{cardId}/attachments/{attachmentId}`, so it
 * travels with the card when it moves between boards.
 *
 * The document exists BEFORE its bytes do. Creating it is what authorizes the
 * upload — Cloud Storage rules cannot read Firestore, so this rules-checked
 * write is the only place board membership can be proven — and the object then
 * goes to a path derived from the ids. A document in `status: 'uploading'` is
 * therefore an ordinary, expected state, not a broken one.
 */
export interface AttachmentDoc {
  /** Original filename, sanitized server-side at finalize. Display only. */
  name: string;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;
  status: 'uploading' | 'ready';
  /**
   * Read from the object by `finalizeAttachment`, never claimed by the client —
   * which is why it is absent while the upload is still in flight, and why the
   * rules do not admit it on create.
   */
  sizeBytes?: number;
}

export type ActivityType =
  | 'created'
  | 'moved'
  | 'assigned'
  | 'unassigned'
  | 'due'
  | 'priority'
  | 'labels'
  | 'edited'
  | 'archived'
  /** On the CHILD: this card was made, or stopped being, a subtask. `to`/`from`
   *  carry the parent card id. */
  | 'subtaskOf'
  /** On the PARENT: a subtask was added or removed. `to`/`from` carry the child
   *  card id. Written by the trigger onto the OTHER card, so the action shows up
   *  where it was taken — you link a subtask while looking at the parent. */
  | 'subtask'
  /** A file was attached. `to` carries its name. */
  | 'attached'
  /** A file was removed. `from` carries its name. */
  | 'detached';

/**
 * One change to a board itself — its name, archiving, who is on it, who owns
 * it, its columns. A card's history is separate (`ActivityType`).
 */
export type BoardActivityType =
  | 'created'
  /** `from`/`to` carry the old and new name. */
  | 'renamed'
  | 'archived'
  | 'restored'
  /** The subject joined: added by someone else, or joined themselves. */
  | 'memberAdded'
  /** The subject came off: removed by someone else, or left. */
  | 'memberRemoved'
  | 'ownerAdded'
  | 'ownerRemoved'
  /** `to` carries the column's name. */
  | 'columnAdded'
  /** `from` carries the column's name. */
  | 'columnRemoved'
  /** `from`/`to` carry the old and new name. */
  | 'columnRenamed'
  | 'columnsReordered';

/**
 * An entry in a board's history, at `boards/{boardId}/activity/{id}`.
 * Server-written only, like a card's activity.
 *
 * NAMES ARE STORED, not resolved when shown. A board's members can read only
 * its own `memberProfiles`, and the people a history is most often about — the
 * person removed, the admin who is not on the board, the column since deleted —
 * are exactly the ones that resolve to nothing later.
 */
export interface BoardActivityDoc {
  type: BoardActivityType;
  /** When it happened — or, with `since`, the latest it can have happened. */
  at: number;
  /**
   * Who did it. Absent when nothing recorded who: a change from an app build
   * older than the history, or one recovered from backups taken before it.
   */
  actorUid?: string;
  actorName?: string;
  /** Whom a member or owner entry is about. */
  subjectUid?: string;
  subjectName?: string;
  from?: string;
  to?: string;
  /**
   * Set only on a change recovered from backups: it happened after `since` and
   * by `at`, and nothing narrows it further.
   */
  since?: number;
}

// ---- Stats -----------------------------------------------------------------

/**
 * The plain running totals a day can accumulate. Every one is a COUNT of things
 * that happened that day, so bucketing by week or month is a sum.
 *
 * Deliberately not including "people active": that is a DISTINCT count, and
 * distinct counts cannot be derived from sums — see `actors` below.
 */
export type StatsCounter =
  | 'cardsCreated'
  | 'cardsArchived'
  | 'comments'
  | 'filesAdded'
  | 'filesRemoved'
  | 'bytesAdded'
  | 'bytesRemoved';

/**
 * One day's activity for one scope.
 *
 * Every field is optional and only written when non-zero, so a quiet day costs
 * nothing and a quiet month is a nearly empty document.
 */
export type StatsDay = Partial<Record<StatsCounter, number>> & {
  /**
   * Who did anything at all that day — not a count.
   *
   * Stored as uids so that a week's "active people" is the SIZE OF THE UNION
   * across its days, not the sum of its daily counts, which would count the
   * same person once per day they worked. `arrayUnion` dedupes on write, and
   * the org-wide `_all` scope's array is the true union across boards for the
   * same reason. Bounded by headcount, so an array is the right shape.
   */
  actors?: string[];
};

/**
 * A month of daily buckets for one scope, at `stats/{scope}/months/{YYYY-MM}`.
 *
 * A month per document rather than a day per document: a year of history is 12
 * reads instead of 365, and it STAYS 12 as history accumulates. Worst case is
 * around 11 KB — 31 days of counters plus a headcount of uids each — which is
 * far inside the 1 MB document limit even after years of use.
 *
 * `days` and `actors` are exempted from indexing in firestore.indexes.json.
 * Firestore auto-indexes every nested map field, which would put ~250 index
 * entries on the most frequently written document in the system, for data that
 * is only ever read by document id.
 */
export interface StatsMonthDoc {
  /** A `boardId`, or `STATS_ALL_SCOPE` for the org-wide roll-up. */
  scope: string;
  /** `YYYY-MM`, matching the document id. Denormalised so a doc is readable alone. */
  month: string;
  /** Keyed by day-of-month, `'01'`…`'31'`. Sparse — absent means nothing happened. */
  days: Record<string, StatsDay>;
}

/**
 * The org-wide document at `stats/_all`, holding STOCKS rather than flows.
 *
 * Storage is the amount held right now, not an amount that happened on a day,
 * so it is maintained as a running total beside the daily deltas. Deriving it
 * by summing `bytesAdded - bytesRemoved` over all time would need every day
 * ever to be present and correct; a running total needs only the current value.
 */
export interface StatsRootDoc {
  bytesStored: number;
  filesStored: number;
}

/** Trigger-written only. Clients have no write access at all. */
export interface ActivityDoc {
  type: ActivityType;
  actorUid: string;
  at: number;
  from?: string;
  to?: string;
}

/** Trigger-written. The client may only flip `read`. */
export interface NotificationDoc {
  type: NotifyEvent;
  boardId: string;
  cardId?: string;
  actorUid: string;
  text: string;
  read: boolean;
  at: number;
}
