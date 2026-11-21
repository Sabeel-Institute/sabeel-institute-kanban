import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from '../icons';
import {
  BOARD_NAME_MAX,
  canSeeEveryBoard,
  overviewBoards,
  sortBoardsForList,
  type BoardSection,
} from '@sabeel/shared';
import {
  boardsView,
  cloneBoard,
  createBoard,
  newBoardId,
  noteBoardOpened,
  setSectionCollapsed,
  setShowAllBoards,
  toggleFavourite,
  updateBoard,
  useMyBoardPrefs,
  useMyCollapsed,
  useMyBoards,
  type BoardListItem,
} from '../boards';
import { captureError } from '../sentry';
import { toUserMessage } from '../errors';
import { sessionCan, type SessionUser } from '../session';
import { useArchivedBoards } from '../boards';
import { useNav } from '../nav';
import {
  Body,
  Button,
  Caption,
  Hint,
  Card,
  CardGrid,
  DisclosureHeading,
  LoadError,
  Row,
  Screen,
  Spinner,
  Title,
  Toggle,
} from '../components/ui';
import { PushNudge } from '../components/PushNudge';
import { CloneBoardSheet } from '../components/CloneBoardSheet';
import { contextMenuProps } from '../contextMenu';
import { useAction } from '../useAction';
import { radius, space, type, useTheme } from '../theme';

/** Shared empty array, so absent preferences keep a stable identity. */
const EMPTY: string[] = [];

/**
 * One board in the list. A tap opens it; a long-press, or a right-click on a
 * computer, offers to clone it — only to someone who can make boards, since a
 * clone is one. For anyone else `onClone` is absent and a press is only a press:
 * no sheet, no menu, nothing announcing a feature they cannot use. On a phone
 * a screen reader gets the same offer as an action on the row, since a
 * long-press is not something every reader is used to giving; react-native-web
 * drops `accessibilityActions`, and there the keyboard's context-menu key (or
 * Shift+F10) fires the same `contextmenu` a right-click does.
 */
const NO_SECTIONS: readonly BoardSection[] = [];
const NO_BOARDS: BoardListItem[] = [];

/**
 * The way into the overview, worded as well as drawn (#124): a bare icon in
 * the corner went unnoticed. A compact pill, not a full-width button, so it
 * sits beside the title on a phone; its name is still "Overview".
 */
function OverviewEntry({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Overview"
      onPress={onPress}
      style={({ pressed }) => [
        styles.overviewEntry,
        { backgroundColor: pressed ? t.bg.inset : t.bg.accentSoft, borderColor: t.accent.base },
      ]}
    >
      <Icon name="checklist" size={20} color={t.text.accent} />
      <Text style={[type.label, styles.overviewEntryText, { color: t.text.accent }]}>Overview</Text>
    </Pressable>
  );
}

/**
 * One section of the list, collapsible (#110): the heading toggles it, and
 * while collapsed it says how many boards it holds, so collapsing hides the
 * boards and never the fact that they are there.
 */
function BoardsSection({
  title,
  count,
  collapsed,
  onToggle,
  filtering,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  /** A filter is typed: every section is open and none folds until it clears. */
  filtering: boolean;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const words = collapsed ? `${title} (${count})` : title;
  // Named "<title> section", never the bare title: "Boards" and "All boards"
  // already name the tab and the control that returns to this list, and two
  // controls answering to one name confuse a screen reader and every test.
  const label = collapsed ? `${title} section (${count})` : `${title} section`;
  return (
    <>
      <View style={styles.sectionGap}>
        <DisclosureHeading label={label} expanded={!collapsed} onToggle={onToggle} disabled={filtering}>
          <Text style={[type.heading, { color: t.text.primary }]}>{words}</Text>
        </DisclosureHeading>
      </View>
      {collapsed ? null : children}
    </>
  );
}

function BoardRow({
  board,
  isFavourite,
  onOpen,
  onToggleFavourite,
  onClone,
}: {
  board: BoardListItem;
  isFavourite: boolean;
  onOpen: () => void;
  onToggleFavourite: () => void;
  onClone: (() => void) | undefined;
}) {
  const t = useTheme();
  return (
    <Card>
      <Row style={styles.between}>
        <Pressable
          onPress={onOpen}
          onLongPress={onClone}
          {...contextMenuProps(onClone)}
          accessibilityActions={onClone ? [{ name: 'clone', label: 'Clone board' }] : undefined}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'clone') onClone?.();
          }}
          style={styles.grow}
          accessibilityRole="button"
        >
          <View style={styles.nameRow}>
            <View style={styles.shrink}>
              <Body>{board.name}</Body>
            </View>
            {/* On the row wherever the board is listed, Archived included. */}
            {board.template ? (
              <View style={[styles.badge, { backgroundColor: t.bg.inset, borderColor: t.border.subtle }]}>
                <Text style={[type.caption, { color: t.text.secondary }]}>Template</Text>
              </View>
            ) : null}
          </View>
          <Caption>
            {board.activeCardCount} card{board.activeCardCount === 1 ? '' : 's'} ·{' '}
            {board.memberUids.length} member{board.memberUids.length === 1 ? '' : 's'}
          </Caption>
        </Pressable>
        <Pressable
          onPress={onToggleFavourite}
          accessibilityRole="button"
          accessibilityLabel={isFavourite ? `Unstar ${board.name}` : `Star ${board.name}`}
          hitSlop={10}
        >
          <Icon
            name={isFavourite ? 'star' : 'star-border'}
            size={24}
            color={isFavourite ? t.accent.base : t.text.muted}
          />
        </Pressable>
      </Row>
    </Card>
  );
}

/**
 * The new-board form, owning its draft.
 *
 * Mounted only while creating, so the lifecycle is the reset — which is why
 * cancelling no longer has to clear anything by hand. The boards list behind it
 * is a live query with a filter over it; typing a board name used to re-render
 * the whole list per character.
 */
function NewBoardForm({
  busy,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [name, setName] = useState('');

  return (
    <Card style={styles.form}>
      <Hint>New board</Hint>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Board name"
        placeholderTextColor={t.text.muted}
        autoFocus
        maxLength={BOARD_NAME_MAX}
        onSubmitEditing={() => onCreate(name)}
        style={[
          styles.input,
          {
            backgroundColor: t.bg.inset,
            color: t.text.primary,
            borderColor: t.border.subtle,
          },
        ]}
      />
      <Row>
        <Button
          label="Create"
          onPress={() => onCreate(name)}
          busy={busy}
          disabled={!name.trim() || busy}
        />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </Row>
    </Card>
  );
}

export function BoardsScreen({ user }: { user: SessionUser }) {
  const nav = useNav();
  const boards = useMyBoards(user);
  const prefs = useMyBoardPrefs(user);
  const canShowAllBoards = canSeeEveryBoard(user);
  const showAllBoards = canShowAllBoards && prefs.data?.showAllBoards === true;
  const boardScopeAction = useAction('setShowAllBoards');
  const { filter } = boardsView.use();
  const setFilter = (v: string) => boardsView.set({ filter: v });
  const [creating, setCreating] = useState(false);
  /** The board whose clone sheet is open, and the id its clone will have. */
  const [cloning, setCloning] = useState<{ board: BoardListItem; cloneId: string } | null>(null);
  const cloneAction = useAction('cloneBoard');
  // Sections collapsed by this person, on their account (#110). Loading or
  // unreadable reads as nothing collapsed: a display preference, so the list
  // shows in full rather than hiding boards on a failed read, and the failure
  // is on the global banner.
  const collapsedPrefs = useMyCollapsed(user);
  const collapsed = collapsedPrefs.data?.sections ?? NO_SECTIONS;
  const collapseAction = useAction('collapseSection');
  // While a filter is typed every section is open: a match must never sit
  // behind a fold where the person is not looking.
  const filtering = filter.trim() !== '';
  function toggleSection(section: BoardSection) {
    return collapseAction.run(() =>
      setSectionCollapsed(user, section, !collapsed.includes(section)),
    );
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTheme();
  // Whether this screen is still the one showing (App mounts only the top
  // route). A clone or a new board can land after a notification or a link has
  // taken the person elsewhere, and opening it then would bury where they went;
  // it waits in the list instead.
  const showing = useRef(true);
  useEffect(() => {
    showing.current = true;
    return () => {
      showing.current = false;
    };
  }, []);

  // `?? []` would allocate a fresh array on every render, so the memo below
  // would never actually memoize. Constant empties keep the identity stable.
  const favourites = prefs.data?.favourites ?? EMPTY;
  const recents = prefs.data?.recents ?? EMPTY;
  const allBoards = boards.data ?? NO_BOARDS;
  const visibleBoards = useMemo(
    () => showAllBoards ? allBoards : allBoards.filter((board) => board.memberUids.includes(user.uid)),
    [allBoards, showAllBoards, user.uid],
  );
  const nameFilter = filter.trim().toLowerCase();

  const sections = useMemo(() => {
    const matching = visibleBoards.filter((board) => board.name.toLowerCase().includes(nameFilter));
    return sortBoardsForList(matching, favourites, recents);
  }, [visibleBoards, favourites, recents, nameFilter]);

  async function open(board: BoardListItem) {
    // Fire-and-forget: recording "recently opened" must never delay navigation.
    void noteBoardOpened(user, board.id, recents).catch(() => {});
    nav.push({ name: 'board', boardId: board.id });
  }

  // Every board in this list is one you can see, and none is archived, so
  // making boards is the whole question; `cloneBoard` asks all three again.
  const onCloneOf = (b: BoardListItem) =>
    sessionCan.createBoards(user)
      ? () => {
          cloneAction.setError(null);
          // One id per offer, kept across tries: see `cloneBoard`.
          setCloning({ board: b, cloneId: newBoardId() });
        }
      : undefined;

  async function clone(
    offer: { board: BoardListItem; cloneId: string },
    name: string,
    subscribe: boolean,
  ) {
    await cloneAction.run(async () => {
      const landed = await cloneBoard(offer.board.id, name, offer.cloneId, subscribe);
      setCloning(null);
      // An earlier try made this board, its answer lost, and the name has been
      // changed since: this answer is the one the person is waiting on, so the
      // board takes the name they asked for now. Not awaited, because a board
      // write waits while offline and the clone itself has landed.
      const wanted = name.trim();
      if (landed.name !== undefined && landed.name !== wanted) {
        void updateBoard(landed.id, { name: wanted }).catch((e: unknown) =>
          captureError(e, { source: 'cloneBoard rename' }),
        );
      }
      if (!showing.current) return;
      // Opened as from the list, so Back finds it under Recent.
      void noteBoardOpened(user, landed.id, recents).catch(() => {});
      nav.push({ name: 'board', boardId: landed.id });
    });
  }

  async function create(rawName: string) {
    const name = rawName.trim();
    // The `busy` guard stops a second fast tap from creating a duplicate board
    // in the window before the await resolves and the form closes.
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await createBoard(name, user);
      setCreating(false);
      if (showing.current) nav.push({ name: 'board', boardId: id });
    } catch (e) {
      setError(toUserMessage(e, 'createBoard'));
    } finally {
      setBusy(false);
    }
  }

  if (boards.status === 'loading') return <Spinner label="Loading boards…" />;
  // Before this, a failed query fell through to the empty state and told a
  // member with fifteen boards that they had none.
  if (boards.status === 'error') {
    return (
      <Screen width="list">
        <Title>Boards</Title>
        <LoadError what="your boards" />
      </Screen>
    );
  }

  // Hidden boards count: hiding one from the overview should not take away
  // the way back to it.
  const hasOverview = overviewBoards(allBoards).length > 0;
  const hasShortcuts = sections.favourites.length + sections.recents.length > 0;
  const otherBoardsTitle = canShowAllBoards && !showAllBoards ? 'My boards' : 'All boards';
  const hasAny =
    sections.favourites.length +
      sections.recents.length +
      sections.others.length +
      sections.templates.length >
    0;
  let emptyMessage = 'You are not on any boards yet. Someone who owns a board can add you to it.';
  if (filtering) {
    emptyMessage = 'No boards match your filter.';
  } else if (canShowAllBoards && !showAllBoards) {
    emptyMessage = 'You are not on any active boards. Turn on All boards to see the full list.';
  } else if (sessionCan.createBoards(user)) {
    emptyMessage = 'No boards yet. Create one to get started.';
  }

  return (
    <Screen width="list">
      {/* Section actions (Search, My work, Alerts, People, Sign out) live in the
          app-wide nav bar now — bottom bar on a phone, left rail on wide. This
          screen keeps only its own title, the create-board control, and the
          overview's entry for whoever has a board it lists (Faisal,
          2026-11-15): someone with no board with lanes never sees it. */}
      <Row style={styles.between}>
        <Title>Boards</Title>
        {hasOverview ? (
          <OverviewEntry onPress={() => nav.push({ name: 'overview' })} />
        ) : null}
      </Row>

      {/* Top of the content, below the alert only. Same place in all three apps:
          first thing after anything that needs acting on today. This screen has
          no alert, so it leads. It is one-time and dismissible, so it earns the
          position. */}
      <PushNudge uid={user.uid} />

      {sessionCan.createBoards(user) ? (
        creating ? (
          <NewBoardForm busy={busy} onCreate={create} onCancel={() => setCreating(false)} />
        ) : (
          <Button label="New board" onPress={() => setCreating(true)} />
        )
      ) : null}

      {error ? (
        <Card style={styles.form}>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {canShowAllBoards ? (
        <Row>
          <Body>All boards</Body>
          <Toggle
            label="All boards"
            value={showAllBoards}
            disabled={prefs.status === 'loading'}
            onValueChange={(next) => boardScopeAction.run(() => setShowAllBoards(user, next))}
          />
        </Row>
      ) : null}

      {boardScopeAction.error ? <Body>{boardScopeAction.error}</Body> : null}

      {visibleBoards.length > 6 || filter !== '' ? (
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Filter boards"
          placeholderTextColor={t.text.muted}
          style={[
            styles.input,
            styles.form,
            {
              backgroundColor: t.bg.inset,
              color: t.text.primary,
              borderColor: t.border.subtle,
            },
          ]}
        />
      ) : null}

      {collapseAction.error ? (
        <Card style={styles.form}>
          <Body>{collapseAction.error}</Body>
          <Button label="Dismiss" variant="secondary" onPress={() => collapseAction.setError(null)} />
        </Card>
      ) : null}

      {!hasAny ? (
        <Card style={styles.form}>
          <Body>{emptyMessage}</Body>
        </Card>
      ) : null}

      {sections.favourites.length > 0 ? (
        <>
          <BoardsSection
            title={'Starred'}
            count={sections.favourites.length}
            collapsed={!filtering && collapsed.includes('starred')}
            filtering={filtering}
            onToggle={() => toggleSection('starred')}
          >
          <CardGrid>
            {sections.favourites.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                isFavourite
                onOpen={() => open(b)}
                onToggleFavourite={() => toggleFavourite(user, b.id, favourites)}
                onClone={onCloneOf(b)}
              />
            ))}
          </CardGrid>
          </BoardsSection>
        </>
      ) : null}

      {sections.recents.length > 0 ? (
        <>
          <BoardsSection
            title={'Recent'}
            count={sections.recents.length}
            collapsed={!filtering && collapsed.includes('recent')}
            filtering={filtering}
            onToggle={() => toggleSection('recent')}
          >
          <CardGrid>
            {sections.recents.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                isFavourite={false}
                onOpen={() => open(b)}
                onToggleFavourite={() => toggleFavourite(user, b.id, favourites)}
                onClone={onCloneOf(b)}
              />
            ))}
          </CardGrid>
          </BoardsSection>
        </>
      ) : null}

      {sections.others.length > 0 ? (
        <>
          <BoardsSection
            title={hasShortcuts ? otherBoardsTitle : 'Boards'}
            count={sections.others.length}
            collapsed={!filtering && collapsed.includes('all')}
            filtering={filtering}
            onToggle={() => toggleSection('all')}
          >
          <CardGrid>
            {sections.others.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                isFavourite={false}
                onOpen={() => open(b)}
                onToggleFavourite={() => toggleFavourite(user, b.id, favourites)}
                onClone={onCloneOf(b)}
              />
            ))}
          </CardGrid>
          </BoardsSection>
        </>
      ) : null}

      {/* Boards marked as templates, last and apart, so the boards people work
          in come first. Cloned by a long press, like any board. */}
      {sections.templates.length > 0 ? (
        <>
          <BoardsSection
            title={'Templates'}
            count={sections.templates.length}
            collapsed={!filtering && collapsed.includes('templates')}
            filtering={filtering}
            onToggle={() => toggleSection('templates')}
          >
          <CardGrid>
            {sections.templates.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                isFavourite={favourites.includes(b.id)}
                onOpen={() => open(b)}
                onToggleFavourite={() => toggleFavourite(user, b.id, favourites)}
                onClone={onCloneOf(b)}
              />
            ))}
          </CardGrid>
          </BoardsSection>
        </>
      ) : null}

      {/* Archived boards live behind a disclosure, not mixed into the list.
          Archiving is meant to be the SAFE alternative to deleting, but the
          board list filters archived boards out and "Restore" lives inside
          board settings — which you can only reach from the board. So an
          archived board was unreachable, and archive was a one-way door.

          Collapsed by default: the point of archiving is to get a board out of
          the way, and a flat list of active and archived boards together would
          undo that. */}
      {/* No role gate: `useArchivedBoards` returns YOUR archived boards (and every
          one of them for an admin), so anyone with an archived board has one to
          look at. It used to be role-gated, which meant a member who archived
          nothing still could not find a board they were on that someone else
          archived. */}
      <ArchivedBoards user={user} showAllBoards={showAllBoards} onOpen={open} />

      {cloning ? (
        <CloneBoardSheet
          boardName={cloning.board.name}
          busy={cloneAction.busy}
          error={cloneAction.error}
          onClone={(name, subscribe) => clone(cloning, name, subscribe)}
          onClose={() => setCloning(null)}
        />
      ) : null}
    </Screen>
  );
}

function ArchivedBoards({
  user,
  showAllBoards,
  onOpen,
}: {
  user: SessionUser;
  showAllBoards: boolean;
  onOpen: (b: BoardListItem) => void;
}) {
  const archived = useArchivedBoards(user);
  const [open, setOpen] = useState(false);
  const list = (archived.data ?? NO_BOARDS).filter(
    (board) => showAllBoards || board.memberUids.includes(user.uid),
  );

  // Nothing archived: say nothing at all rather than showing an empty section.
  if (list.length === 0) return null;

  return (
    <>
      <Button
        label={open ? `Hide archived (${list.length})` : `Archived (${list.length})`}
        variant="secondary"
        onPress={() => setOpen((v) => !v)}
      />
      {open ? (
        <>
          <Hint>
            Archived boards are hidden from everyone. Open one and use Restore
            board in its settings, under General, to bring it back.
          </Hint>
          <CardGrid>
            {list.map((b) => (
              <BoardRow
                key={b.id}
                board={b}
                isFavourite={false}
                onOpen={() => onOpen(b)}
                onToggleFavourite={() => {}}
                // An archived board is restored before it is cloned.
                onClone={undefined}
              />
            ))}
          </CardGrid>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: space.lg },
  overviewEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  overviewEntryText: { fontWeight: '700' },
  between: { justifyContent: 'space-between' },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  shrink: { flexShrink: 1 },
  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  /** Wraps so no action can be pushed off a narrow screen. */
  grow: { flex: 1, gap: space.xs },
  /** Forms and messages stay a readable width inside the wide board grid. */
  form: { maxWidth: 520 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 44,
    ...type.body,
  },
});
