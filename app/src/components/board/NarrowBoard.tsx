/**
 * The NARROW board: one column at a time, swipe between them.
 *
 * Chosen by available WIDTH, not platform — a phone browser gets this too, and
 * a tablet does not. See app/src/theme/layout.ts.
 *
 * This is the layout decision the whole project turns on — a phone cannot show a
 * multi-column board legibly, and a horizontally-scrolling miniature is worse
 * than useless on the move. So the column fills the screen, cards stay readable,
 * and the board's shape is conveyed by a position indicator instead.
 *
 * Moving a card is an explicit "Move to…" sheet rather than a drag. On a
 * swipe-paged surface a drag gesture is ambiguous: the same finger movement
 * means both "drag this card" and "next column". Reordering WITHIN a column has
 * no such conflict, so that stays a long-press drag.
 *
 * The web board is a different component entirely (WideBoard.web.tsx).
 */
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
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
  cardsInColumn,
  createCard,
  useBoardCards,
  type Card,
} from '../../cards';
import { updateBoard, useBoard, type BoardMemberProfile } from '../../boards';
import { CardFace } from '../CardFace';
import { ColumnNameEditor } from '../ColumnNameEditor';
import { useSelection } from '../../useSelection';
import { BulkBar } from '../BulkBar';
import { confirmAction } from '../../confirm';
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
import { KeyboardSticky } from '../KeyboardSticky';
import { useAction } from '../../useAction';

/** Stable empties, so an absent board does not churn the memos below. */
const NO_COLUMNS: BoardColumn[] = [];
const EMPTY_CARDS: Card[] = [];
const NO_MEMBERS: BoardMemberProfile[] = [];
const NO_LABELS: Label[] = [];

function CardTile({
  card,
  labels,
  boardMembers,
  subtaskCount,
  selected,
  selectionActive,
  onOpen,
  onLongPress,
}: {
  card: Card;
  labels: readonly Label[];
  boardMembers: readonly BoardMemberProfile[];
  subtaskCount?: number;
  selected: boolean;
  selectionActive: boolean;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onOpen}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={selected ? `${card.title}, selected` : card.title}
      // Same handle the web board emits, so ONE selector addresses a card on
      // every layout. It existed only on `WideBoard.web.tsx`, which meant every
      // e2e suite ran wide and the phone board — the layout this app is designed
      // around — had no automated coverage at all.
      testID={`card-${card.title}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: selected ? t.bg.accentSoft : t.bg.surface,
          borderColor: selected ? t.accent.base : t.border.subtle,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <CardFace
        card={card}
        labels={labels}
        boardMembers={boardMembers}
        subtaskCount={subtaskCount}
      />
      {selectionActive ? (
        <Hint>{selected ? '✓ selected' : 'tap to select'}</Hint>
      ) : null}
    </Pressable>
  );
}

/**
 * Which column each board was last showing.
 *
 * Module-level on purpose: this must survive the component unmounting, which is
 * exactly what happens when you open a card. Bounded implicitly by the number of
 * boards, which is small.
 */
const lastPageByBoard = new Map<string, number>();

export function NarrowBoard({ boardId, user }: { boardId: string; user: SessionUser }) {
  const nav = useNav();
  const board = useBoard(boardId);
  // Board authority, computed once. It is per-board now, so it cannot come from
  // `sessionCan` — a helper taking no board would be a button that always fails.
  const canManage = canManageBoard(user, board.data);
  const cards = useBoardCards(boardId);

  // Remembered PER BOARD, outside the component. The pager's position was
  // component state, so opening a card unmounted the board and lost it —
  // returning from a card in the third column dumped you back on the first.
  // Keyed by board so two boards do not inherit each other's position.
  const [page, setPage] = useState(() => lastPageByBoard.get(boardId) ?? 0);
  const [adding, setAdding] = useState(false);
  const { run, busy, error, setError } = useAction('narrowBoard');
  // Editing the column name takes over the pager row (see the header below).
  const [renaming, setRenaming] = useState(false);
  // Has the pager been scrolled to the remembered column yet? Starts true when
  // there is nothing to restore, so the common case paints immediately.
  const [restored, setRestored] = useState(() => (lastPageByBoard.get(boardId) ?? 0) === 0);
  const scroller = useRef<ScrollView>(null);
  /**
   * The page an arrow tap is animating towards, or null when nothing is in
   * flight. A ref, not state: it gates a scroll handler that fires every frame
   * and must not re-render anything itself.
   */
  const animatingTo = useRef<number | null>(null);
  // Measured, not Dimensions.get('window'): this pager sits inside the Screen's
  // horizontal padding, so sizing pages to the WINDOW made every page wider than
  // the space available and pushed cards (and the column footer) off the right
  // edge. Measuring also keeps it correct if it is ever nested elsewhere, and it
  // tracks browser resizes for free.
  //
  // ONE source of truth, deliberately. A previous version fell back to
  // window-width-minus-padding until the measurement arrived, as insurance
  // against a blank board. That was a mistake: `syncPage` derives the current
  // page from `contentOffset.x / width`, so two different widths in play meant
  // the division could produce a page the user never navigated to — the board
  // jumped from column 2 to column 7 while opening the add-card form, and sat
  // between two columns showing half of each. The blank board it was insuring
  // against had a different cause (a flex:1 chain broken in Screen) and is fixed
  // there. Insurance that corrupts the thing it protects is not insurance.
  const [width, setWidth] = useState(0);
  const selection = useSelection(cards.data ?? EMPTY_CARDS);

  // Members come from the BOARD, not the user directory: only admins may list
  // users, so reading the directory here would show every non-admin a
  // permission-denied banner and leave them unable to assign anyone.
  const members = board.data?.members ?? NO_MEMBERS;
  // Only a member may subscribe to a card or watch a column: rules hold
  // subscribers to members, and the notice sweep sends arrivals to members
  // alone, so an admin visiting a board they are not on gets neither bell.
  const isMember = board.data?.memberUids.includes(user.uid) ?? false;
  const watched = useWatchedColumns(user);
  const watching = (columnId: string) =>
    (watched.data ?? []).includes(watchKey(boardId, columnId));
  // Org-wide, not from the board: labels are one set for the whole team.
  const allLabels = useLabels();
  const labels = allLabels.data ?? NO_LABELS;

  // `?? []` would allocate a new array each render, defeating the memo below.
  const columns = board.data?.columns ?? NO_COLUMNS;
  // Derived, not stored — the board already holds every card it needs.
  const subtasksBy = useMemo(() => subtaskCounts(cards.data ?? EMPTY_CARDS), [cards.data]);

  const byColumn = useMemo(() => {
    const map = new Map<string, Card[]>();
    for (const col of columns) map.set(col.id, cardsInColumn(cards.data ?? [], col.id));
    return map;
  }, [columns, cards.data]);

  /**
   * The page actually being shown, which is NOT always the remembered one.
   *
   * `page` is restored from module state that outlives the component, so it can
   * point past the end of a board whose columns were deleted while you were on
   * a card. Every read of the position clamps through here, so the indicator
   * cannot say "5 of 3", the pager cannot show an empty name, and — the reason
   * this became load-bearing — the board-level actions in the column footer,
   * which render for the visible page only, cannot vanish from the phone
   * entirely and strand someone with no way into Board settings.
   *
   * Landing on the LAST column beats the old behaviour of showing column 1
   * while the header described a column that no longer exists.
   */
  const visiblePage = columns.length > 0 ? Math.min(page, columns.length - 1) : 0;

  // Is there actually a column to scroll back to? False when the pager is
  // already on the first page.
  const needsRestore = visiblePage > 0;

  /**
   * Keep the position indicator in step with the visible column.
   *
   * `onMomentumScrollEnd` alone is not enough: a slow drag that releases without
   * flinging produces no momentum event, so the header would still say "To Do,
   * 1 of 3" while the Done column is on screen — observed on the emulator
   * 2026-07-19. Tracking `onScroll` as well means the indicator can never
   * disagree with what the user is looking at, which is the whole point of
   * having it on a surface where only one column is visible.
   */
  function rememberPage(next: number) {
    lastPageByBoard.set(boardId, next);
    setPage(next);
  }

  function syncPage(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    /*
     * IGNORE THE PAGES AN ANIMATED SCROLL PASSES THROUGH.
     *
     * The arrows set the page immediately, so the header responds to the tap,
     * and then animate the scroll. Every frame of that animation fires
     * onScroll, and for the first half the offset still rounds to the column
     * being LEFT — so the header flipped to the new name, back to the old, and
     * forward again. Filmed going 1 -> 2 -> 1 -> 2 on one tap. Swiping never
     * did it, because a finger moves the offset itself and nothing sets the
     * page ahead of it.
     */
    if (animatingTo.current !== null) {
      if (next === animatingTo.current) animatingTo.current = null;
      return;
    }
    if (next !== page && next >= 0 && next < columns.length) rememberPage(next);
  }

  function goTo(index: number) {
    const clamped = Math.max(0, Math.min(index, columns.length - 1));
    animatingTo.current = clamped;
    rememberPage(clamped);
    scroller.current?.scrollTo({ x: clamped * width, animated: true });
  }


  // The title comes from `AddCardForm`, already trimmed and non-empty — the
  // draft lives there so typing one does not re-render the board.
  async function addCard(columnId: string, title: string, subscribe: boolean) {
    setAdding(false);
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


  /**
   * Deleting a column is irreversible and sits one tap away, so it ASKS.
   * Emptiness is not consent — an empty column can still be one someone just
   * cleared and is about to refill.
   */
  /**
   * BOTH ANSWERS ARRIVE AS A MODAL, next to the thumb that asked.
   *
   * The bin sits bottom-right; the confirmation used to render as a Panel near
   * the TOP of the screen, and the "still has cards" refusal went to the error
   * banner up there too. On a tall phone that is a screen away from where you
   * are looking, and a Panel reads as one more card rather than as an answer.
   * Reported as exactly that. `confirmAction` is centred and modal, and it is
   * already what the archive's permanent delete uses.
   */
  function askRemoveColumn(col: BoardColumn) {
    void (async () => {
      const blocked = columnDeleteBlocked(col.name, (byColumn.get(col.id) ?? []).length);
      if (blocked) {
        await confirmAction('Cannot delete this column', blocked);
        return;
      }
      const ok = await confirmAction(
        `Delete “${col.name}”?`,
        'The column is empty, but deleting it cannot be undone.',
      );
      if (!ok) return;
      await run(() =>
        updateBoard(boardId, columnsPatch(columns.filter((c) => c.id !== col.id))),
      );
    })();
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
    // A refused read is not a missing board — and since authority went
    // per-board, being removed while you have it open is the ordinary way to get
    // here. `LoadError` says which of the two happened.
    return (
      <Screen>
        <Title>{board.status === 'error' ? 'Board unavailable' : 'Board not found'}</Title>
        {board.status === 'error' ? (
          <LoadError what="this board" code={board.error} />
        ) : (
          <Hint>It may have been archived, or you may not be a member.</Hint>
        )}
        <Button label="All boards" onPress={() => nav.reset({ name: 'boards' })} />
      </Screen>
    );
  }

  const current = columns[visiblePage];

  /**
   * Archived cards and Board settings — BOARD-level, not column-level.
   *
   * A variable rather than inline JSX because they render in two mutually
   * exclusive places: the visible column's footer, and the no-columns empty
   * state. That second one is not hypothetical — `columnDeleteBlocked` only
   * refuses a column that still holds cards, so an empty board CAN be emptied of
   * columns entirely, and the footer lives inside the column list. Without the
   * empty state an owner who deleted the last column had no way back into Board
   * settings to add one: verified as a dead end before this existed.
   */
  const boardActions = (
    <>
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
        label={canManage ? 'Board settings' : 'Board members'}
        onPress={() => nav.push({ name: 'boardSettings', boardId })}
      />
    </>
  );

  return (
    <Screen scroll={false}>
      {/*
        ONLY Back lives up here. Archived cards and Board settings moved to the
        column footer: three icons beside the title left a 320px phone with too
        little room for the board's name, and Back is the one control that has to
        be reachable from the top of every screen.
      */}
      <Row style={styles.between}>
        {/* The title shrinks and truncates so the icon keeps its place —
            a long board name used to shove it off the row. */}
        <Title numberOfLines={1} style={styles.headerTitle}>
          {b.name}
        </Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>

      {/* Column pager header: which column, and where it sits in the board.
          Arrows rather than "‹ Prev"/"Next ›": two labelled buttons cost ~150px
          of a 320px row, which is width the column name needs. They are NOT
          `arrow-back` — that glyph means "leave this screen" everywhere else in
          the app. While the name is being edited they step aside entirely. */}
      <Row style={styles.pager}>
        {!renaming ? (
          <IconAction
            icon="chevron-left"
            label="Previous column"
            onPress={() => goTo(visiblePage - 1)}
          />
        ) : null}
        <View style={styles.pagerLabel}>
          {current ? (
            <ColumnNameEditor
              column={current}
              columns={columns}
              canEdit={canManage}
              center
              // Two lines here and nowhere else: the pager squeezes the name
              // between Prev and Next, and there is nothing above or below it
              // to displace.
              lines={2}
              busy={busy}
              onError={setError}
              onEditingChange={setRenaming}
              onRename={(next) => updateBoard(boardId, columnsPatch(next))}
              run={run}
            />
          ) : (
            <Body>—</Body>
          )}
          {!renaming ? (
            <Hint>
              {columns.length > 0 ? `${visiblePage + 1} of ${columns.length}` : 'No columns'}
            </Hint>
          ) : null}
        </View>
        {!renaming ? (
          <IconAction
            icon="chevron-right"
            label="Next column"
            onPress={() => goTo(visiblePage + 1)}
          />
        ) : null}
      </Row>

      {error ? (
        <Panel>
          <Body>{error}</Body>
          <Button label="Dismiss" variant="secondary" onPress={() => setError(null)} />
        </Panel>
      ) : null}

      {columns.length === 0 ? (
        <Panel>
          <Body>This board has no columns yet.</Body>
          <Hint>
            {canManage
              ? 'Cards live in columns — add the first one in Board settings.'
              : 'Cards live in columns. An owner of this board can add the first one.'}
          </Hint>
          <Row>{boardActions}</Row>
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

      {!selection.active && (byColumn.get(current?.id ?? '')?.length ?? 0) > 0 ? (
        <Hint>
          Tap a card to open it. Long-press to start selecting, then tap others
          to move or archive them together.
        </Hint>
      ) : null}

      {/* The pager is MEASURED by this wrapper, not by the ScrollView itself, so
          the ScrollView can be mounted already knowing how wide a page is.

          That ordering is the whole fix for a bug caught on video: the header
          reads from the restored `page` immediately, but the scroll position was
          restored afterwards (a scrollTo inside onLayout, deferred a frame). For
          that window the header said "Feature Requests, 2 of 5" while the body
          still showed column 1 — which happened to be empty, so coming back from
          a card detail read as "my cards have vanished".

          Mounting late means `contentOffset` is an INITIAL prop, which is the
          only form of it every platform honours; setting it on an already-mounted
          ScrollView is not reliably applied. The rAF scrollTo stays as a
          belt-and-braces correction for a width CHANGE (rotation, browser
          resize), where the ScrollView is necessarily already mounted. */}
      <View style={styles.fill} onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - width) > 1) {
          const hadWidth = width > 0;
          setWidth(w);
          if (hadWidth && visiblePage > 0) {
            requestAnimationFrame(() =>
              scroller.current?.scrollTo({ x: visiblePage * w, animated: false }),
            );
          }
        }
      }}>
      {width === 0 ? null : (
      <ScrollView
        ref={scroller}
        // A focused composer must not stop the next tap reaching Add, Cancel
        // or a card tile — all of which live inside this scroller. `Sheet`
        // carries the mechanism.
        keyboardShouldPersistTaps="handled"
        // Restore the remembered column when the CONTENT has been measured.
        // `contentOffset` alone is not enough — Android does not honour it here —
        // and a scrollTo from onLayout runs before the pages exist, so it lands
        // nowhere. onContentSizeChange fires once the pages are laid out, which
        // is the first moment a scroll can actually take effect.
        onContentSizeChange={() => {
          if (!needsRestore || restored) return;
          scroller.current?.scrollTo({ x: visiblePage * width, animated: false });
          setRestored(true);
        }}
        // Held invisible until it is sitting on the right column. Showing the
        // WRONG column is far worse than showing nothing for a frame: the header
        // says "Feature Requests, 2 of 5" while the body renders column 1, and if
        // that column is empty it reads as "my cards are gone" — which is exactly
        // what got filmed coming back from a card detail.
        //
        // Gated on `needsRestore`, never on `restored` alone. If the remembered
        // page no longer exists — columns deleted since you were last here — the
        // ScrollView has nothing to scroll to, `onContentSizeChange` may never
        // fire, and gating on `restored` would leave the board PERMANENTLY blank.
        // Nothing to restore means show it immediately.
        style={[styles.fill, needsRestore && !restored ? styles.hidden : null]}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={syncPage}
        onMomentumScrollEnd={syncPage}
        // A finger beats an animation: if you grab the pager mid-flight the
        // target is abandoned, so stop filtering or the header would stick.
        onScrollBeginDrag={() => {
          animatingTo.current = null;
        }}
        onScrollEndDrag={syncPage}
        scrollEventThrottle={32}
      >
        {columns.map((col, colIndex) => {
          const colCards = byColumn.get(col.id) ?? [];
          const onScreen = colIndex === visiblePage;
          return (
            /*
              OFF-SCREEN PAGES ARE HIDDEN FROM ASSISTIVE TECH.
              Every column is laid out — that is how the pager swipes — so
              without this the whole board sits in the accessibility tree at
              once: a screen reader walked the cards of nine columns with no way
              to tell which one it was in, and heard "+ Add card" nine times.
              Sighted users see one column; this makes the tree agree.

              All three props, because they are three platforms' spellings of
              the same idea: aria-hidden for react-native-web,
              accessibilityElementsHidden for iOS, importantForAccessibility for
              Android.
            */
            <View
              key={col.id}
              style={[styles.page, { width }]}
              aria-hidden={!onScreen}
              accessibilityElementsHidden={!onScreen}
              importantForAccessibility={onScreen ? 'auto' : 'no-hide-descendants'}
            >
              <FlatList
                // Bounded, so it SCROLLS rather than growing past the page and
                // being clipped. See styles.page.
                style={styles.fill}
                keyboardShouldPersistTaps="handled"
                data={colCards}
                keyExtractor={(c) => c.id}
                renderItem={({ item }) => (
                  <CardTile
                    card={item}
                    labels={labels}
                    boardMembers={members}
                    subtaskCount={subtasksBy.get(item.id)}
                    selected={selection.isSelected(item.id)}
                    selectionActive={selection.active}
                    // Once anything is selected, tapping toggles rather than
                    // opens — otherwise building a selection means alternating
                    // between long-press and tap, which nobody discovers.
                    onOpen={() =>
                      selection.active
                        ? selection.toggle(item.id)
                        : nav.push({ name: 'card', boardId, cardId: item.id })
                    }
                    onLongPress={() => selection.toggle(item.id)}
                  />
                )}
                ListEmptyComponent={<Hint>No cards in {col.name}.</Hint>}
                contentContainerStyle={styles.listContent}
              />

              {/* ONLY the visible column gets a composer.
                  `adding` is one boolean for the whole board, so rendering the
                  form on every page created one autoFocus TextField PER COLUMN.
                  The last one to mount won focus, and Android then scrolled the
                  horizontal pager to reveal that focused input — the board
                  jumped from column 1 to column 7 the moment you tapped "+ Add
                  card", landing between pages with two forms side by side. */}
              {adding && col.id === current?.id ? (
                /* Lifted above the keyboard: this composer is pinned to the
                   bottom of a NON-scrolling screen, so nothing can scroll it
                   into view and the keyboard simply covered the field. */
                <KeyboardSticky>
                  <Panel>
                    {/* A title typed for THIS column does not follow you to the
                        next one: the form is mounted per visible column, so
                        swiping unmounts it and its draft. Accepted, and not to
                        be "fixed" by closing the composer on swipe or by
                        hoisting the draft back onto the board — hoisting it is
                        what made every keystroke re-render every column. */}
                    <AddCardForm
                      onAdd={(title, subscribe) => addCard(col.id, title, subscribe)}
                      canSubscribe={isMember}
                      onCancel={() => setAdding(false)}
                    />
                  </Panel>
                </KeyboardSticky>
              ) : (
                /*
                  The board's action row. "+ Add card" keeps its label because
                  it is the primary action of this screen; everything else is an
                  icon, which is what frees the header above for the board name.
                  Archived cards and Board settings are BOARD-level and live in a
                  per-column footer, which is a small stretch — accepted because
                  only one column is on screen at a time, so the user sees one
                  row, and it costs no extra vertical space.
                */
                <Row style={[styles.footer, styles.wrap]}>
                  <View style={styles.grow}>
                    <Button label="+ Add card" onPress={() => setAdding(true)} />
                  </View>
                  {isMember ? (
                    <WatchColumnBell
                      columnName={col.name}
                      watching={watching(col.id)}
                      busy={busy}
                      onPress={() =>
                        run(() => setColumnWatched(user, boardId, col.id, !watching(col.id)))
                      }
                    />
                  ) : null}
                  {canManage ? (
                    <IconAction
                      icon="delete-outline"
                      danger
                      label={`Delete column ${col.name}`}
                      onPress={() => askRemoveColumn(col)}
                    />
                  ) : null}
                  {/*
                    THE VISIBLE PAGE ONLY. Every column is rendered — that is how
                    the pager swipes — so putting these board-level actions in a
                    per-column footer unguarded put THREE "Board settings"
                    buttons in the tree at once. Playwright caught it as a strict
                    -mode violation; a screen reader would have read it out as
                    three identical buttons, which is the real bug.
                  */}
                  {onScreen ? boardActions : null}
                </Row>
              )}
            </View>
          );
        })}
      </ScrollView>
      )}
      </View>

    </Screen>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  fill: { flex: 1 },
  between: { justifyContent: 'space-between' },
  headerTitle: { flexShrink: 1 },
  grow: { flex: 1 },
  pager: { justifyContent: 'space-between', paddingVertical: space.sm },
  pagerLabel: { alignItems: 'center', flex: 1 },
  /**
   * A column page is a flex COLUMN that fills the pager, so the card list can be
   * given the leftover space and the action row can sit under it.
   *
   * Without `flex: 1` here (and `fill` on the list) react-native-web sized the
   * list to its CONTENT: past about ten cards the column overflowed the page,
   * which clips (`overflow: hidden` on a View), so the last card was sliced in
   * half, "+ Add card" was pushed off the bottom of the screen, and NOTHING
   * scrolled — the wheel did nothing because no element had scrollable overflow.
   * The same tree behaved on native, which is why it only ever showed up in the
   * browser. It also explains why the action row appeared directly beneath the
   * cards on web but pinned to the bottom on Android: a content-sized list
   * leaves no space to push it down.
   */
  page: { flex: 1, paddingHorizontal: space.xs, gap: space.sm },
  listContent: { paddingBottom: space.md, gap: space.sm },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  footer: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});
