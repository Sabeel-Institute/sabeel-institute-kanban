/**
 * The WIDE board, WEB build: horizontal columns with real HTML5 drag-and-drop,
 * and on a board with live lanes a GRID (Faisal, 2026-11-19): columns across
 * the top, lanes down the left, each lane a row as tall as its fullest cell,
 * the column headings and lane names frozen like a spreadsheet's. One bell per
 * column and one per lane; a + on each heading adds a card, asking only for
 * the other coordinate. Renaming and deleting a column are Board settings'.
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
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  archiveCard,
  cardsInColumn,
  createCard,
  moveCard,
  rerankColumnIfNeeded,
  useBoardCards,
  type Card,
} from '../../cards';
import { useBoard, type BoardMemberProfile } from '../../boards';
import { CardFace } from '../CardFace';
import { useSelection } from '../../useSelection';
import { createAutoScroller } from './autoScroll';
import { BulkBar } from '../BulkBar';
import { IconAction, LoadError } from '../ui';
import { NewCardBell, WatchColumnBell, WatchLaneBell } from './Bells';
import { ColumnHeading } from './ColumnHeading';
import { LaneHeading } from './LaneHeading';
import { LaneCollapseActions } from './LaneCollapseActions';
import { useLaneCollapse } from './useLaneCollapse';
import { useLaneWatch } from './useLaneWatch';
import { allowMove } from '../../moveGuard';
import { useLaneInfo } from './useLaneInfo';
import { setColumnWatched, useWatchedColumns } from '../../notifications';
import {
  CARD_TITLE_MAX,
  bucketFor,
  canManageBoard,
  groupByLane,
  isFinished,
  laneOf,
  lanesLive,
  parentTitles,
  subtaskCounts,
  todayInOrgTz,
  watchKey,
  type Label,
} from '@sabeel/shared';
import type { SessionUser } from '../../session';
import { useNav } from '../../nav';
import { acceptsDrop, dropPlacement } from '../../boardDrop';
import type { AddCardDraft } from './AddCardForm';
import { useListenerError } from '../../liveQuery';
import { useLabels } from '../../labels';
import { setNotesOpen, useBoardNotes, useLatestNotesVersion, useNotesOpen } from '../../boardNotes';
import { NotesPanel } from '../notes/NotesPanel';
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
 *
 * With `pick`, it is the lane grid's form: its place is half given (the
 * column of the + it opened from, or the lane), and it asks for the other
 * half with nothing chosen to start and nothing remembered between cards
 * (Faisal, 2026-11-15: a lane picked for you is a card filed in the wrong
 * place; the column follows the same rule).
 */
function WebAddCardForm({
  onAdd,
  onCancel,
  canSubscribe,
  pick,
  initial,
}: {
  /** Called with a trimmed, non-empty title, whether to subscribe to it, and
   *  the picked id when the form asks for one. */
  onAdd: (title: string, subscribe: boolean, picked?: string) => void;
  onCancel: () => void;
  /** Whether the bell is offered: only a member of the board may subscribe. */
  canSubscribe: boolean;
  /** The other half of the card's place, on the lane grid. */
  pick?: { what: 'lane' | 'column'; choices: readonly { id: string; name: string }[] };
  /** What a refused add held, to start from instead of an empty form. */
  initial?: { title: string; subscribe: boolean; picked?: string };
}) {
  const t = useWebTheme();
  const [title, setTitle] = useState(initial?.title ?? '');
  // Unmount-scoped like the draft, so every new composer starts subscribed.
  const [subscribe, setSubscribe] = useState(initial?.subscribe ?? true);
  // A choice given back is kept only while the board still has it.
  const [picked, setPicked] = useState(
    initial?.picked && pick?.choices.some((c) => c.id === initial.picked) ? initial.picked : '',
  );
  const [needsPick, setNeedsPick] = useState(false);
  const what = pick?.what === 'column' ? 'column' : 'lane';

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (pick && !picked) {
      setNeedsPick(true);
      return;
    }
    onAdd(trimmed, canSubscribe && subscribe, pick ? picked : undefined);
  }

  return (
    <div>
      <input
        autoFocus
        value={title}
        placeholder="Card title"
        aria-label="Card title"
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
      {pick ? (
        <>
          <select
            aria-label={what === 'lane' ? 'Lane' : 'Column'}
            value={picked}
            onChange={(e) => {
              setPicked(e.target.value);
              if (e.target.value) setNeedsPick(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
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
            <option value="">{what === 'lane' ? 'Choose a lane' : 'Choose a column'}</option>
            {pick.choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {needsPick ? (
            <div style={{ color: t.text.secondary, fontSize: 12, marginTop: space.xs }}>
              {what === 'lane' ? 'Choose a lane for the card first.' : 'Choose a column for the card first.'}
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

/**
 * The lane grid's add form, floating beside the + it opened from. Drawn in
 * the page's top layer (a portal), so no sticky heading or scroll area clips
 * it, and placed from the +'s position on every scroll of the grid and every
 * resize: it follows its + rather than closing. A form that closed on a
 * scroll lost the start of a title typed while a scroll was still running
 * (the design mock, 2026-11-19).
 */
function FloatingForm({
  anchor,
  scroller,
  side,
  label,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  scroller: HTMLElement | null;
  /** Under the + (a column heading's) or beside it (a lane's). */
  side: 'below' | 'beside';
  label: string;
  /** The form's ✕: a touch screen has no Escape key. */
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useWebTheme();
  const box = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  // Placed after every render as well as on every scroll and resize: a
  // banner or a card arriving above the + moves it without either.
  function place() {
    const r = anchor.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? FORM_WIDTH;
    const h = box.current?.offsetHeight ?? 0;
    const want =
      side === 'below'
        ? { left: r.right - w, top: r.bottom + space.xs }
        : { left: r.right + space.xs, top: r.top };
    const next = {
      left: Math.max(space.md, Math.min(want.left, window.innerWidth - w - space.md)),
      top: Math.max(space.md, Math.min(want.top, window.innerHeight - h - space.md)),
    };
    setAt((was) => (was && was.left === next.left && was.top === next.top ? was : next));
  }
  const placeNow = useRef(place);
  placeNow.current = place;
  useLayoutEffect(() => placeNow.current());
  useLayoutEffect(() => {
    const follow = () => placeNow.current();
    scroller?.addEventListener('scroll', follow, { passive: true });
    window.addEventListener('resize', follow);
    return () => {
      scroller?.removeEventListener('scroll', follow);
      window.removeEventListener('resize', follow);
    };
  }, [scroller]);
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed',
        left: at?.left ?? -9999,
        top: at?.top ?? -9999,
        zIndex: 50,
        width: FORM_WIDTH,
        maxWidth: `calc(100vw - ${space.md * 2}px)`,
        boxSizing: 'border-box',
        background: t.bg.raised,
        border: `1px solid ${t.border.strong}`,
        borderRadius: radius.lg,
        boxShadow: `0 10px 30px ${t.effect.shadow}`,
        padding: space.md,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space.xs, marginBottom: space.xs }}>
        <div style={{ flex: 1, minWidth: 0, fontWeight: 700, color: t.text.primary }}>{label}</div>
        <IconAction icon="close" label="Cancel" onPress={onClose} />
      </div>
      {children}
    </div>,
    document.body,
  );
}

const FORM_WIDTH = 300;
/** The grid's tracks: the lane names, and each column. */
const LANE_TRACK = 232;
const COLUMN_TRACK = 296;
/** A cell with nothing in it still takes a drop. */
const CELL_MIN_HEIGHT = 64;

/** Where the grid's add form is open: under a column's + or beside a lane's. */
type GridAdd = { from: 'column' | 'lane'; id: string };

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
  // A column's composer (boards without lanes) by column id.
  const [adding, setAdding] = useState<string | null>(null);
  // The lane grid's form, under a column's + or beside a lane's.
  const [gridAdd, setGridAdd] = useState<GridAdd | null>(null);
  // A refused add, given back to the form it came from: `key` is the column
  // id, or the grid form's `column:<id>` / `lane:<id>`.
  const [retry, setRetry] = useState<(AddCardDraft & { key: string; columnId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The +s the grid's form hangs from, by `column:<id>` / `lane:<id>`.
  const plusRefs = useRef(new Map<string, HTMLElement>());
  // The grid's heading row, measured: a lane's name stays just under it while
  // its row scrolls by.
  // An element in state, not a ref: the row mounts only once the board and
  // its cards are in, after the first render, and the observer must follow
  // it (a ref read in an effect missed it and left lane names at 0, under
  // the headings).
  const [headingRow, setHeadingRow] = useState<HTMLDivElement | null>(null);
  const [headingHeight, setHeadingHeight] = useState(0);
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

  /**
   * Scroll the board horizontally, and whichever column is under the pointer;
   * the lane grid scrolls both ways itself, as one sheet.
   */
  const driveAutoScroll = useCallback(
    (clientX: number, clientY: number, columnId: string | null) => {
      const targets = [];
      if (columnsRef.current) targets.push({ el: columnsRef.current, axis: 'x' as const });
      const list = columnId ? cardListRefs.current.get(columnId) : undefined;
      if (list) targets.push({ el: list, axis: 'y' as const });
      else if (columnsRef.current) targets.push({ el: columnsRef.current, axis: 'y' as const });
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
  const laneWatch = useLaneWatch(user, boardId, isMember);
  // The notes panel: open or closed per person and board (their user doc).
  const notes = useBoardNotes(boardId);
  const latestNotes = useLatestNotesVersion(boardId);
  const notesOpen = useNotesOpen(user);
  const showNotes = notesOpen.data?.includes(boardId) ?? false;
  const toggleNotes = (open: boolean) =>
    void setNotesOpen(user, boardId, open).catch((e: unknown) => setError(toUserMessage(e, 'notesOpen')));
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

  // Lanes, on a board that uses them: rows of the grid, across every column
  // (Faisal, 2026-11-19, replacing headings inside each column on this
  // layout; the phone keeps those).
  const laneBoard = board.data;
  const live = laneBoard ? lanesLive(laneBoard) : false;
  const today = todayInOrgTz();

  useEffect(() => {
    if (!headingRow) return;
    const measure = () => setHeadingHeight(headingRow.offsetHeight);
    measure();
    const seen = new ResizeObserver(measure);
    seen.observe(headingRow);
    return () => seen.disconnect();
  }, [headingRow]);
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
      // Dropped into a folded lane: open it now, as an add does, so
      // the card is seen landing rather than vanishing until the server
      // answers (or, offline, until the write is sent).
      if (inLane && target.laneId) void collapse.reveal(target.laneId);

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
  async function addCard(
    key: string,
    columnId: string,
    title: string,
    subscribe: boolean,
    laneId?: string,
  ) {
    setAdding(null);
    setGridAdd(null);
    // Only this form's: a refused add waiting elsewhere is kept.
    setRetry((r) => (r?.key === key ? null : r));
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
      setRetry({ key, columnId, title, subscribe, laneId });
    }
  }

  /**
   * This board's stand-in for `useAction`'s `run`: report, and swallow. This
   * surface has always reported through its own banner, so it supplies the
   * contract locally rather than growing a second error channel.
   */
  function runReporting(fn: () => Promise<unknown>) {
    void fn().catch((e: unknown) => setError(toUserMessage(e, 'board')));
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

  const draggedLane = dragged && laneBoard && live ? laneOf(dragged, laneBoard) : null;
  const marks = (columnId: string, laneId: string | null | undefined, i: number) =>
    dropTarget?.columnId === columnId && dropTarget.laneId === laneId && dropTarget.index === i;
  const dropBar = (
    <div
      data-testid="drop-bar"
      style={{ height: 3, background: t.accent.base, borderRadius: 2, marginBottom: space.sm }}
    />
  );

  /**
   * One card, in a column (`laneId` undefined) or a lane's cell. `drawn` is
   * the column's cards in the order it draws them, which shift-click follows.
   */
  function renderCard(
    card: Card,
    i: number,
    columnId: string,
    laneId: string | null | undefined,
    drawn: readonly Card[],
  ) {
    return (
      <div
        key={card.id}
        onDragOver={(e) => {
          // Refused as its lane refuses it, or the bar would be drawn where
          // the card will not go: left to the cell, which takes it to the end
          // of its own lane.
          if (!acceptsDrop(laneId, draggedLane)) return;
          e.preventDefault();
          e.stopPropagation();
          if (drag) setDropTarget({ columnId, laneId, index: i });
          // stopPropagation above means the container will not drive the
          // scrolling, so this does, or it stops over a card.
          driveAutoScroll(e.clientX, e.clientY, laneId === undefined ? columnId : null);
        }}
      >
        {marks(columnId, laneId, i) ? dropBar : null}
        <CardTile
          card={card}
          labels={labels}
          boardMembers={members}
          subtaskCount={subtasksBy.get(card.id)}
          parentTitle={parentsBy.get(card.id)}
          finished={isFinished(card, b!)}
          t={t}
          canEdit={canEdit}
          selected={selection.isSelected(card.id)}
          dragging={drag?.cardId === card.id}
          onToggleSelect={(shiftKey) =>
            shiftKey ? selection.selectRangeTo(card.id, drawn) : selection.toggle(card.id)
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
            setDrag({ cardId: card.id, fromColumnId: columnId });
          }}
          onDragEnd={() => {
            autoScroll.stop();
            setDrag(null);
            setDropTarget(null);
          }}
        />
      </div>
    );
  }

  function columnBell(columnId: string, columnName: string) {
    return isMember ? (
      <WatchColumnBell
        columnName={columnName}
        watching={watching(columnId)}
        busy={watched.status !== 'ready'}
        onPress={() =>
          runReporting(() => setColumnWatched(user, boardId, columnId, !watching(columnId)))
        }
      />
    ) : null;
  }

  /** A board without lanes: its columns side by side, each scrolling down. */
  function plainColumns() {
    return (
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
        {b!.columns.map((col) => {
          const colCards = byColumn.get(col.id) ?? [];
          const columnEnd: DropTarget = { columnId: col.id, index: colCards.length };
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
                  gap: space.sm,
                  minHeight: 44,
                  marginBottom: space.sm,
                }}
              >
                <ColumnHeading name={col.name} count={colCards.length} bold />
                {columnBell(col.id, col.name)}
              </div>

              <div
                ref={(el) => {
                  if (el) cardListRefs.current.set(col.id, el);
                  else cardListRefs.current.delete(col.id);
                }}
                data-testid={`column-cards-${col.name}`}
                style={{ overflowY: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0 }}
              >
                {colCards.map((card, i) => renderCard(card, i, col.id, undefined, colCards))}
              </div>

              {/* A refused add reopens here, unless another form is open. */}
              {adding === col.id || (adding === null && retry?.key === col.id) ? (
                <WebAddCardForm
                  onAdd={(title, subscribe) => void addCard(col.id, col.id, title, subscribe)}
                  canSubscribe={isMember}
                  initial={retry?.key === col.id ? retry : undefined}
                  onCancel={() => {
                    setAdding(null);
                    setRetry((r) => (r?.key === col.id ? null : r));
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
    );
  }

  /** The + a grid form hangs from, kept by key so the form can find it. */
  const plusAt = (key: string) => (el: HTMLDivElement | null) => {
    if (el) plusRefs.current.set(key, el);
    else plusRefs.current.delete(key);
  };
  const toggleGridAdd = (next: GridAdd) => {
    setAdding(null);
    setGridAdd((open) => (open?.from === next.from && open.id === next.id ? null : next));
  };

  /**
   * A board with live lanes: one sheet, columns across and lanes down. The
   * heading row sticks to the top and the lane names to the left; a row is
   * as tall as its fullest cell, and a lane too tall to work with is folded,
   * never scrolled inside (Faisal, 2026-11-19).
   */
  function laneGrid() {
    const lb = laneBoard!;
    const columns = b!.columns;
    const all = cards.data ?? EMPTY_CARDS;
    // Every lane, and No lane while any card is in it: `groupByLane`'s rows.
    const rows = groupByLane([], lb, all).map((g) => g.lane);
    const cells = new Map(
      columns.map((col) => [
        col.id,
        new Map(groupByLane(byColumn.get(col.id) ?? [], lb, all).map((g) => [g.lane?.id ?? null, g.cards])),
      ]),
    );
    const cellOf = (columnId: string, laneId: string | null) => cells.get(columnId)?.get(laneId) ?? [];
    // What shift-click follows in a column: lane by lane, less folded lanes'.
    const drawn = new Map(
      columns.map((col) => [col.id, collapse.visible(rows.flatMap((l) => cellOf(col.id, l?.id ?? null)))]),
    );
    const late = (c: Card) => !isFinished(c, lb) && bucketFor(c.dueDate, today) === 'overdue';
    const openKey = gridAdd ? `${gridAdd.from}:${gridAdd.id}` : null;
    // A refused add reopens its form, unless another is open.
    const shownKey =
      openKey ?? (retry && /^(column|lane):/.test(retry.key) && adding === null ? retry.key : null);

    function cell(colId: string, colName: string, laneId: string | null, laneName: string, folded: boolean, last: boolean) {
      const here = cellOf(colId, laneId);
      // A card with a lane is not dropped into No lane: over that row it goes
      // to the end of its own lane in this column (`acceptsDrop`).
      const takes = acceptsDrop(laneId, draggedLane);
      const end: DropTarget = takes
        ? { columnId: colId, laneId, index: folded ? 0 : here.length }
        : { columnId: colId, laneId: draggedLane, index: cellOf(colId, draggedLane).length };
      const over = !!drag && dropTarget?.columnId === colId && dropTarget.laneId === laneId;
      const lateHere = here.filter(late).length;
      return (
        <div
          key={`${colId}:${laneId ?? ''}`}
          // The suites, the sweep and the films find a cell by these: its
          // lane's name ('' for No lane) and its column's.
          data-testid="lane-cell"
          data-lane={laneId === null ? '' : laneName}
          data-column={colName}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (drag) setDropTarget(end);
            driveAutoScroll(e.clientX, e.clientY, null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void drop(
              dropTarget?.columnId === colId && dropTarget.laneId === end.laneId ? dropTarget : end,
              e.dataTransfer.getData('text/plain') || null,
            );
          }}
          style={{
            background: over ? t.bg.accentSoft : t.bg.inset,
            borderTop: `1px solid ${t.border.strong}`,
            borderBottomLeftRadius: last ? radius.lg : 0,
            borderBottomRightRadius: last ? radius.lg : 0,
            padding: folded ? `${space.xs}px ${space.sm}px` : space.sm,
            minHeight: folded ? 0 : CELL_MIN_HEIGHT,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: folded ? 'center' : 'flex-start',
          }}
        >
          {folded ? (
            here.length > 0 ? (
              <span
                style={{
                  alignSelf: 'flex-start',
                  fontSize: 12,
                  padding: `${space.xs}px ${space.sm}px`,
                  borderRadius: 999,
                  background: t.bg.surface,
                  color: lateHere > 0 ? t.text.danger : t.text.secondary,
                }}
              >
                {here.length === 1 ? '1 card' : `${here.length} cards`}
                {lateHere > 0 ? `, ${lateHere} late` : ''}
              </span>
            ) : null
          ) : (
            <>
              {here.map((card, i) => renderCard(card, i, colId, laneId, drawn.get(colId) ?? EMPTY_CARDS))}
              {marks(colId, laneId, here.length) ? dropBar : null}
            </>
          )}
        </div>
      );
    }

    const formColumn = shownKey?.startsWith('column:') ? columns.find((c) => `column:${c.id}` === shownKey) : undefined;
    const formLane = shownKey?.startsWith('lane:') ? lb.lanes?.find((l) => `lane:${l.id}` === shownKey) : undefined;
    // A + gone from the page (its lane or column removed meanwhile) has no form.
    const anchor = shownKey ? plusRefs.current.get(shownKey) : undefined;
    const closeForm = () => {
      setGridAdd(null);
      setRetry((r) => (r?.key === shownKey ? null : r));
    };

    return (
      <div
        ref={columnsRef}
        data-testid="board-columns"
        onDragOver={(e) => {
          // Outside a cell (a lane's name, a heading, a gap) nothing takes
          // the card: no preventDefault, so the cursor says so, and no cell
          // stays lit as if it would. Only the scrolling is driven.
          if (dropTarget) setDropTarget(null);
          driveAutoScroll(e.clientX, e.clientY, null);
        }}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: space.lg }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `${LANE_TRACK}px repeat(${columns.length}, ${COLUMN_TRACK}px)`,
            columnGap: space.md,
            width: 'max-content',
            paddingRight: space.lg,
          }}
        >
          {/* The corner, frozen both ways; the heading row is measured on it. */}
          <div
            ref={setHeadingRow}
            style={{
              position: 'sticky',
              top: 0,
              left: 0,
              zIndex: 4,
              background: t.bg.canvas,
              borderRight: `1px solid ${t.border.subtle}`,
            }}
          />
          {columns.map((col) => (
            <div
              key={`heading:${col.id}`}
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 3,
                background: t.bg.canvas,
                // Over the gap to its left too, so cards scrolling up are not
                // seen through the gaps between headings.
                marginLeft: -space.md,
                paddingLeft: space.md,
              }}
            >
              <div
                style={{
                  background: t.bg.inset,
                  borderTopLeftRadius: radius.lg,
                  borderTopRightRadius: radius.lg,
                  display: 'flex',
                  alignItems: 'center',
                  gap: space.xs,
                  padding: `${space.xs}px ${space.xs}px ${space.xs}px ${space.md}px`,
                  minHeight: 52,
                  height: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                  <ColumnHeading name={col.name} count={(byColumn.get(col.id) ?? []).length} lines={2} bold />
                </div>
                <div ref={plusAt(`column:${col.id}`)} style={{ display: 'flex' }}>
                  <IconAction
                    icon="add"
                    label={`Add a card to ${col.name}`}
                    onPress={() => toggleGridAdd({ from: 'column', id: col.id })}
                  />
                </div>
                {columnBell(col.id, col.name)}
              </div>
            </div>
          ))}
          {rows.map((lane, r) => {
            const laneId = lane?.id ?? null;
            const folded = collapse.isCollapsed(laneId);
            const last = r === rows.length - 1;
            const name = lane?.name ?? 'No lane';
            return (
              <Fragment key={laneId ?? 'no-lane'}>
                <div
                  style={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    background: t.bg.canvas,
                    borderTop: `1px solid ${t.border.subtle}`,
                    borderRight: `1px solid ${t.border.subtle}`,
                    paddingRight: space.xs,
                    paddingBottom: folded ? 0 : space.sm,
                  }}
                >
                  {/* The name stays in view while a tall row scrolls by. */}
                  <div style={{ position: 'sticky', top: headingHeight }}>
                    <LaneHeading
                      name={name}
                      info={lane ? (infoByLane.get(lane.id) ?? null) : null}
                      collapsed={folded}
                      onToggle={() => void collapse.toggle(laneId)}
                      stacked
                      bell={
                        lane ? (
                          <div style={{ display: 'flex', alignItems: 'center' }}>
                            <div ref={plusAt(`lane:${lane.id}`)} style={{ display: 'flex' }}>
                              <IconAction
                                icon="add"
                                label={`Add a card to the ${lane.name} lane`}
                                onPress={() => toggleGridAdd({ from: 'lane', id: lane.id })}
                              />
                            </div>
                            {laneWatch.show ? (
                              <WatchLaneBell
                                laneName={lane.name}
                                watching={laneWatch.watching(lane.id)}
                                busy={laneWatch.busy}
                                onPress={() => void laneWatch.toggle(lane.id)}
                              />
                            ) : null}
                          </div>
                        ) : undefined
                      }
                    />
                  </div>
                </div>
                {columns.map((col) => cell(col.id, col.name, laneId, name, folded, last))}
              </Fragment>
            );
          })}
        </div>
        {anchor?.isConnected && (formColumn || formLane) && shownKey ? (
          <FloatingForm
            anchor={anchor}
            scroller={columnsRef.current}
            onClose={closeForm}
            side={formColumn ? 'below' : 'beside'}
            label={formColumn ? `New card in ${formColumn.name}` : `New card in the ${formLane!.name} lane`}
          >
            <WebAddCardForm
              key={shownKey}
              canSubscribe={isMember}
              pick={
                formColumn
                  ? { what: 'lane', choices: lb.lanes ?? [] }
                  : { what: 'column', choices: columns }
              }
              initial={
                retry?.key === shownKey
                  ? {
                      title: retry.title,
                      subscribe: retry.subscribe,
                      picked: formColumn ? retry.laneId : retry.columnId,
                    }
                  : undefined
              }
              onAdd={(title, subscribe, picked) =>
                formColumn
                  ? void addCard(shownKey, formColumn.id, title, subscribe, picked)
                  : void addCard(shownKey, picked!, title, subscribe, formLane!.id)
              }
              onCancel={closeForm}
            />
          </FloatingForm>
        ) : null}
      </div>
    );
  }

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
            icon="sticky-note-2"
            label="Board notes"
            selected={showNotes}
            disabled={notesOpen.status !== 'ready'}
            onPress={() => toggleNotes(!showNotes)}
          />
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
      {laneWatch.error ? (
        <div style={banner(t)}>
          {laneWatch.error}{' '}
          <button onClick={laneWatch.clearError} style={{ ...btn(t), marginLeft: 8 }}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* The notes beside the columns, which keep their own sideways scroll. */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
        {showNotes ? (
          <NotesPanel
            boardId={boardId}
            notes={notes}
            latest={latestNotes.data}
            members={members}
            user={user}
            onClose={() => toggleNotes(false)}
          />
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          {live && laneBoard ? laneGrid() : plainColumns()}
        </div>
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
