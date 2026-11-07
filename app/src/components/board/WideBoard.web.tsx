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
import { setColumnWatched, useWatchedColumns } from '../../notifications';
import {
  CARD_TITLE_MAX,
  canManageBoard,
  columnDeleteBlocked,
  columnsPatch,
  subtaskCounts,
  watchKey,
  type BoardColumn,
  type Label,
} from '@sabeel/shared';
import type { SessionUser } from '../../session';
import { useNav } from '../../nav';
import { useListenerError } from '../../liveQuery';
import { useLabels } from '../../labels';
import { getTheme, radius, space, type Theme } from '../../theme';

type DragState = { cardId: string; fromColumnId: string } | null;

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
}: {
  /** Called with a trimmed, non-empty title, and whether to subscribe to it. */
  onAdd: (title: string, subscribe: boolean) => void;
  onCancel: () => void;
  /** Whether the bell is offered: only a member of the board may subscribe. */
  canSubscribe: boolean;
}) {
  const t = useWebTheme();
  const [title, setTitle] = useState('');
  // Unmount-scoped like the draft, so every new composer starts subscribed.
  const [subscribe, setSubscribe] = useState(true);

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    onAdd(trimmed, canSubscribe && subscribe);
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
  const [dropTarget, setDropTarget] = useState<{ columnId: string; index: number } | null>(
    null,
  );
  const [adding, setAdding] = useState<string | null>(null);
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
  // Org-wide, not from the board: labels are one set for the whole team.
  const allLabels = useLabels();
  const labels = allLabels.data ?? NO_LABELS;

  const canEdit = true; // any board member may edit cards

  // Derived, not stored — the board already holds every card it needs.
  const subtasksBy = useMemo(() => subtaskCounts(cards.data ?? EMPTY_CARDS), [cards.data]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const col of board.data?.columns ?? []) {
      map.set(col.id, cardsInColumn(cards.data ?? [], col.id));
    }
    return map;
  }, [board.data?.columns, cards.data]);

  const drop = useCallback(
    async (columnId: string, index: number, cardIdFromEvent: string | null) => {
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

      const target = (byColumn.get(columnId) ?? []).filter((c) => c.id !== moving.id);
      const before = index > 0 ? target[index - 1] : null;
      const after = index < target.length ? target[index] : null;
      if (before?.id === moving.id || after?.id === moving.id) return;

      try {
        await moveCard({
          card: moving,
          toColumnId: columnId,
          before: before ?? null,
          after: after ?? null,
          user,
        });
        // Background tidy-up; never blocks the user.
        void rerankColumnIfNeeded(target).catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [drag, cards.data, byColumn, user, autoScroll],
  );

  // The title comes from `WebAddCardForm`, already trimmed and non-empty — the
  // draft lives there so typing one does not re-render the board.
  async function addCard(columnId: string, title: string, subscribe: boolean) {
    setAdding(null);
    try {
      await createCard({
        boardId,
        columnId,
        title,
        user,
        columnCards: byColumn.get(columnId) ?? [],
        subscribe,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveColumns(next: BoardColumn[]) {
    // Same shape as removeColumn below: this surface reports failures through its
    // own `error` banner rather than useAction.
    await updateBoard(boardId, columnsPatch(next));
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
    void fn().catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
            label={canManage ? 'Board settings' : 'Members and labels'}
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
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (drag) setDropTarget({ columnId: col.id, index: colCards.length });
                driveAutoScroll(e.clientX, e.clientY, col.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                void drop(
                  col.id,
                  dropTarget?.columnId === col.id ? dropTarget.index : colCards.length,
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
              {colCards.map((card, i) => (
                <div
                  key={card.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (drag) setDropTarget({ columnId: col.id, index: i });
                    // stopPropagation above means the column handler will not
                    // fire, so drive it here too — otherwise scrolling dies the
                    // moment the pointer passes over a card.
                    driveAutoScroll(e.clientX, e.clientY, col.id);
                  }}
                >
                  {dropTarget?.columnId === col.id && dropTarget.index === i ? (
                    <div
                      style={{
                        height: 3,
                        background: t.accent.base,
                        borderRadius: 2,
                        marginBottom: space.sm,
                      }}
                    />
                  ) : null}
                  <CardTile
                    card={card}
                    labels={labels}
                    boardMembers={members}
                    subtaskCount={subtasksBy.get(card.id)}
                    t={t}
                    canEdit={canEdit}
                    selected={selection.isSelected(card.id)}
                    dragging={drag?.cardId === card.id}
                    onToggleSelect={(shiftKey) =>
                      shiftKey
                        ? selection.selectRangeTo(card.id, colCards)
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
              ))}

              </div>

              {adding === col.id ? (
                <WebAddCardForm
                  onAdd={(title, subscribe) => void addCard(col.id, title, subscribe)}
                  canSubscribe={isMember}
                  onCancel={() => setAdding(null)}
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
