import { useEffect, useRef } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { canEditBoardLabels, canManageBoard, finishedColumnChoice } from '@sabeel/shared';
import { useBoard, type BoardListItem } from '../boards';
import {
  PAGE_TITLES,
  pageSummary,
  settingsBack,
  settingsPages,
  shownPage,
  type BoardSettingsPage,
} from '../boardSettingsPages';
import { Icon } from '../icons';
import { useLabels } from '../labels';
import type { SessionUser } from '../session';
import { useNav } from '../nav';
import { Card, Hint, IconAction, LoadError, Row, Screen, Spinner, Title } from '../components/ui';
import { BoardHistory } from '../components/BoardHistory';
import { BoardLabelsSection } from '../components/LabelManager';
import { ColumnsPage } from '../components/boardSettings/ColumnsPage';
import { GeneralPage } from '../components/boardSettings/GeneralPage';
import { LanesPage } from '../components/boardSettings/LanesPage';
import { PeoplePage } from '../components/boardSettings/PeoplePage';
import { radius, space, type, useTheme } from '../theme';
import { useLayout } from '../theme/layout';

/** How wide the list of pages is beside a page on a wide screen. */
const SIDE_LIST_WIDTH = 230;

/**
 * Board settings: a list of pages.
 *
 * On a phone the list is the screen and a page replaces it, so Back from a page
 * returns to the list. On a wide screen the list runs down the side with the
 * first page open beside it, and choosing another page swaps it in place
 * (`nav.replace`), so Back leaves settings rather than walking every page that
 * was looked at.
 *
 * Each page is its own component holding its own drafts and its own `run`, so a
 * keystroke on one page re-renders that page and nothing else.
 */
export function BoardSettingsScreen({
  boardId,
  page,
  user,
}: {
  boardId: string;
  page?: BoardSettingsPage;
  user: SessionUser;
}) {
  const nav = useNav();
  const { isWide } = useLayout();
  const board = useBoard(boardId);
  const labels = useLabels();
  // Android's hardware Back and its edge swipe take the same way out as the
  // header's Back (`settingsBack`, below): the app-wide handler pops one
  // entry, which is wrong when settings stands on two. Registered after it, so
  // asked first. The browser's own Back still pops one, a residual.
  const back = useRef<() => void>(() => nav.pop());
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      back.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  // With no board to show, Back leaves settings, every entry of them: removed
  // from the board while on a page, one press must not land on the list.
  back.current = () => {
    const r = settingsBack(nav.stack, boardId, true, true);
    if ('pop' in r) nav.back(r.pop);
  };

  if (board.status === 'loading') return <Spinner label="Loading board…" />;
  const b = board.data;
  if (!b) {
    // GONE and REFUSED are different answers. Being removed from a board you
    // have open ends its listener with permission-denied, which is ordinary now
    // that authority is per-board — and "Board not found" would tell somebody
    // their colleague's board had been deleted.
    return (
      <Screen width="read">
        <Row style={styles.between}>
          <Title>{board.status === 'error' ? 'Board unavailable' : 'Board not found'}</Title>
          <IconAction icon="arrow-back" label="Back" onPress={back.current} />
        </Row>
        {board.status === 'error' ? (
          <LoadError what="this board" code={board.error} />
        ) : null}
      </Screen>
    );
  }

  /**
   * Whether this person ADMINISTERS the board, as opposed to merely being on it.
   * It decides which pages there are; a live demotion re-renders this screen
   * with fewer, and a page no longer offered falls back (`shownPage`).
   */
  const canManage = canManageBoard(user, b);
  const pages = settingsPages(canManage);
  const shown = shownPage(page, pages, isWide);
  const ownLabels =
    labels.status === 'ready'
      ? (labels.data ?? []).filter((l) => l.boardId === boardId).length
      : null;
  const facts = {
    archived: b.archived,
    columns: b.columns.length,
    members: b.memberUids.length,
    owners: b.boardOwnerUids.length,
    ownLabels,
    lanesOn: b.lanesOn,
    lanes: b.lanes.length,
    finishedColumn: b.columns.find((c) => c.id === finishedColumnChoice(b))?.name ?? null,
  };

  function goBack() {
    const r = settingsBack(nav.stack, boardId, isWide, shown !== null);
    if ('pop' in r) nav.back(r.pop);
    else nav.replace({ name: 'boardSettings', boardId });
  }
  back.current = goBack;

  function open(next: BoardSettingsPage) {
    const route = { name: 'boardSettings', boardId, page: next } as const;
    if (isWide) nav.replace(route);
    else nav.push(route);
  }

  const list = (
    <PageList
      pages={pages}
      selected={isWide ? shown : null}
      summary={(p) => pageSummary(p, facts)}
      onOpen={open}
    />
  );
  const body = shown ? (
    <PageBody page={shown} board={b} user={user} canManage={canManage} />
  ) : null;
  // What the screen is called with no page open. Someone who does not run the
  // board reaches it from a control named this, so the screen says the same.
  const listTitle = canManage ? 'Board settings' : 'Members and labels';

  if (isWide) {
    return (
      <Screen width="content">
        <Header title={listTitle} boardName={b.name} onBack={goBack} />
        <View style={styles.split}>
          <View style={styles.side}>{list}</View>
          <View style={styles.page}>{body}</View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen width="read">
      <Header
        title={shown ? PAGE_TITLES[shown] : listTitle}
        boardName={b.name}
        onBack={goBack}
      />
      {shown ? body : list}
    </Screen>
  );
}

function Header({
  title,
  boardName,
  onBack,
}: {
  title: string;
  boardName: string;
  onBack: () => void;
}) {
  return (
    <View>
      <Row style={styles.between}>
        <View style={styles.grow}>
          <Title numberOfLines={2}>{title}</Title>
        </View>
        <IconAction icon="arrow-back" label="Back" onPress={onBack} />
      </Row>
      {/* Which board, because a page is many taps from the board it belongs to. */}
      <Hint>{boardName}</Hint>
    </View>
  );
}

function PageBody({
  page,
  board,
  user,
  canManage,
}: {
  page: BoardSettingsPage;
  board: BoardListItem;
  user: SessionUser;
  canManage: boolean;
}) {
  switch (page) {
    case 'general':
      return <GeneralPage board={board} />;
    case 'columns':
      return <ColumnsPage board={board} />;
    case 'lanes':
      return <LanesPage board={board} />;
    case 'people':
      return <PeoplePage board={board} user={user} canManage={canManage} />;
    case 'labels':
      // For EVERYONE on the board, not only its owners: a board's own labels
      // are anyone-on-the-board's to change, and the institute labels above
      // them are locked for all.
      return (
        <BoardLabelsSection
          boardId={board.id}
          user={user}
          canEdit={canEditBoardLabels(user, board)}
        />
      );
    case 'history':
      // For everyone who can see the board, like the roster: who changed what
      // is as much a member's question as an owner's.
      return (
        <Card>
          <BoardHistory boardId={board.id} />
        </Card>
      );
  }
}

/**
 * The pages, one row each: the name, a line saying what it holds, and on a
 * phone a chevron saying it opens. On a wide screen the open page's row is
 * marked instead, the way the app's rail marks where you are.
 *
 * A row's accessible name is the page's name alone, so "Columns" is found by
 * that name and is not renamed by its count.
 */
function PageList({
  pages,
  selected,
  summary,
  onOpen,
}: {
  pages: readonly BoardSettingsPage[];
  /** The open page on a wide screen; null on a phone, where nothing is open beside the list. */
  selected: BoardSettingsPage | null;
  summary: (page: BoardSettingsPage) => string | undefined;
  onOpen: (page: BoardSettingsPage) => void;
}) {
  const t = useTheme();
  const wide = selected !== null;
  return (
    <View style={[styles.list, { backgroundColor: t.bg.surface, borderColor: t.border.subtle }]}>
      {pages.map((p, i) => {
        const on = p === selected;
        const detail = summary(p);
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={PAGE_TITLES[p]}
            /**
             * The summary as a HINT on a phone. The row is one element named by
             * its page, and on iOS such an element hides the text inside it, so
             * VoiceOver said "Columns" and never "9 columns" (seen by the
             * iPhone simulator's Maestro run, which could not find it either).
             * A hint is read after the name, on iOS and Android alike.
             * react-native-web has no hint and forwards the prop as an unknown
             * DOM attribute, so it is left off there.
             */
            accessibilityHint={Platform.OS === 'web' ? undefined : detail}
            accessibilityState={wide ? { selected: on } : undefined}
            /**
             * `aria-current` as well: react-native-web maps
             * `accessibilityState.selected` to nothing on a button, so the open
             * page was marked by its colour alone. "page" is the ARIA for the
             * current item of a set of links, and it is inert on native, where
             * `accessibilityState` is what the screen reader reads.
             */
            aria-current={on ? 'page' : undefined}
            onPress={() => onOpen(p)}
            style={({ pressed }) => [
              styles.row,
              i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border.subtle } : null,
              on ? { backgroundColor: t.bg.accentSoft } : pressed ? { backgroundColor: t.bg.inset } : null,
            ]}
          >
            <View style={styles.grow}>
              <Text style={[type.body, styles.name, { color: on ? t.accent.base : t.text.primary }]}>
                {PAGE_TITLES[p]}
              </Text>
              {detail ? <Hint>{detail}</Hint> : null}
            </View>
            {/* Ornament beside text, not a target: the whole row is the target. */}
            {wide ? null : <Icon name="chevron-right" size={24} color={t.text.muted} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1, gap: 2 },
  split: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  side: { width: SIDE_LIST_WIDTH },
  /** minWidth 0, or a long unbreakable line in a page pushes the row wider than the screen. */
  page: { flex: 1, minWidth: 0, gap: space.sm },
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  name: { fontWeight: '600' },
});
