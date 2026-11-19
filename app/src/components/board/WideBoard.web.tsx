/**
 * The WIDE board, WEB build: horizontal columns with real HTML5 drag-and-drop.
 *
 * Chosen by available width (see app/src/theme/layout.ts), so a wide browser
 * window gets this and a narrow one does not. The sibling WideBoard.tsx is the
 * native build of the same layout for tablets, which cannot use HTML5 drag and
 * offers an explicit move affordance instead.
 *
 * react-native-web is React DOM underneath, so this file uses plain DOM elements
 * and the HTML5 drag-and-drop API directly. That is far more robust than
 * emulating dragging with PanResponder, and it gives native cursor feedback and
 * auto-scroll for free. The native board (BoardScreen.tsx) is a different
 * layout entirely — swipe-paged columns with an explicit "Move to…" — which is
 * why these are platform seams rather than one responsive component.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  archiveCard,
  cardsInColumn,
  createCard,
  moveCard,
  rerankColumnIfNeeded,
  useBoardCards,
  type Card,
} from '../../cards';
import { updateBoard, useBoard, type BoardMemberProfile } from '../../boards';
import { CardFace } from '../CardFace';
import { ColumnNameEditor } from '../ColumnNameEditor';
import { useSelection } from '../../useSelection';
import { createAutoScroller } from './autoScroll';
import { BulkBar } from '../BulkBar';
import { IconAction, LoadError } from '../ui';
import { NewCardBell, WatchColumnBell } from './Bells';
import { LaneHeading } from './LaneHeading';
import { LaneCollapseActions } from './LaneCollapseActions';
import { useLaneCollapse } from './useLaneCollapse';
import { allowMove } from '../../moveGuard';
import { useLaneInfo } from './useLaneInfo';
import { setColumnWatched, useWatchedColumns } from '../../notifications';
import {
  CARD_TITLE_MAX,
  canManageBoard,
  columnDeleteBlocked,
  columnsPatch,
  finishedColumnDeleteNote,
  groupByLane,
  isFinished,
  laneOf,
  lanesLive,
  parentTitles,
  subtaskCounts,
  watchKey,
  type BoardColumn,
  type BoardLane,
  type Label,
} from '@sabeel/shared';
import type { SessionUser } from '../../session';
import { useNav } from '../../nav';
import { acceptsDrop, dropPlacement } from '../../boardDrop';
import type { AddCardDraft } from './AddCardForm';
import { useListenerError } from '../../liveQuery';
import { useLabels } from '../../labels';
import { toUserMessage } from '../../errors';
import { getTheme, radius, space, type Theme } from '../../theme';

type DragState = { cardId: string; fromColumnId: string } | null;

/**
 * Where a dragged card would land. On a board with lanes, a column holds the
 * board's lanes, so the place is a lane too: `index` counts that lane's cards
 * in the column, and `laneId` null is No lane. Without lanes `laneId` is
 * absent and `index` counts the column.
 */
type DropTarget = { columnId: string; laneId?: string | null; index: number };

/** Stable empty, so the selection hook does not churn on every render. */
const EMPTY_CARDS: Card[] = [];
const NO_MEMBERS: BoardMemberProfile[] = [];
const NO_LABELS: Label[] = [];

function useWebTheme(): Theme {
  return getTheme();
}

function CardTile({
  card,
  labels,
  boardMembers,
  subtaskCount,
  parentTitle,
  finished,
  t,
  canEdit,
  selected,
  onOpen,
  onArchive,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  card: Card;
  labels: readonly Label[];
  boardMembers: readonly BoardMemberProfile[];
  subtaskCount?: number;
  parentTitle?: string;
  finished: boolean;
  t: Theme;
  canEdit: boolean;
  selected: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onToggleSelect: (shiftKey: boolean) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  return (
    <div
      draggable={canEdit}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      data-testid={`card-${card.title}`}
      style={{
        background: selected ? t.bg.accentSoft : t.bg.surface,
        border: `${selected ? 2 : 1}px solid ${
          selected ? t.accent.base : t.border.subtle
        }`,
        borderRadius: radius.md,
        padding: space.md,
        marginBottom: space.sm,
        cursor: canEdit ? 'grab' : 'pointer',
        opacity: dragging ? 0.4 : 1,
        boxShadow: `0 1px 2px ${t.effect.shadow}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: space.sm }}>
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${card.title}`}
          // Shift-click extends from the last touched card — the convention
          // everyone already knows from file managers and mail clients.
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(e.shiftKey);
          }}
          onChange={() => {}}
          style={{ marginTop: 3, accentColor: t.accent.base, cursor: 'pointer' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <CardFace
            card={card}
            labels={labels}
            boardMembers={boardMembers}
            subtaskCount={subtaskCount}
            parentTitle={parentTitle}
            finished={finished}
          />
        </div>
      </div>
      {canEdit ? (
        <div style={{ display: 'flex', marginTop: space.sm }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            aria-label={`Archive ${card.title}`}
            style={{
              marginLeft: 'auto',
              background: 'transparent',
              border: 'none',
              color: t.text.muted,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Archive
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The add-card composer, owning its own draft.
 *
 * Same reason as the native `AddCardForm`: the title used to live in
 * `WideBoard`'s state, so each character re-rendered every column, every tile
 * and the drag machinery with them.
 *
 * DELIBERATELY NOT the shared `AddCardForm`. This is a raw DOM <input> with
 * inline styles and its own key handling, and this surface has the strictest
 * screenshot coverage in the repo — swapping in the React Native control would
 * change the visible composer and the button's label ("Add card", not "Add")
 * for no gain. The duplication here is a rendering difference, not a rule.
 *
 * MODULE LEVEL, and it has to stay there. Declared inside `WideBoard` it would
 * get a fresh identity on every render, so React would unmount and remount it
 * on each keystroke — losing focus and the caret, which is worse than the
 * re-render it is here to prevent.
 *
 * Escape is the ONLY way to dismiss this composer: there is no Cancel button.
 * Discarding is free because the draft is local — the parent clears `adding`,
 * this unmounts, and the text goes with it.
 */
function WebAddCardForm({
  onAdd,
  onCancel,
  canSubscribe,
  lanes,
  initial,
}: {
  /** Called with a trimmed, non-empty title, whether to subscribe to it, and
   *  its lane on a board with lanes. */
  onAdd: (title: string, subscribe: boolean, laneId?: string) => void;
  onCancel: () => void;
  /** Whether the bell is offered: only a member of the board may subscribe. */
  canSubscribe: boolean;
  /** The board's lanes when they are live; absent on a board without them. */
  lanes?: readonly BoardLane[];
  /** What a refused add held, to start from instead of an empty form. */
  initial?: AddCardDraft;
}) {
  const t = useWebTheme();
  const [title, setTitle] = useState(initial?.title ?? '');
  // Unmount-scoped like the draft, so every new composer starts subscribed.
  const [subscribe, setSubscribe] = useState(initial?.subscribe ?? true);
  // None chosen to start, as in the native form: see `AddCardForm`.
  // A lane given back is kept only while the board still has it.
  const [laneId, setLaneId] = useState(
    initial?.laneId && lanes?.some((l) => l.id === initial.laneId) ? initial.laneId : '',
  );
  const [needsLane, setNeedsLane] = useState(false);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (lanes && !laneId) {
      setNeedsLane(true);
      return;
    }
    onAdd(trimmed, canSubscribe && subscribe, lanes ? laneId : undefined);
  }

  return (
    <div>
      <input
        autoFocus
        value={title}
        placeholder="Card title"
        maxLength={CARD_TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: space.sm,
          borderRadius: radius.sm,
          border: `1px solid ${t.border.subtle}`,
          background: t.bg.surface,
          color: t.text.primary,
        }}
      />
      {lanes ? (
        <>
          <select
            aria-label="Lane"
            value={laneId}
            onChange={(e) => {
              setLaneId(e.target.value);
              if (e.target.value) setNeedsLane(false);
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginTop: space.sm,
              padding: space.sm,
              borderRadius: radius.sm,
              border: `1px solid ${t.border.subtle}`,
              background: t.bg.surface,
              color: t.text.primary,
              colorScheme: 'light',
            }}
          >
            <option value="">Choose a lane</option>
            {lanes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          {needsLane ? (
            <div style={{ color: t.text.secondary, fontSize: 12, marginTop: space.xs }}>
              Choose a lane for the card first.
            </div>
          ) : null}
        </>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        <button onClick={submit} style={primaryBtn(t)}>
          Add card
        </button>
        {canSubscribe ? (
          <NewCardBell on={subscribe} onToggle={() => setSubscribe((on) => !on)} />
        ) : null}
      </div>
    </div>
  );
}

export function WideBoard({ boardId, user }: { boardId: string; user: SessionUser }) {
  const nav = useNav();
  const board = useBoard(boardId);
  // Board authority, computed once. It is per-board now, so it cannot come from
  // `sessionCan` — a helper taking no board would be a button that always fails.
  const canManage = canManageBoard(user, board.data);
  const cards = useBoardCards(boardId);
  const listenerError = useListenerError();
  const t = useWebTheme();

  const [drag, setDrag] = useState<DragState>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [retry, setRetry] = useState<(AddCardDraft & { columnId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which column is mid-rename. Its delete button steps aside while editing, so
  // the cancel ✕ and the delete ✕ are never sitting next to each other.
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BoardColumn | null>(null);
  const selection = useSelection(cards.data ?? EMPTY_CARDS);

  // Auto-scroll during drag. The HTML5 drag API will not scroll a container
  // when the pointer reaches its edge, so without this a card can only be
  // dropped somewhere already on screen — on a wide board or a long column the
  // destination is simply unreachable.
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const cardListRefs = useRef(new Map<string, HTMLDivElement>());
  const autoScroll = useMemo(() => createAutoScroller(), []);

  // Stop the loop if the component goes away mid-drag.
  useEffect(() => () => autoScroll.stop(), [autoScroll]);

  /** Scroll the board horizontally, and whichever column is under the pointer. */
  const driveAutoScroll = useCallback(
    (clientX: number, clientY: number, columnId: string | null) => {
      const targets = [];
      if (columnsRef.current) targets.push({ el: columnsRef.current, axis: 'x' as const });
      const list = columnId ? cardListRefs.current.get(columnId) : undefined;
      if (list) targets.push({ el: list, axis: 'y' as const });
      autoScroll.update(clientX, clientY, targets);
    },
    [autoScroll],
  );

  // From the BOARD, not the user directory — only admins may list users.
  const members = board.data?.members ?? NO_MEMBERS;
  // Only a member may subscribe to a card or watch a column: rules hold
  // subscribers to members, and the notice sweep sends arrivals to members
  // alone, so an admin visiting a board they are not on gets neither bell.
  const isMember = board.data?.memberUids.includes(user.uid) ?? false;
  const watched = useWatchedColumns(user);
  // The bells stay disabled until the list is ready: `?? []` reads a list
  // still loading, or one that failed, as watching nothing.
  const watching = (columnId: string) =>
    (watched.data ?? []).includes(watchKey(boardId, columnId));
  // Every label, of both scopes: a card's chips resolve against the lot.
  const allLabels = useLabels();
  const labels = allLabels.data ?? NO_LABELS;

  const canEdit = true; // any board member may edit cards

  // Derived, not stored — the board already holds every card it needs.
  const subtasksBy = useMemo(() => subtaskCounts(cards.data ?? EMPTY_CARDS), [cards.data]);
  const parentsBy = useMemo(() => parentTitles(cards.data ?? EMPTY_CARDS), [cards.data]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const col of board.data?.columns ?? []) {
      map.set(col.id, cardsInColumn(cards.data ?? [], col.id));
    }
    return map;
  }, [board.data?.columns, cards.data]);

  // Lanes, on a board that uses them: each column draws the board's lanes in
  // order (decision A, 2026-11-15: headings inside each column, as the phone
  // does, not bands across the board).
  const laneBoard = board.data;
  const live = laneBoard ? lanesLive(laneBoard) : false;
  const infoByLane = useLaneInfo(laneBoard ?? null, live, cards.data ?? EMPTY_CARDS);
  const collapse = useLaneCollapse(
    user,
    boardId,
    laneBoard ?? null,
    live,
    cards.data ?? EMPTY_CARDS,
    selection.deselect,
  );

  const drop = useCallback(
    async (target: DropTarget, cardIdFromEvent: string | null) => {
      const { columnId, index } = target;
      // The card id comes from the DataTransfer, not from React state.
      //
      // State is set in onDragStart, but React batches updates — a drop handled
      // in the same task still sees the OLD state and the move is silently
      // dropped. Carrying the payload on the event is both how HTML5 drag and
      // drop is meant to work and immune to render timing.
      const cardId = cardIdFromEvent || drag?.cardId || null;
      autoScroll.stop();
      setDrag(null);
      setDropTarget(null);
      if (!cardId) return;

      const moving = (cards.data ?? []).find((c) => c.id === cardId);
      if (!moving) return;
      // A parent waits for its subtasks, and a subtask is not reopened under
      // a finished parent (#111): the card stays where it was, and a notice
      // says why.
      if (
        laneBoard &&
        !(await allowMove({
          board: laneBoard,
          boardId,
          toColumnId: columnId,
          moving: [moving],
          cards: cards.data ?? [],
        }))
      ) {
        return;
      }

      const drawnColumn = byColumn.get(columnId) ?? [];
      const column = drawnColumn.filter((c) => c.id !== moving.id);
      // With lanes, `index` is a position in the target lane's cards as this
      // column draws them, and the new rank falls between two of them; other
      // lanes' cards in between are no matter, since each lane draws the
      // column's order filtered. `dropPlacement` has the index rules.
      const inLane = target.laneId !== undefined && laneBoard;
      const group = inLane
        ? drawnColumn.filter((c) => laneOf(c, laneBoard) === target.laneId)
        : drawnColumn;
      const place = dropPlacement(group, index, moving.id);
      if (!place) return;

      try {
        await moveCard({
          card: moving,
          toColumnId: columnId,
          // No lane is never written: a card is placed, not unplaced.
          ...(inLane && target.laneId ? { toLaneId: target.laneId } : {}),
          before: place.before,
          after: place.after,
          user,
        });
        // Background tidy-up; never blocks the user.
        void rerankColumnIfNeeded(column).catch(() => {});
        // Dropped on a folded lane's heading: open it, so the card is seen
        // landing rather than vanishing.
        if (inLane && target.laneId) void collapse.reveal(target.laneId);
      } catch (e) {
        setError(toUserMessage(e, 'moveCard'));
      }
    },
    [drag, cards.data, byColumn, laneBoard, boardId, user, autoScroll, collapse],
  );

  // The title comes from `WebAddCardForm`, already trimmed and non-empty — the
  // draft lives there so typing one does not re-render the board.
  // The form closes at once: the card is on the board at once (Firestore
  // draws a write before the server confirms it), and an add made offline
  // waits in the queue. Closing only once the server answered left a form
  // open over its own card, and closed whatever form was open by then. A
  // REFUSED add is given back instead: its form reopens with what was typed
  // (`retry`), in front of the error.
  async function addCard(columnId: string, title: string, subscribe: boolean, laneId?: string) {
    setAdding(null);
    // Only this column's: a refused add waiting elsewhere is kept.
    setRetry((r) => (r?.columnId === columnId ? null : r));
    // The card is drawn at once; a folded lane would swallow it from view.
    if (laneId) void collapse.reveal(laneId);
    try {
      await createCard({
        boardId,
        columnId,
        title,
        user,
        columnCards: byColumn.get(columnId) ?? [],
        subscribe,
        laneId,
      });
    } catch (e) {
      setError(toUserMessage(e, 'createCard'));
      setRetry({ columnId, title, subscribe, laneId });
    }
  }

  async function saveColumns(next: BoardColumn[]) {
    // Same shape as removeColumn below: this surface reports failures through its
    // own `error` banner rather than useAction.
    await updateBoard(boardId, columnsPatch(board.data ?? { columns: next }, next));
  }

  /**
   * This board's stand-in for `useAction`'s `run`: report, and swallow.
   *
   * `ColumnNameEditor` needs a runner that catches, because it closes the field
   * only once the write resolves — so the write it is handed must be free to
   * reject. Every other caller passes `useAction`'s `run`; this surface has
   * always reported through its own banner instead, so it supplies the same
   * contract locally rather than growing a second error channel.
   */
  function runReporting(fn: () => Promise<unknown>) {
    void fn().catch((e: unknown) => setError(toUserMessage(e, 'board')));
  }

  /**
   * Deleting a column is irreversible and sits one click away, so it ASKS.
   * Emptiness is not consent — an empty column can still be one someone just
   * cleared and is about to refill.
   */
  function askRemoveColumn(col: BoardColumn) {
    const blocked = columnDeleteBlocked(col.name, (byColumn.get(col.id) ?? []).length);
    if (blocked) {
      setError(blocked);
      return;
    }
    setPendingDelete(col);
  }

  function confirmRemoveColumn(col: BoardColumn) {
    setPendingDelete(null);
    // Through the runner, because `saveColumns` now lets failures out — the
    // rename needs that to keep its field open. Deleting has no field to keep,
    // so it just reports.
    runReporting(() =>
      saveColumns((board.data?.columns ?? []).filter((c) => c.id !== col.id)),
    );
  }

  if (board.status === 'loading' || cards.status === 'loading') {
    return (
      <div style={{ padding: space.xl, color: t.text.muted, background: t.bg.canvas }}>
        Loading board…
      </div>
    );
  }

  // A failed cards query used to render a board with every column and no cards
  // at all — indistinguishable from someone having deleted the lot.
  if (cards.status === 'error') {
    return (
      <div style={{ padding: space.xl, background: t.bg.canvas, minHeight: '100%' }}>
        <button onClick={() => nav.reset({ name: 'boards' })} style={btn(t)}>
          All boards
        </button>
        <div style={{ marginTop: space.md }}>
          <LoadError what="this board" code={cards.error} />
        </div>
      </div>
    );
  }

  const b = board.data;
  if (!b) {
    // A refused read is not a missing board — see NarrowBoard.
    return (
      <div style={{ padding: space.xl, background: t.bg.canvas, color: t.text.primary }}>
        <h2>{board.status === 'error' ? 'Board unavailable' : 'Board not found'}</h2>
        {board.status === 'error' ? <LoadError what="this board" code={board.error} /> : null}
        {/* btn(t) like its sibling above — this one shipped with no style
            prop at all, so it rendered as a raw browser button. */}
        <button onClick={() => nav.reset({ name: 'boards' })} style={btn(t)}>
          All boards
        </button>
      </div>
    );
  }

  // The card being dragged, for where a drop outside any lane lands.
  const dragged = drag ? (cards.data ?? []).find((c) => c.id === drag.cardId) : undefined;

  return (
    <div
      style={{
        background: t.bg.canvas,
        // A FIXED viewport height, not minHeight: the board owns the screen and
        // the columns scroll inside it. With minHeight the page itself grew and
        // scrolled, which is the wrong structure for a board and makes vertical
        // dragging worse — you would be scrolling the document, not the column.
        height: '100vh',
        padding: space.lg,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: space.md,
        }}
      >
        <h1
          style={{
            color: t.text.primary,
            margin: 0,
            fontSize: 22,
            // Truncate a long board name instead of shoving the icons aside.
            minWidth: 0,
            flexShrink: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {b.name}
        </h1>
        <div style={{ display: 'flex', gap: space.xs, flexShrink: 0 }}>
          {/* Everyone, not just owners: members can archive, so members must
              be able to un-archive. */}
          {live ? <LaneCollapseActions collapse={collapse} /> : null}
          <IconAction
            icon="inventory-2"
            label="Archived cards"
            onPress={() => nav.push({ name: 'boardArchive', boardId })}
          />
          {/* Always present, because a non-owner now has something to open: the
              roster, read-only, which answers "who do I ask to add someone?" without
              a trip to an admin. The NAME changes with what it opens — calling it
              Board settings for someone who gets only the member list would be a
              control that does not say what it does. */}
          <IconAction
            icon={canManage ? 'settings' : 'group'}
            label={canManage ? 'Board settings' : 'About this board'}
            onPress={() => nav.push({ name: 'boardSettings', boardId })}
          />
          <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
        </div>
      </div>

      {selection.active ? (
        <BulkBar
          canManage={canManage}
          currentBoardId={boardId}
          columns={b.columns}
          lanes={live && laneBoard ? laneBoard.lanes : undefined}
          doneColumnId={laneBoard?.doneColumnId}
          allCards={cards.data ?? []}
          selection={selection}
          members={members}
          user={user}
          onError={setError}
        />
      ) : null}

      {listenerError ? (
        <div style={banner(t)}>{listenerError}</div>
      ) : null}
      {/* Destructive and irreversible, so it gets a labelled button and a
          sentence — not an icon you can brush past. */}
      {/* Gated with the icon that opens it — see the native sibling. */}
      {canManage && pendingDelete ? (
        <div style={banner(t)}>
          Delete the column “{pendingDelete.name}”? It is empty, but this cannot be
          undone.{' '}
          {board.data ? `${finishedColumnDeleteNote(board.data, pendingDelete.id) ?? ''} ` : ''}
          <button
            onClick={() => confirmRemoveColumn(pendingDelete)}
            style={{ ...btn(t), marginLeft: 8, color: t.text.danger }}
          >
            Delete column
          </button>
          <button
            onClick={() => setPendingDelete(null)}
            style={{ ...btn(t), marginLeft: 8 }}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {error ? (
        <div style={banner(t)}>
          {error}{' '}
          <button onClick={() => setError(null)} style={{ ...btn(t), marginLeft: 8 }}>
            Dismiss
          </button>
        </div>
      ) : null}
      {collapse.error ? (
        <div style={banner(t)}>
          {collapse.error}{' '}
          <button onClick={collapse.clearError} style={{ ...btn(t), marginLeft: 8 }}>
            Dismiss
          </button>
        </div>
      ) : null}

      <div
        ref={columnsRef}
        data-testid="board-columns"
        onDragOver={(e) => {
          e.preventDefault();
          // Gaps between columns, and the empty space past the last one, are
          // exactly where someone parks the pointer to scroll the board.
          driveAutoScroll(e.clientX, e.clientY, null);
        }}
        style={{
          display: 'flex',
          gap: space.md,
          alignItems: 'flex-start',
          overflowX: 'auto',
          overflowY: 'hidden',
          flex: 1,
          minHeight: 0,
          paddingBottom: space.lg,
        }}
      >
        {b.columns.map((col) => {
          const colCards = byColumn.get(col.id) ?? [];
          const groups = live && laneBoard ? groupByLane(colCards, laneBoard, cards.data ?? EMPTY_CARDS) : null;
          // The order the column DRAWS its cards in, which shift-click follows.
          // Folded lanes' cards are not drawn, so a range never takes them.
          const drawn = groups ? collapse.visible(groups.flatMap((g) => g.cards)) : colCards;
          // Dropped anywhere in the column but a lane: the end of the dragged
          // card's own lane, or of the column on a board without lanes. The
          // index counts the group as drawn, the dragged card included, so the
          // bar is drawn after its last card (`dropPlacement`).
          const draggedLane = dragged && laneBoard && live ? laneOf(dragged, laneBoard) : null;
          const columnEnd: DropTarget = groups
            ? {
                columnId: col.id,
                laneId: draggedLane,
                index: colCards.filter((c) => laneOf(c, laneBoard!) === draggedLane).length,
              }
            : { columnId: col.id, index: colCards.length };
          const marks = (laneId: string | null | undefined, i: number) =>
            dropTarget?.columnId === col.id &&
            dropTarget.laneId === laneId &&
            dropTarget.index === i;
          const dropBar = (
            <div
              style={{
                height: 3,
                background: t.accent.base,
                borderRadius: 2,
                marginBottom: space.sm,
              }}
            />
          );
          const renderCard = (card: Card, i: number, laneId: string | null | undefined) => (
            <div
              key={card.id}
              onDragOver={(e) => {
                // Refused as its lane's group refuses it, or the bar would be
                // drawn where the card will not go: left to the column, which
                // takes it to the end of its own lane.
                if (!acceptsDrop(laneId, draggedLane)) return;
                e.preventDefault();
                e.stopPropagation();
                if (drag) setDropTarget({ columnId: col.id, laneId, index: i });
                // stopPropagation above means the column handler will not
                // fire, so drive it here too — otherwise scrolling dies the
                // moment the pointer passes over a card.
                driveAutoScroll(e.clientX, e.clientY, col.id);
              }}
            >
              {marks(laneId, i) ? dropBar : null}
              <CardTile
                card={card}
                labels={labels}
                boardMembers={members}
                subtaskCount={subtasksBy.get(card.id)}
                parentTitle={parentsBy.get(card.id)}
                finished={isFinished(card, b)}
                t={t}
                canEdit={canEdit}
                selected={selection.isSelected(card.id)}
                dragging={drag?.cardId === card.id}
                onToggleSelect={(shiftKey) =>
                  shiftKey
                    ? selection.selectRangeTo(card.id, drawn)
                    : selection.toggle(card.id)
                }
                onOpen={() =>
                  selection.active
                    ? selection.toggle(card.id)
                    : nav.push({ name: 'card', boardId, cardId: card.id })
                }
                onArchive={() => archiveCard(card.id, user)}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', card.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDrag({ cardId: card.id, fromColumnId: col.id });
                }}
                onDragEnd={() => {
                  autoScroll.stop();
                  setDrag(null);
                  setDropTarget(null);
                }}
              />
            </div>
          );
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag) setDropTarget(columnEnd);
                driveAutoScroll(e.clientX, e.clientY, col.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void drop(
                  dropTarget?.columnId === col.id ? dropTarget : columnEnd,
                  e.dataTransfer.getData('text/plain') || null,
                );
              }}
              style={{
                background: t.bg.inset,
                borderRadius: radius.lg,
                padding: space.md,
                minWidth: 280,
                maxWidth: 320,
                flex: '0 0 auto',
                maxHeight: '100%',
                display: 'flex',
                flexDirection: 'column',
                border:
                  dropTarget?.columnId === col.id
                    ? `2px solid ${t.accent.base}`
                    : '2px solid transparent',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: space.sm,
                }}
              >
                {/* The same RN editor the other three surfaces use — renders to
                    DOM through react-native-web, as CardFace already does inside
                    this very column. One rename implementation, not four. */}
                <ColumnNameEditor
                  column={col}
                  columns={b.columns}
                  canEdit={canManage}
                  suffix={` (${colCards.length})`}
                  bold
                  onError={setError}
                  onRename={saveColumns}
                  run={runReporting}
                  onEditingChange={(on) => setRenamingCol(on ? col.id : null)}
                />
                {/* Together at the right: the header spaces its children
                    apart, and a third one would sit in the middle. */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {isMember && renamingCol !== col.id ? (
                    <WatchColumnBell
                      columnName={col.name}
                      watching={watching(col.id)}
                      busy={watched.status !== 'ready'}
                      onPress={() =>
                        runReporting(() =>
                          setColumnWatched(user, boardId, col.id, !watching(col.id)),
                        )
                      }
                    />
                  ) : null}
                  {canManage && renamingCol !== col.id ? (
                    <button
                      onClick={() => askRemoveColumn(col)}
                      aria-label={`Delete column ${col.name}`}
                      style={{ ...btn(t), fontSize: 12 }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              </div>

              <div
                ref={(el) => {
                  if (el) cardListRefs.current.set(col.id, el);
                  else cardListRefs.current.delete(col.id);
                }}
                data-testid={`column-cards-${col.name}`}
                style={{
                  overflowY: 'auto',
                  overflowX: 'hidden',
                  flex: 1,
                  minHeight: 0,
                }}
              >
              {groups
                ? groups.map((g) => {
                    const laneId = g.lane?.id ?? null;
                    // A card with a lane is not dropped INTO No lane, as the
                    // card screen never offers it one; over No lane such a
                    // card falls through to the column, keeping its lane.
                    const into = (index: number) => (e: React.DragEvent) => {
                      if (!acceptsDrop(laneId, draggedLane)) return;
                      e.preventDefault();
                      e.stopPropagation();
                      if (drag) setDropTarget({ columnId: col.id, laneId, index });
                      driveAutoScroll(e.clientX, e.clientY, col.id);
                    };
                    // Collapsed, the lane keeps its heading and takes a drop
                    // at its top: the bar shows under the heading, and the
                    // card lands first in the lane, as a drop on any heading
                    // does.
                    const folded = collapse.isCollapsed(laneId);
                    return (
                      <div key={laneId ?? 'none'} onDragOver={into(folded ? 0 : g.cards.length)}>
                        {/* Over the heading: the top of the lane. */}
                        <div onDragOver={into(0)}>
                          <LaneHeading
                            name={g.lane?.name ?? 'No lane'}
                            info={g.lane ? (infoByLane.get(g.lane.id) ?? null) : null}
                            collapsed={folded}
                            onToggle={() => void collapse.toggle(laneId)}
                            here={g.cards.length}
                          />
                        </div>
                        <div style={{ height: space.xs }} />
                        {folded ? (
                          marks(laneId, 0) ? dropBar : null
                        ) : (
                          <>
                            {g.cards.map((card, i) => renderCard(card, i, laneId))}
                            {marks(laneId, g.cards.length) ? dropBar : null}
                          </>
                        )}
                      </div>
                    );
                  })
                : colCards.map((card, i) => renderCard(card, i, undefined))}

              </div>

              {/* A refused add reopens here, unless another form is open. */}
              {adding === col.id || (adding === null && retry?.columnId === col.id) ? (
                <WebAddCardForm
                  onAdd={(title, subscribe, laneId) =>
                    void addCard(col.id, title, subscribe, laneId)
                  }
                  canSubscribe={isMember}
                  lanes={live && laneBoard ? laneBoard.lanes : undefined}
                  initial={retry?.columnId === col.id ? retry : undefined}
                  onCancel={() => {
                    setAdding(null);
                    setRetry((r) => (r?.columnId === col.id ? null : r));
                  }}
                />
              ) : (
                <button onClick={() => setAdding(col.id)} style={{ ...btn(t), width: '100%' }}>
                  + Add card
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function btn(t: Theme): React.CSSProperties {
  return {
    background: t.bg.surface,
    color: t.text.primary,
    border: `1px solid ${t.border.subtle}`,
    borderRadius: radius.sm,
    padding: `${space.sm}px ${space.md}px`,
    cursor: 'pointer',
  };
}

function primaryBtn(t: Theme): React.CSSProperties {
  return {
    background: t.accent.base,
    color: t.accent.onAccent,
    border: 'none',
    borderRadius: radius.sm,
    padding: `${space.sm}px ${space.md}px`,
    cursor: 'pointer',
    marginTop: space.sm,
    width: '100%',
  };
}

function banner(t: Theme): React.CSSProperties {
  return {
    background: t.bg.dangerSoft,
    color: t.text.danger,
    padding: space.sm,
    borderRadius: radius.sm,
    marginBottom: space.sm,
    fontSize: 13,
  };
}
