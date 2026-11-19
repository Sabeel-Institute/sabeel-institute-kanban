import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import {
  OVERVIEW_SORTS,
  OVERVIEW_SORT_LABELS,
  boardOverdueDays,
  describeMark,
  groupOverview,
  isDateType,
  isNamedType,
  isRealDate,
  laneInfo,
  namedFieldValue,
  nextHidden,
  overviewBoards,
  safeLink,
  shortDay,
  sortOverview,
  todayInOrgTz,
  type BoardField,
  type LaneInfo,
  type OverviewRow,
  type OverviewSort,
} from '@sabeel/shared';
import {
  setOverviewHidden,
  setOverviewReverse,
  setOverviewSort,
  noteBoardOpened,
  useMyBoardPrefs,
  useMyBoards,
  useMyOverviewPrefs,
  type BoardListItem,
} from '../boards';
import { useBoardCards } from '../cards';
import { contextMenuProps } from '../contextMenu';
import { Icon } from '../icons';
import { useNav } from '../nav';
import { createViewStore } from '../viewState';
import type { SessionUser } from '../session';
import { Sheet, SheetOption } from '../components/Sheet';
import { Select } from '../components/Select';
import {
  Body,
  Button,
  Card,
  Hint,
  IconAction,
  LoadError,
  Row,
  Screen,
  Spinner,
  Title,
} from '../components/ui';
import { radius, space, type, useTheme } from '../theme';
import { useLayout } from '../theme/layout';
import { useAction } from '../useAction';
import {
  MARK_MAX,
  NAME_FONT,
  laneColumns,
  type LaneColumns,
} from '../overviewLayout';

/**
 * The overview: every board with lanes that this person can see, one row per
 * board and one mark per lane, so the people running programs see what is late
 * without opening each board (Faisal, 2026-11-15).
 *
 * Boards with the same lanes share a heading of lane names. The order is one
 * of three, either way, remembered for the person; they may hide boards from
 * their own overview. Nothing else is stored, and nobody arranges it by hand.
 *
 * Each row listens to its own board's cards, the query and the rule the board
 * screen uses. Not one `in` query across boards: a member's read of a card is
 * authorised by a lookup of its board, and a query is allowed ten. Not
 * virtualised either: a row that unmounts stops listening, and its board would
 * lose its place in "most overdue".
 */
export function OverviewScreen({ user }: { user: SessionUser }) {
  const nav = useNav();
  const boards = useMyBoards(user);
  const prefs = useMyOverviewPrefs(user);
  const boardPrefs = useMyBoardPrefs(user);
  const { run, error } = useAction('overview');
  const [hiding, setHiding] = useState<BoardListItem | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  // Each row's days overdue, reported by the row from its own cards, for the
  // "most overdue" order.
  // Null when the row's cards could not be read; absent while they load.
  const [overdue, setOverdue] = useState<Record<string, number | null>>({});
  const report = useCallback((boardId: string, days: number | null) => {
    setOverdue((prev) => (prev[boardId] === days ? prev : { ...prev, [boardId]: days }));
  }, []);

  const listed = useMemo(() => overviewBoards(boards.data ?? []), [boards.data]);
  const hidden = prefs.data?.hidden ?? [];
  const sort = prefs.data?.sort ?? 'start';
  const reverse = prefs.data?.reverse ?? false;
  const shown = listed.filter((b) => !hidden.includes(b.id));
  const hiddenBoards = listed.filter((b) => hidden.includes(b.id));
  // Closed again once nothing is hidden, so the next board hidden does not
  // land in a list already open.
  const noneHidden = hiddenBoards.length === 0;
  useEffect(() => {
    if (noneHidden) setShowHidden(false);
  }, [noneHidden]);

  const groups = useMemo(() => {
    const rows: (OverviewRow & { board: BoardListItem })[] = shown.map((b) => ({
      id: b.id,
      name: b.name,
      createdAt: b.createdAt,
      start: namedFieldValue(b, 'start'),
      overdueDays: overdue[b.id] ?? null,
      laneNames: b.lanes.map((l) => l.name),
      board: b,
    }));
    return groupOverview(sortOverview(rows, sort, reverse));
  }, [shown, overdue, sort, reverse]);

  if (boards.status === 'loading' || prefs.status === 'loading') {
    return <Spinner label="Loading the overview…" />;
  }

  // Hiding writes the whole list, so it is offered only once the list is
  // known: built on a failed read's empty one, a single hide would replace
  // every board hidden before.
  const canHide = prefs.status === 'ready';
  function hide(board: BoardListItem, yes: boolean) {
    if (!canHide) return;
    void run(() => setOverviewHidden(user, nextHidden(hidden, board.id, yes)));
  }

  return (
    <Screen width="list">
      <Row style={styles.between}>
        <Title>Overview</Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>

      {boards.status === 'error' ? <LoadError what="your boards" code={boards.error} /> : null}
      {prefs.status === 'error' ? (
        <LoadError what="your overview's order and hidden boards" code={prefs.error} />
      ) : null}
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      <Row style={styles.controls}>
        {/* Said on screen, as the manual says it: a menu reading only
            "Start date" looked like a date to fill in. */}
        <Body>Order</Body>
        <Select
          label="Order"
          value={sort}
          options={OVERVIEW_SORTS.map((s) => ({ value: s, label: OVERVIEW_SORT_LABELS[s] }))}
          onChange={(next) => void run(() => setOverviewSort(user, next as OverviewSort))}
        />
        <IconAction
          icon="swap-vert"
          label="Reverse the order"
          selected={reverse}
          onPress={() => void run(() => setOverviewReverse(user, !reverse))}
        />
      </Row>

      {boards.status !== 'ready' ? null : listed.length === 0 ? (
        <Card>
          <Body>No boards with lanes yet.</Body>
          <Hint>A board shows here once its owners switch its lanes on.</Hint>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <Body>Every board here is hidden.</Body>
        </Card>
      ) : null}

      {groups.map((g) => (
        <Group
          key={g.signature}
          laneNames={g.laneNames}
          boards={g.rows.map((r) => r.board)}
          onReport={report}
          onOpen={(b) => {
            // Recent, as a board opened from the Boards list is: a program
            // reached through the overview was otherwise never among them.
            void noteBoardOpened(user, b.id, boardPrefs.data?.recents ?? []).catch(() => undefined);
            nav.push({ name: 'board', boardId: b.id });
          }}
          onMenu={setHiding}
        />
      ))}

      {hiddenBoards.length > 0 ? (
        <>
          <View style={styles.start}>
            <Button
              label={`Hidden (${hiddenBoards.length})`}
              variant="secondary"
              expanded={showHidden}
              onPress={() => setShowHidden((v) => !v)}
            />
          </View>
          {showHidden
            ? hiddenBoards.map((b) => (
                <Card key={b.id}>
                  <Row style={styles.between}>
                    <View style={styles.grow}>
                      <Body>{b.name}</Body>
                    </View>
                    <IconAction
                      icon="unarchive"
                      label={`Show ${b.name}`}
                      onPress={() => hide(b, false)}
                    />
                  </Row>
                </Card>
              ))
            : null}
        </>
      ) : null}

      <Sheet visible={hiding !== null && canHide} title={hiding?.name ?? ''} onClose={() => setHiding(null)}>
        <SheetOption
          label="Hide from my overview"
          detail="From yours only. Hidden boards are listed at the foot, to show again."
          onPress={() => {
            if (hiding) hide(hiding, true);
            setHiding(null);
          }}
        />
      </Sheet>
    </Screen>
  );
}

/** A row's padding, which a heading repeats so its names sit over the marks. */
const ROW_PAD = space.md + StyleSheet.hairlineWidth;
/** On a wide screen the board's name has a column of its own, left of the marks. */
const NAME_WIDTH = 260;
/** The details chevron's square: a 44-point target, as every control's. */
const TOGGLE = 44;

/**
 * Boards with the same lanes, under one heading of lane names. The group
 * measures its width once and works out the columns (`laneColumns`); the
 * heading and every row draw from that one answer, so a name always sits over
 * its own mark.
 */
function Group({
  laneNames,
  boards,
  onReport,
  onOpen,
  onMenu,
}: {
  laneNames: readonly string[];
  boards: BoardListItem[];
  onReport: (boardId: string, overdueDays: number | null) => void;
  onOpen: (board: BoardListItem) => void;
  onMenu: (board: BoardListItem) => void;
}) {
  const { isWide } = useLayout();
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  const measured = useMeasuredWidths(laneNames);
  const inner = width - 2 * ROW_PAD - (isWide ? NAME_WIDTH + space.md : 0);
  const cols = useMemo(
    () => (inner > 0 && measured.widths ? laneColumns(inner, ROW_PAD, measured.widths) : null),
    [inner, measured.widths],
  );
  return (
    <View style={styles.group} onLayout={onLayout} testID="overview-group">
      {measured.measurer}
      {cols ? <LaneNames names={laneNames} cols={cols} /> : null}
      {boards.map((b) => (
        <BoardRow
          key={b.id}
          board={b}
          cols={cols}
          onReport={onReport}
          onOpen={() => onOpen(b)}
          onMenu={() => onMenu(b)}
        />
      ))}
    </View>
  );
}

/**
 * Each name's width as drawn, from a hidden copy of the names laid out at
 * their natural width, in the font and on the platform at hand: what
 * `laneColumns` needs to write every name in full. Null until each has been
 * laid out; laid out again when a font arrives or a name changes.
 *
 * The copy sits in a box of no size that clips it, so its 2000-point row can
 * neither be seen nor widen the page.
 */
function useMeasuredWidths(names: readonly string[]) {
  const key = names.join('\u0000');
  const [measured, setMeasured] = useState<{ key: string; widths: (number | undefined)[] }>({
    key,
    widths: [],
  });
  const current = measured.key === key ? measured.widths : [];
  const complete = names.length > 0 && names.every((_, i) => current[i] !== undefined);
  const measurer = (
    <View style={styles.measureClip} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.measureRow} key={key}>
        {names.map((name, i) => (
          <Text
            key={i}
            style={[styles.name, styles.measured]}
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              setMeasured((prev) => {
                const base = prev.key === key ? prev.widths : [];
                if (base[i] === w) return prev;
                const widths = [...base];
                widths[i] = w;
                return { key, widths };
              });
            }}
          >
            {/* A box of no size is never reported laid out: a blank name is
                measured as one space. */}
            {name || '\u00a0'}
          </Text>
        ))}
      </View>
    </View>
  );
  return { measurer, widths: complete ? (current as number[]) : null };
}

/**
 * A group's heading: its lanes' names over the marks' columns, straight where
 * each fits its column on one line, otherwise in full on a slant, so every
 * lane is on screen and nothing scrolls sideways (Faisal, 2026-11-15). Hidden
 * from screen readers: each row says its lanes' names with their marks.
 */
function LaneNames({ names, cols }: { names: readonly string[]; cols: LaneColumns }) {
  const t = useTheme();
  const { isWide } = useLayout();
  return (
    <View
      style={isWide ? styles.headingWide : styles.headingNarrow}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      aria-hidden
    >
      <View
        style={[styles.cells, { width: cols.width }, !cols.straight && { height: cols.height }]}
        testID="overview-names"
      >
        {names.map((name, i) => (
          <View key={`${i}:${name}`} style={styles.cell}>
            {cols.straight ? (
              <Text style={[styles.name, { color: t.text.secondary }]} numberOfLines={1}>
                {name}
              </Text>
            ) : (
              <Text
                numberOfLines={1}
                style={[
                  styles.name,
                  styles.slanted,
                  {
                    color: t.text.secondary,
                    // Its own width, stated: a rotated Text wraps to its cell
                    // before it turns, and react-native-web caps a one-line
                    // Text at its parent's width unless told otherwise.
                    width: cols.nameWidths[i],
                    maxWidth: cols.nameWidths[i],
                    transform: [{ rotate: `-${cols.angle}deg` }],
                  },
                ]}
              >
                {name}
              </Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

type Loaded = { status: 'loading' } | { status: 'error'; code?: string } | { status: 'ready'; infos: LaneInfo[] };

/**
 * One board: its name, its Start and End dates if set, and one mark per lane.
 * It listens to its own cards, works out each lane's state, and reports how
 * overdue it is for the order. A board whose cards could not load says so,
 * rather than drawing marks that read as "nothing here".
 */
function BoardRow({
  board,
  cols,
  onReport,
  onOpen,
  onMenu,
}: {
  board: BoardListItem;
  /** The group's columns; null until the group has measured itself. */
  cols: LaneColumns | null;
  onReport: (boardId: string, overdueDays: number | null) => void;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const t = useTheme();
  const { isWide } = useLayout();
  const cards = useBoardCards(board.id);
  const today = todayInOrgTz();

  const loaded: Loaded = useMemo(() => {
    if (cards.status === 'loading') return { status: 'loading' };
    if (cards.status === 'error') return { status: 'error', code: cards.error };
    return {
      status: 'ready',
      infos: board.lanes.map((l) => laneInfo(cards.data ?? [], board, l.id, today)),
    };
  }, [cards.status, cards.data, cards.error, board, today]);

  // Reported once known: a failed read is not "nothing late" (`sortOverview`).
  const days =
    cards.status === 'ready'
      ? boardOverdueDays(cards.data ?? [], board, today)
      : cards.status === 'error'
        ? null
        : undefined;
  useEffect(() => {
    if (days !== undefined) onReport(board.id, days);
  }, [board.id, days, onReport]);

  const start = namedFieldValue(board, 'start');
  const end = namedFieldValue(board, 'end');
  const dates =
    start && end
      ? `${shortDay(start, today)} – ${shortDay(end, today)}`
      : start
        ? `Starts ${shortDay(start, today)}`
        : end
          ? `Ends ${shortDay(end, today)}`
          : null;

  // The row is ONE element to a screen reader, as a row of a board list is,
  // so its name carries every mark: on iOS an element with a name hides what
  // is inside it.
  const spoken =
    loaded.status === 'ready'
      ? board.lanes.map((l, i) => describeMark(l.name, loaded.infos[i])).join('; ')
      : loaded.status === 'error'
        ? 'its cards could not be loaded'
        : 'loading';
  const label = `${board.name}${dates ? `, ${dates}` : ''}: ${spoken}`;

  // The board's other details, behind a chevron (#118): what has a value,
  // in the board's order, less the dates the row already shows.
  const shown = board.fields.filter(
    (f) => !isNamedType(f.type) && (board.details[f.id] ?? '') !== '',
  );
  const { open: openIds } = overviewDetailsView.use();
  const expanded = shown.length > 0 && openIds.includes(board.id);
  const toggle = () =>
    overviewDetailsView.set((prev) => ({
      open: prev.open.includes(board.id)
        ? prev.open.filter((id) => id !== board.id)
        : [...prev.open, board.id],
    }));

  // The card holds the row, which opens the board, and beside it (never
  // inside: a control inside a button is invalid, and a press on it would
  // open the board) the chevron and the details it shows. The row keeps the
  // padding it always had, so the lane geometry measured for the group is
  // unchanged.
  return (
    <View style={[styles.card, { backgroundColor: t.bg.surface, borderColor: t.border.subtle }]}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the board. Press and hold to hide it from your overview."
      testID={`overview-row:${board.name}`}
      onPress={onOpen}
      onLongPress={onMenu}
      {...contextMenuProps(onMenu)}
      style={({ pressed }) => [
        styles.row,
        isWide && styles.rowWide,
        { backgroundColor: pressed ? t.bg.inset : 'transparent' },
      ]}
    >
      <View
        style={[
          styles.title,
          isWide && styles.titleWide,
          shown.length > 0 && styles.titleBesideToggle,
          shown.length > 0 && !isWide && styles.titleBesideToggleNarrow,
        ]}
      >
        <Text style={[type.body, styles.boardName, { color: t.text.primary }]} numberOfLines={2}>
          {board.name}
        </Text>
        {dates ? <Hint>{dates}</Hint> : null}
      </View>
      {loaded.status === 'error' ? (
        <View style={styles.grow}>
          <Hint>This board’s cards could not be loaded.</Hint>
        </View>
      ) : cols ? (
        <Marks cols={cols} count={board.lanes.length} infos={loaded.status === 'ready' ? loaded.infos : null} />
      ) : null}
    </Pressable>
      {shown.length > 0 ? (
        <View
          pointerEvents="box-none"
          style={[styles.toggleSlot, isWide ? styles.toggleSlotWide : styles.toggleSlotNarrow]}
        >
          <DetailsToggle name={board.name} expanded={expanded} onToggle={toggle} />
        </View>
      ) : null}
      {expanded ? (
        <BoardDetails fields={shown} details={board.details} wide={isWide} />
      ) : null}
    </View>
  );
}

/**
 * Which rows have their details open: for this session, so opening a board
 * and coming Back finds them as they were, and not stored on the account.
 */
const overviewDetailsView = createViewStore<{ open: string[] }>({ open: [] });

/** The chevron that shows and hides a row's details. */
function DetailsToggle({
  name,
  expanded,
  onToggle,
}: {
  name: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Details of ${name}`}
      accessibilityState={{ expanded }}
      // react-native-web maps accessibilityState.expanded to nothing.
      aria-expanded={expanded}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.toggle,
        { backgroundColor: pressed ? t.bg.inset : 'transparent' },
      ]}
    >
      <Icon name={expanded ? 'expand-less' : 'expand-more'} size={24} color={t.text.secondary} />
    </Pressable>
  );
}

/**
 * A board's details as label and value: a wrapping grid on a wide screen, a
 * list on a phone. Read-only, as the overview is. Dates read as the Details
 * page writes them; a link opens only when it is http or https (`safeLink`),
 * checked here again since another client could have stored anything.
 */
function BoardDetails({
  fields,
  details,
  wide,
}: {
  fields: readonly BoardField[];
  details: Readonly<Record<string, string>>;
  wide: boolean;
}) {
  const t = useTheme();
  const today = todayInOrgTz();
  return (
    <View
      testID="overview-details"
      style={[styles.details, wide && styles.detailsWide, { borderTopColor: t.border.subtle }]}
    >
      {fields.map((f) => {
        const value = details[f.id] ?? '';
        const link = f.type === 'link' ? safeLink(value) : null;
        return (
          <View key={f.id} style={[styles.detail, wide && styles.detailWide]}>
            <Text style={[type.caption, styles.detailLabel, { color: t.text.secondary }]}>{f.name}</Text>
            {link ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${f.name}: ${link}`}
                onPress={() => void Linking.openURL(link).catch(() => undefined)}
              >
                <Text style={[type.body, styles.detailLink, { color: t.text.accent }]} numberOfLines={1}>
                  {link}
                </Text>
              </Pressable>
            ) : (
              <Text style={[type.body, { color: t.text.primary }]} selectable>
                {/* A date in a shape the app never writes reads as written. */}
                {isDateType(f.type) && isRealDate(value) ? shortDay(value, today) : value}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** One mark per lane, in the columns the group's heading draws its names over. */
function Marks({ cols, count, infos }: { cols: LaneColumns; count: number; infos: LaneInfo[] | null }) {
  return (
    <View style={[styles.cells, { width: cols.width }]}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.cell, styles.markCell]} testID="overview-mark">
          {infos ? <Mark info={infos[i]} size={cols.mark} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * A lane's state as shape AND colour, so it reads without colour: a tick on
 * green (complete), an exclamation on red (late), filled (soon), a ring
 * (under way), a dashed ring (no due dates) and a dash (no cards).
 */
function Mark({ info, size }: { info: LaneInfo; size: number }) {
  const t = useTheme();
  const box = { width: size, height: size, borderRadius: size / 2 };
  switch (info.status) {
    case 'complete':
      return (
        <View style={[styles.mark, box, { backgroundColor: t.feedback.success }]}>
          <Icon name="check" size={Math.round(size * 0.7)} color={t.text.inverse} />
        </View>
      );
    case 'late':
      return (
        <View style={[styles.mark, box, { backgroundColor: t.feedback.danger }]}>
          <Text style={[styles.bang, { color: t.text.inverse, fontSize: Math.round(size * 0.62) }]}>!</Text>
        </View>
      );
    case 'soon':
      return <View style={[styles.mark, box, { backgroundColor: t.feedback.warning }]} />;
    case 'open':
      return <View style={[styles.mark, box, styles.ring, { borderColor: t.text.secondary }]} />;
    case 'undated':
      return (
        <View style={[styles.mark, box, styles.ring, styles.dashed, { borderColor: t.text.secondary }]} />
      );
    case 'none':
      return (
        <View style={[styles.dash, { width: Math.round(size * 0.6), backgroundColor: t.text.secondary }]} />
      );
  }
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 0 },
  start: { alignItems: 'flex-start' },
  controls: { alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  group: { gap: space.sm },
  /**
   * The heading is inset exactly as a row's marks are: a row's padding on a
   * phone, and on a wide screen the board's name column as well.
   */
  headingNarrow: { paddingHorizontal: ROW_PAD },
  headingWide: { paddingLeft: ROW_PAD + NAME_WIDTH + space.md, paddingRight: ROW_PAD },
  cells: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minWidth: 0 },
  markCell: { height: MARK_MAX, justifyContent: 'center' },
  name: { fontSize: NAME_FONT, fontWeight: '600', textAlign: 'center' },
  measureClip: { position: 'absolute', width: 0, height: 0, overflow: 'hidden' },
  measureRow: { position: 'absolute', left: 0, top: 0, width: 2000, alignItems: 'flex-start' },
  measured: { alignSelf: 'flex-start', textAlign: 'left' },
  /**
   * A slanted name starts at its column's centre and leans up to the right,
   * turning about its bottom-left corner. It overflows its cell on purpose;
   * `laneColumns` keeps the room the furthest-reaching one needs.
   */
  slanted: {
    position: 'absolute',
    left: '50%',
    bottom: 2,
    textAlign: 'left',
    transformOrigin: 'left bottom',
  },
  // Not clipped: the row's keyboard focus ring is drawn outside its box, and
  // a clipping card would hide it. The row rounds its own pressed shade.
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  row: {
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.md,
  },
  /**
   * Room on the title's right for the chevron, so a long name wraps before it,
   * and on a phone a title at least as tall as the chevron's 44-point box
   * reaches below the row's padding, so the marks under it start clear of the
   * chevron's touch area even with no dates line.
   */
  titleBesideToggle: { paddingRight: TOGGLE + space.xs },
  titleBesideToggleNarrow: { minHeight: TOGGLE - space.md + StyleSheet.hairlineWidth },
  toggleSlot: { position: 'absolute', top: space.md - (TOGGLE - 22) / 2 },
  toggleSlotNarrow: { right: space.xs },
  // At the right edge of the name column, which ends at ROW_PAD + NAME_WIDTH.
  toggleSlotWide: { left: ROW_PAD + NAME_WIDTH - TOGGLE },
  toggle: {
    width: TOGGLE,
    height: TOGGLE,
    borderRadius: TOGGLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.sm,
  },
  detailsWide: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.sm },
  detail: { gap: 2, minWidth: 0 },
  detailWide: { flexBasis: 220, flexGrow: 1, maxWidth: 360 },
  detailLabel: { textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '600' },
  detailLink: { textDecorationLine: 'underline' },
  rowWide: { flexDirection: 'row', alignItems: 'center' },
  title: { gap: 2 },
  titleWide: { width: NAME_WIDTH, marginRight: space.md },
  boardName: { fontWeight: '600' },
  mark: { alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2 },
  dashed: { borderStyle: 'dashed' },
  bang: { fontWeight: '800' },
  dash: { height: 2, borderRadius: 1 },
});
