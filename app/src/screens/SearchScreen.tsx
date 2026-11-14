import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  filterCards,
  hasActiveFilters,
  orderCards,
  priorityLabel,
  todayInOrgTz,
  toPlainText,
  sortLabels,
  type Label,
  type SearchableCard,
  type SearchSort,
} from '@sabeel/shared';
import { db } from '../firebase';
import { useLabels } from '../labels';
import { useMyBoards, type BoardListItem, type BoardMemberProfile } from '../boards';
import type { SessionUser } from '../session';
import { useNav } from '../nav';
import {
  chipsForIds,
  clearSearchFilters,
  setSearchFilters,
  toggleIn,
  useSearchFilters,
} from '../searchFilters';
import {
  Body,
  Hint,
  CardGrid,
  FilterChip,
  IconAction,
  LoadError,
  Card as Panel,
  Heading,
  Row,
  Screen,
  Spinner,
  TextField,
  Title,
} from '../components/ui';
import { CardFace } from '../components/CardFace';
import { Select, type SelectOption } from '../components/Select';
import { SearchFiltersSheet } from '../components/SearchFiltersSheet';
import type { NarrowItem } from '../components/NarrowList';
import { space } from '../theme';
import { toUserMessage } from '../errors';
import { useLayout } from '../theme/layout';

const NO_LABELS: Label[] = [];
const NO_MEMBERS: BoardMemberProfile[] = [];

/**
 * What tapping an ACTIVE chip does, said plainly.
 *
 * The four id- and value-shaped chips in the second row are not toggles: they
 * exist only while their filter is on, and a tap removes it. `FilterChip`'s
 * default `<label> filter, on` is therefore both less useful and AMBIGUOUS — any
 * member may create a label, so a label called `Urgent` answers to exactly the
 * name the priority chip beside it does, and a
 * board or a colleague could too. Naming the facet as well as the action makes
 * every chip in the row unique against the others, and against the Filters sheet
 * behind them. `Archived` and `Overdue` keep the default: those two really are
 * toggles, with an off state worth announcing.
 */
const removesFilter = (name: string, facet: string) =>
  `Remove the ${name} ${facet} filter`;

/**
 * `Best match` first because it is what Search has always done, and it is right
 * far more often than a date order: it ranks by relevance once you have typed
 * something and by recency when you have not. With an empty box it therefore
 * agrees with `Newest first` exactly — correct, not a duplicate. The two only
 * diverge when there is a query, which is the only state relevance exists in.
 */
const SORTS: readonly SelectOption[] = [
  { value: 'best', label: 'Best match' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
];

/**
 * Search across every board you belong to.
 *
 * Firestore has no full-text search, so this fans out one lightweight query per
 * member board and matches in memory. At this team's scale that is instant, and
 * it works offline over boards already cached. See @sabeel/shared/search for the
 * honest limits.
 *
 * Deliberately a ONE-SHOT fetch rather than a live subscription: search results
 * shifting under your finger while you read them is worse than slightly stale
 * ones, and N live listeners across every board would be a real cost.
 */
export function SearchScreen({ user }: { user: SessionUser }) {
  const nav = useNav();
  const { isWide } = useLayout();
  const boards = useMyBoards(user);
  const allLabels = useLabels();

  /**
   * The filters live OUTSIDE this component (see `../searchFilters`).
   *
   * Opening a card unmounts this screen, so anything held in `useState` here was
   * gone by the time you pressed Back — the text, the chips, the labels. Back is
   * meant to return you to what you were looking at.
   */
  const { text, archivedOnly, overdueOnly, priorities, labelIds, boardId, assigneeUid, sort } =
    useSearchFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [cards, setCards] = useState<SearchableCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boardIds = useMemo(
    () => (boards.data ?? []).map((b) => b.id).join(','),
    [boards.data],
  );
  const boardById = useMemo(() => {
    const m = new Map<string, BoardListItem>();
    for (const b of boards.data ?? []) m.set(b.id, b);
    return m;
  }, [boards.data]);

  // Load card metadata for the user's boards, then filter in memory as they
  // type — refetching per keystroke would be pointless traffic. This used to be
  // ONE query per board; consolidating to a `boardId in [...]` query cuts it to a
  // handful of round trips, and archived cards are dropped server-side unless the
  // toggle asks for them, instead of fetching every card ever and filtering.
  useEffect(() => {
    let cancelled = false;
    const ids = boardIds ? boardIds.split(',') : [];
    if (ids.length === 0) {
      // Only a board list that is READY and empty is an empty result. `?? []`
      // above yields no ids while the boards are still loading and again after
      // that read fails, and `setCards([])` there reports "Nothing to show" — a
      // definite claim that you have no cards — for an org full of them.
      if (boards.status === 'ready') setCards([]);
      return;
    }

    setLoading(true);
    // Firestore `in` takes at most 30 values, so chunk — still far fewer queries
    // than one per board. Uses the (boardId, archived, rank) index's prefix.
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

    Promise.all(
      chunks.map((chunk) => {
        const filters = [where('boardId', 'in', chunk)];
        // Constrain to ONE archive state, never both. The chip narrows the
        // results like every other chip, and this also fetches strictly less.
        filters.push(where('archived', '==', archivedOnly));
        return getDocs(query(collection(db, 'cards'), ...filters)).then((snap) =>
          snap.docs.map<SearchableCard>((d) => ({
            id: d.id,
            boardId: (d.data().boardId as string) ?? '',
            title: (d.data().title as string) ?? '',
            description: (d.data().description as string) ?? '',
            // Stripped ONCE here. `matchesText` would otherwise re-parse every
            // description on every keystroke.
            descriptionPlain: toPlainText((d.data().description as string) ?? ''),
            columnId: (d.data().columnId as string) ?? '',
            assigneeUids: (d.data().assigneeUids as string[]) ?? [],
            labelIds: (d.data().labelIds as string[]) ?? [],
            priority: d.data().priority ?? 'none',
            dueDate: d.data().dueDate as string | undefined,
            archived: Boolean(d.data().archived),
            // All three feed `lastActivityOf`, which takes the max — see its
            // note in @sabeel/shared for why none of them is enough alone.
            updatedAt: (d.data().updatedAt as number) ?? 0,
            lastActivityAt: (d.data().lastActivityAt as number) ?? 0,
            createdAt: (d.data().createdAt as number) ?? 0,
          })),
        );
      }),
    )
      .then((per) => {
        if (!cancelled) setCards(per.flat());
      })
      .catch((e) => {
        if (!cancelled) setError(toUserMessage(e, 'search'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [boardIds, archivedOnly, boards.status]);

  // Sorted the way the rest of the app sorts labels, so an emoji-prefixed name
  // files under its word rather than under the emoji. Institute labels, and the
  // own labels of the boards you can search, each naming its board: two boards
  // can each have a "Homework", and this is how you tell them apart.
  const labelList = useMemo<NarrowItem[]>(() => {
    const boardName = new Map((boards.data ?? []).map((b) => [b.id, b.name]));
    return sortLabels([...(allLabels.data ?? NO_LABELS)])
      .filter((l) => !l.boardId || boardName.has(l.boardId))
      .map((l) => ({
        id: l.id,
        name: l.name,
        ...(l.boardId ? { detail: boardName.get(l.boardId) } : {}),
      }));
  }, [allLabels.data, boards.data]);

  const boardList = useMemo<NarrowItem[]>(
    () =>
      [...(boards.data ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({ id: b.id, name: b.name })),
    [boards.data],
  );

  /**
   * Everyone who could be an assignee on a card you can see.
   *
   * The union of the boards' own member profiles, deduped — NOT `users/*`,
   * which only admins may list (`firestore.rules`), while Search is for
   * everyone. `memberProfiles` is denormalised onto each board for exactly this
   * kind of question. Assignees are rules-constrained to board members, so this
   * set is complete for anyone still assignable.
   */
  const people = useMemo<NarrowItem[]>(() => {
    const byUid = new Map<string, BoardMemberProfile>();
    for (const b of boards.data ?? []) {
      for (const m of b.members) if (!byUid.has(m.uid)) byUid.set(m.uid, m);
    }
    return [...byUid.values()]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((m) => ({ id: m.uid, name: m.displayName, detail: m.email }));
  }, [boards.data]);

  /**
   * A chip for every active pick — INCLUDING one whose subject no longer exists.
   *
   * Building chips by filtering a live list down to the chosen ids means a dead
   * id produces no chip at all while it goes on narrowing the results: the
   * screen empties with no cause shown and nothing to tap. All three id-shaped
   * facets can genuinely go stale — `deleteLabel` removes a label mid-filter,
   * archiving a board drops it out of `useMyBoards`, and `removeBoardMember`
   * can take away the last board a chosen assignee shared with you — so all
   * three go through the one tested helper rather than three inline copies.
   *
   * THREE STATES reach all the way to the chip's words. `boards.data ?? []` and
   * `allLabels.data ?? []` above turn both "still loading" and "that read
   * failed" into "there are none of these" — so a perfectly live id gets a chip
   * reading `Deleted label` or `Someone no longer on a board`. Those are
   * definite claims about a colleague or a label, made from an absence of
   * information, on the one row whose job is to say what is narrowing the
   * results. Until the list is `ready` the chip names its FACET and asserts
   * nothing; it is still visible and still removable, which is the part that
   * matters.
   */
  const labelsReady = allLabels.status === 'ready';
  const boardsReady = boards.status === 'ready';

  // Against EVERY label, not the picker's list: that one also waits on the
  // boards, and leaves out a board you have since left, so a live label would
  // read "Deleted label" while the boards load or after you leave its board.
  // A board's own label carries its board's name: two boards can each have a
  // "Homework", and two identical chips could not be told apart.
  const chosenLabels = useMemo(() => {
    const boardName = new Map((boards.data ?? []).map((b) => [b.id, b.name]));
    const named = (allLabels.data ?? NO_LABELS).map((l) => {
      const board = l.boardId ? boardName.get(l.boardId) : undefined;
      return { id: l.id, name: board ? `${l.name} (${board})` : l.name };
    });
    return chipsForIds(labelIds, named, labelsReady ? 'Deleted label' : 'Label', sortLabels);
  }, [allLabels.data, boards.data, labelIds, labelsReady]);
  const chosenBoard = chipsForIds(
    boardId ? [boardId] : [],
    boardList,
    boardsReady ? 'Unavailable board' : 'Board',
  );
  const chosenPerson = chipsForIds(
    assigneeUid ? [assigneeUid] : [],
    people,
    boardsReady ? 'Someone no longer on a board' : 'Assignee',
  );

  /**
   * Whether anything is narrowing the results — the ONE condition the clear
   * control appears on. `hasActiveFilters` already answers this in
   * `@sabeel/shared`, so the button cannot drift out of step with what the
   * filters actually do. Note SORT is deliberately absent: reordering a list is
   * not narrowing it, and a clear-all that silently reset the order would be
   * doing something its name does not say.
   */
  const anyActive = hasActiveFilters({
    text,
    archivedOnly,
    priorities,
    labelIds,
    boardId,
    assigneeUid,
    due: overdueOnly ? 'overdue' : undefined,
  });

  // Search BROWSES by default: with no text and no chips it lists everything you
  // can see, most recently active first. It used to show nothing until you
  // typed, which meant the only route to an archived card was knowing its name —
  // you cannot search for something you are trying to find.
  //
  // Everything is filtered AND ordered in memory over the cards already fetched:
  // the query carries no `orderBy` and no `limit`, so the whole visible set is
  // here and a sort in either direction is complete rather than a sort of
  // whatever happened to arrive. That is also why adding one needed no index.
  // Deliberately simple for the size this actually is (tens of cards); the
  // honest limit is the CAP below, which says out loud when it is hiding
  // something rather than silently truncating.
  const { results, total } = useMemo(() => {
    if (!cards) return { results: [], total: 0 };
    const today = todayInOrgTz();
    const matched = filterCards(
      cards,
      {
        text,
        archivedOnly,
        priorities,
        labelIds,
        boardId,
        assigneeUid,
        due: overdueOnly ? 'overdue' : undefined,
      },
      today,
    );
    // The cap slices AFTER the ordering, which is what makes "Oldest first"
    // honest: it shows the 200 oldest rather than 200 arbitrary cards sorted.
    const ordered = orderCards(matched, sort, text);
    return { results: ordered.slice(0, RESULT_CAP), total: ordered.length };
  }, [
    cards,
    text,
    archivedOnly,
    priorities,
    overdueOnly,
    labelIds,
    boardId,
    assigneeUid,
    sort,
  ]);

  return (
    <Screen width="list">
      {/* No Back button: Search is a tab root reached from the nav bar. */}
      <Title>Search</Title>

      {/* The search box and its toggle are a form: keep them a comfortable width
          rather than stretched across the results grid. */}
      <View style={styles.searchBar}>
        <TextField
          value={text}
          onChangeText={(v) => setSearchFilters({ text: v })}
          placeholder="Search cards across your boards"
          // DESKTOP only — which is a width question, not a platform one.
          //
          // Search browses by default now, so a keyboard opening straight over
          // the list the screen exists to show is the bug. On a desktop there is
          // no keyboard to be in the way and Search is a screen you open in
          // order to type, so the cursor is a courtesy.
          //
          // `Platform.OS === 'web'` alone is NOT that distinction: a phone
          // browser is web too, and several colleagues use the app exactly that
          // way, so autofocus opened the on-screen keyboard for them — the
          // native case was fixed and the one it was fixed for was not.
          autoFocus={Platform.OS === 'web' && isWide}
        />

        {/* Two rows, and the split is deliberate.
            The BINARY toggles stay one tap — Archived most of all, since Search
            is the way to the archive — and the sort sits with them because it is
            the other thing that changes what you are looking at without picking
            a value. Everything with a LIST of values, however short, lives
            behind the one Filters control; whatever it selects comes back as a
            chip in the row below, removable by the same gesture as everything
            else. Priority moved in there when it grew from two chips to five:
            "Urgent or High" needs a multi-select, and five more chips in this
            row would be most of a phone screen before any results. */}
        <Row style={styles.chips}>
          <FilterChip
            label="Archived"
            active={archivedOnly}
            onPress={() => setSearchFilters((f) => ({ archivedOnly: !f.archivedOnly }))}
          />
          <FilterChip
            label="Overdue"
            active={overdueOnly}
            onPress={() => setSearchFilters((f) => ({ overdueOnly: !f.overdueOnly }))}
          />
          <Select
            label="Sort"
            value={sort}
            options={SORTS}
            onChange={(v) => setSearchFilters({ sort: v as SearchSort })}
          />
        </Row>

        <Row style={styles.chips}>
          {/* An ACTION, not a toggle: it opens the picker below. `active` stayed
              false because lighting it while the sheet is open describes a state
              nobody sees (the sheet covers it), and whatever gets picked already
              shows as its own chip beside this one. The label is overridden for
              the same reason — "Filters filter, off" announces a filter state
              this control does not have. */}
          <FilterChip
            label="Filters"
            active={false}
            accessibilityLabel="Filters"
            onPress={() => setFiltersOpen(true)}
          />
          {/* Every active pick reads as a chip, so the answer to "what am I
              filtering by?" is one row rather than scattered across controls. */}
          {priorities.map((p) => (
            <FilterChip
              key={p}
              label={priorityLabel(p)}
              accessibilityLabel={removesFilter(priorityLabel(p), 'priority')}
              active
              onPress={() =>
                setSearchFilters((f) => ({ priorities: toggleIn(f.priorities, p) }))
              }
            />
          ))}
          {chosenBoard.map((b) => (
            <FilterChip
              key={b.id}
              label={b.name}
              accessibilityLabel={removesFilter(b.name, 'board')}
              active
              onPress={() => setSearchFilters({ boardId: undefined })}
            />
          ))}
          {chosenPerson.map((p) => (
            <FilterChip
              key={p.id}
              label={p.name}
              accessibilityLabel={removesFilter(p.name, 'assignee')}
              active
              onPress={() => setSearchFilters({ assigneeUid: undefined })}
            />
          ))}
          {chosenLabels.map((l) => (
            <FilterChip
              key={l.id}
              label={l.name}
              accessibilityLabel={removesFilter(l.name, 'label')}
              active
              onPress={() =>
                setSearchFilters((f) => ({
                  labelIds: f.labelIds.filter((id) => id !== l.id),
                }))
              }
            />
          ))}
          {/* Only ever present when there is something to clear, so it is never
              a dead control — and an icon, per the standing rule. */}
          {anyActive ? (
            <IconAction
              icon="filter-alt-off"
              label="Clear all filters"
              onPress={clearSearchFilters}
            />
          ) : null}
        </Row>
      </View>

      {/* One home for every filter that is a LIST of values.
          Four dropdowns stacked above the results would be most of a phone
          screen before a single card; they live here, and whatever they select
          answers in the chip row above. */}
      <SearchFiltersSheet
        visible={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        priorities={priorities}
        onTogglePriority={(p) =>
          setSearchFilters((f) => ({ priorities: toggleIn(f.priorities, p) }))
        }
        boards={boardList}
        boardId={boardId}
        onPickBoard={(id) => setSearchFilters({ boardId: id })}
        labels={labelList}
        labelIds={labelIds}
        onToggleLabel={(id) =>
          setSearchFilters((f) => ({ labelIds: toggleIn(f.labelIds, id) }))
        }
        people={people}
        assigneeUid={assigneeUid}
        onPickAssignee={(uid) => setSearchFilters({ assigneeUid: uid })}
        onClearAll={anyActive ? clearSearchFilters : null}
      />

      {/* Without this the screen waits on a spinner that will never resolve:
          a failed board read leaves `cards` null forever, and the effect above
          deliberately no longer fakes an empty result to get out of it. */}
      {boards.status === 'error' ? <LoadError what="your boards" code={boards.error} /> : null}

      {error ? (
        <Panel style={styles.searchBar}>
          <Body>{error}</Body>
        </Panel>
      ) : null}

      {boards.status !== 'error' && (loading || cards === null) ? (
        <Spinner label="Loading your cards…" />
      ) : null}

      {!loading && cards !== null ? (
        <>
          <Heading>
            {total === 0
              ? 'Nothing to show'
              : text.trim()
                ? `${total} match${total === 1 ? '' : 'es'}`
                : `${total} card${total === 1 ? '' : 's'}`}
          </Heading>
          {total > RESULT_CAP ? (
            <Hint>
              Showing the first {RESULT_CAP}. Narrow it with a filter or a search
              term.
            </Hint>
          ) : null}
        </>
      ) : null}

      <CardGrid>
        {results.map((c) => {
          const board = boardById.get(c.boardId);
          return (
            <Pressable
              key={`${c.boardId}/${c.id}`}
              // Same handle the board tiles carry, so a test can open a card by
              // title on either surface rather than needing two idioms.
              testID={`card-${c.title}`}
              accessibilityRole="button"
              accessibilityLabel={c.title}
              onPress={() => nav.push({ name: 'card', boardId: c.boardId, cardId: c.id })}
            >
              <Panel>
                <CardFace
                  card={c}
                  labels={allLabels.data ?? NO_LABELS}
                  boardMembers={board?.members ?? NO_MEMBERS}
                />
                <Hint>
                  in {board?.name ?? 'a board'}
                  {c.archived ? ' · archived' : ''}
                </Hint>
              </Panel>
            </Pressable>
          );
        })}
      </CardGrid>
    </Screen>
  );
}

/**
 * How many results are drawn. Everything you can see is already in memory, so
 * this bounds the RENDER, not the fetch — and the count below it says how many
 * were left out, because a list that silently stops is a list you cannot trust.
 */
const RESULT_CAP = 200;

const styles = StyleSheet.create({
  chips: { flexWrap: 'wrap', gap: space.xs },
  searchBar: { maxWidth: 520, gap: space.sm },
});
