import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  type BoardColumn,
  canManageBoard,
  columnDeleteBlocked,
  columnsPatch,
  type Label,
  subtaskCounts,
  watchKey,
} from '@sabeel/shared';
import {
  archiveCard,
  cardsInColumn,
  createCard,
  moveCard,
  useBoardCards,
  type Card,
} from '../../cards';
import { updateBoard, useBoard, type BoardMemberProfile } from '../../boards';
import { CardFace } from '../CardFace';
import { ColumnNameEditor } from '../ColumnNameEditor';
import { useSelection } from '../../useSelection';
import { BulkBar } from '../BulkBar';
import type { SessionUser } from '../../session';
import { useNav } from '../../nav';
import {
  Body,
  Button,
  Card as Panel,
  Hint,
  IconAction,
  LoadError,
  Row,
  Screen,
  Spinner,
  Title,
} from '../ui';
import { AddCardForm } from './AddCardForm';
import { WatchColumnBell } from './Bells';
import { setColumnWatched, useWatchedColumns } from '../../notifications';
import { useLabels } from '../../labels';
import { radius, space, useTheme } from '../../theme';
import { useAction } from '../../useAction';

/**
 * The WIDE board, NATIVE build — a tablet, or any large-screen React Native
 * surface.
 *
 * Same column layout as the web build, but WITHOUT drag-and-drop: React Native
 * has no HTML5 drag API, and hand-rolling one with PanResponder across a
 * horizontally scrolling container is exactly the ambiguous-gesture problem the
 * phone layout exists to avoid. So a tablet gets the columns (which is what the
 * extra width is for) plus the same explicit "Move to…" affordance the phone
 * uses — reliable rather than clever.
 *
 * Before this existed, a tablet running the Android app fell through to the
 * phone's swipe layout and showed one column at a time on a 10-inch screen.
 */
const NO_COLUMNS: BoardColumn[] = [];
const EMPTY_CARDS: Card[] = [];
const NO_MEMBERS: BoardMemberProfile[] = [];
const NO_LABELS: Label[] = [];

export function WideBoard({ boardId, user }: { boardId: string; user: SessionUser }) {
  const nav = useNav();
  const board = useBoard(boardId);
  // Board authority, computed once. It is per-board now, so it cannot come from
  // `sessionCan` — a helper taking no board would be a button that always fails.
  const canManage = canManageBoard(user, board.data);
  const cards = useBoardCards(boardId);
  const t = useTheme();

  const [adding, setAdding] = useState<string | null>(null);
  const [moving, setMoving] = useState<Card | null>(null);
  // Which column is mid-rename — its delete icon steps aside while editing, so
  // the cancel ✕ and the delete ✕ are never adjacent.
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BoardColumn | null>(null);
  const { run, busy, error, setError } = useAction('wideBoard');
  const selection = useSelection(cards.data ?? EMPTY_CARDS);

  const columns = board.data?.columns ?? NO_COLUMNS;
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

  // Derived, not stored: every card of the board is already loaded, so the count
  // costs nothing and can never drift from reality.
  const subtasksBy = useMemo(() => subtaskCounts(cards.data ?? EMPTY_CARDS), [cards.data]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const col of columns) map.set(col.id, cardsInColumn(cards.data ?? [], col.id));
    return map;
  }, [columns, cards.data]);


  // The title comes from `AddCardForm`, already trimmed and non-empty — the
  // draft lives there so typing one does not re-render the board.
  async function addCard(columnId: string, title: string, subscribe: boolean) {
    setAdding(null);
    await run(() =>
      createCard({
        boardId,
        columnId,
        title,
        user,
        columnCards: byColumn.get(columnId) ?? [],
        subscribe,
      }),
    );
  }

  async function moveTo(card: Card, column: BoardColumn) {
    const target = (byColumn.get(column.id) ?? []).filter((c) => c.id !== card.id);
    setMoving(null);
    await run(() =>
      moveCard({
        card,
        toColumnId: column.id,
        before: target[target.length - 1] ?? null,
        after: null,
        user,
      }),
    );
  }

  /**
   * Deleting a column is irreversible and sits one tap away, so it ASKS.
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

  async function confirmRemoveColumn(col: BoardColumn) {
    setPendingDelete(null);
    await run(() =>
      updateBoard(boardId, columnsPatch(columns.filter((c) => c.id !== col.id))),
    );
  }

  if (board.status === 'loading' || cards.status === 'loading') {
    return <Spinner label="Loading board…" />;
  }
  // A failed cards query used to render a board with every column and no
  // cards at all — indistinguishable from someone having deleted the lot.
  // Inside a Screen WITH a way out: a bare panel on the immersive board
  // (no tab bar, no header) left the reader stranded with no Back.
  if (cards.status === 'error') {
    return (
      <Screen>
        <Row style={styles.between}>
          <Title numberOfLines={1} style={styles.headerTitle}>
            {board.data?.name ?? 'Board'}
          </Title>
          <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
        </Row>
        <LoadError what="this board" code={cards.error} />
      </Screen>
    );
  }

  const b = board.data;
  if (!b) {
    // A refused read is not a missing board — see NarrowBoard.
    return (
      <Screen>
        <Title>{board.status === 'error' ? 'Board unavailable' : 'Board not found'}</Title>
        {board.status === 'error' ? (
          <LoadError what="this board" code={board.error} />
        ) : null}
        <Button label="All boards" onPress={() => nav.reset({ name: 'boards' })} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} width="full">
      <Row style={styles.between}>
        <Title numberOfLines={1} style={styles.headerTitle}>
          {b.name}
        </Title>
        <Row style={styles.headerActions}>
          {/* Everyone gets this, not just owners: members can archive, so
              members must be able to un-archive. */}
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
        </Row>
      </Row>

      {error ? (
        <Panel>
          <Body>{error}</Body>
          <Button label="Dismiss" variant="secondary" onPress={() => setError(null)} />
        </Panel>
      ) : null}

      {/* Destructive and irreversible, so it gets a labelled button and a
          sentence — not an icon you can brush past. Gated with the icon that
          opens it: another owner revoking yours while this is on screen would
          otherwise leave a confirmation whose button the server now refuses. */}
      {canManage && pendingDelete ? (
        <Panel>
          <Body>
            Delete the column “{pendingDelete.name}”? It is empty, but this cannot
            be undone.
          </Body>
          <Row>
            <Button
              busy={busy}
              label="Delete column"
              variant="danger"
              onPress={() => confirmRemoveColumn(pendingDelete)}
            />
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setPendingDelete(null)}
            />
          </Row>
        </Panel>
      ) : null}

      <BulkBar
        canManage={canManage}
        currentBoardId={boardId}
        columns={columns}
        allCards={cards.data ?? []}
        selection={selection}
        members={members}
        user={user}
        onError={setError}
      />

      {/* `keyboardShouldPersistTaps` on both scrollers here and below: the
          composer's field sits INSIDE them, and a focused field otherwise
          makes the ScrollView eat the next tap — on Add, on Cancel, on a
          card. `Sheet` carries the mechanism. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        style={styles.fill}
        keyboardShouldPersistTaps="handled"
      >
        {columns.map((col) => {
          const colCards = byColumn.get(col.id) ?? [];
          return (
            <View
              key={col.id}
              style={[styles.column, { backgroundColor: t.bg.inset }]}
            >
              <Row style={styles.between}>
                <ColumnNameEditor
                  column={col}
                  columns={columns}
                  canEdit={canManage}
                  suffix={` (${colCards.length})`}
                  bold
                  busy={busy}
                  onError={setError}
                  onRename={(next) => updateBoard(boardId, columnsPatch(next))}
                  run={run}
                  onEditingChange={(on) => setRenamingCol(on ? col.id : null)}
                />
                {/* Together at the right: the row spaces its children apart,
                    and a third one would sit in the middle. */}
                <Row>
                  {isMember && renamingCol !== col.id ? (
                    <WatchColumnBell
                      columnName={col.name}
                      watching={watching(col.id)}
                      busy={busy || watched.status !== 'ready'}
                      onPress={() =>
                        run(() => setColumnWatched(user, boardId, col.id, !watching(col.id)))
                      }
                    />
                  ) : null}
                  {canManage && renamingCol !== col.id ? (
                    <IconAction
                      icon="delete-outline"
                      label={`Delete column ${col.name}`}
                      danger
                      onPress={() => askRemoveColumn(col)}
                    />
                  ) : null}
                </Row>
              </Row>

              <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
                {colCards.map((card) => {
                  const selected = selection.isSelected(card.id);
                  return (
                    <Pressable
                      key={card.id}
                      accessibilityRole="button"
                      accessibilityLabel={card.title}
                      onPress={() =>
                        selection.active
                          ? selection.toggle(card.id)
                          : nav.push({ name: 'card', boardId, cardId: card.id })
                      }
                      onLongPress={() => selection.toggle(card.id)}
                      // Matches the web board and the narrow one — see NarrowBoard.
                      testID={`card-${card.title}`}
                      style={[
                        styles.card,
                        {
                          backgroundColor: selected ? t.bg.accentSoft : t.bg.surface,
                          borderColor: selected ? t.accent.base : t.border.subtle,
                          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <CardFace
                        card={card}
                        labels={labels}
                        boardMembers={members}
                        subtaskCount={subtasksBy.get(card.id)}
                      />
                    </Pressable>
                  );
                })}
                {colCards.length === 0 ? <Hint>No cards.</Hint> : null}
              </ScrollView>

              {adding === col.id ? (
                <AddCardForm
                  onAdd={(title, subscribe) => addCard(col.id, title, subscribe)}
                  canSubscribe={isMember}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <Button
                  label="+ Add card"
                  variant="secondary"
                  onPress={() => setAdding(col.id)}
                />
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* No HTML5 drag on native, so moving is explicit — the same sheet the
          narrow board uses, for the same reason: reliable beats clever. */}
      {moving ? (
        <View
          style={[
            styles.sheet,
            { backgroundColor: t.bg.raised, borderColor: t.border.strong },
          ]}
        >
          <Hint>Move “{moving.title}” to</Hint>
          <Row style={styles.wrap}>
            {columns.map((col) => (
              <Button
                key={col.id}
                label={col.name}
                disabled={col.id === moving.columnId}
                variant={col.id === moving.columnId ? 'secondary' : 'primary'}
                onPress={() => moveTo(moving, col)}
              />
            ))}
          </Row>
          <Row style={styles.wrap}>
            <Button
          busy={busy}
              label="Archive card"
              variant="danger"
              onPress={() =>
                run(async () => {
                  await archiveCard(moving.id, user);
                  setMoving(null);
                })
              }
            />
            <Button label="Cancel" variant="secondary" onPress={() => setMoving(null)} />
          </Row>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  headerTitle: { flexShrink: 1 },
  // Small: IconAction's 44px box already separates these.
  headerActions: { gap: space.xs },
  wrap: { flexWrap: 'wrap' },
  column: {
    width: 300,
    marginRight: space.md,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  card: {
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    gap: space.sm,
  },
  sheet: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
    bottom: space.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.sm,
  },
});
