import { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { groupByDue, todayInOrgTz, type Label } from '@sabeel/shared';
import { useLabels } from '../labels';
import { myWorkView, useMySubscriptions, useMyWork, type MyWorkCard } from '../myWork';
import { useMyBoards, type BoardListItem, type BoardMemberProfile } from '../boards';
import type { SessionUser } from '../session';
import { useNav } from '../nav';
import {
  Card as Panel,
  CardGrid,
  FilterChip,
  Heading,
  Hint,
  Row,
  LoadError,
  Screen,
  Spinner,
  Title,
} from '../components/ui';
import { CardFace } from '../components/CardFace';
import { space } from '../theme';

const NO_LABELS: Label[] = [];
const NO_MEMBERS: BoardMemberProfile[] = [];

/**
 * Everything assigned to me, everywhere — the reason this app beats opening five
 * boards in turn, and the phone's most useful screen.
 */
export function MyWorkScreen({ user }: { user: SessionUser }) {
  const nav = useNav();
  const work = useMyWork(user);
  const subs = useMySubscriptions(user);
  const boards = useMyBoards(user);
  /**
   * Which half of My Work is showing.
   *
   * BOTH queries run regardless, so switching is instant and the counts on the
   * chips are real. Two `array-contains` queries over a collection of tens of
   * cards is not a cost worth a spinner.
   */
  const { mode } = myWorkView.use();
  const setMode = (m: 'assigned' | 'subscribed') => myWorkView.set({ mode: m });
  const today = todayInOrgTz();

  // Labels are org-wide, so they resolve without knowing which board a card is
  // on. That is the whole reason chips render here at all: this list is
  // cross-board, and while labels lived on the board document a card from any
  // board other than the one loaded showed no chips.
  const allLabels = useLabels();

  // Assignees still resolve against each card's OWN board, taken from the
  // caller's board list — membership IS per board. Sound because assignment
  // implies membership.
  const boardById = useMemo(() => {
    const m = new Map<string, BoardListItem>();
    for (const b of boards.data ?? []) m.set(b.id, b);
    return m;
  }, [boards.data]);

  /**
   * Only work on a board you can actually see.
   *
   * `useMyWork` is a flat card query — `assigneeUids array-contains me` — so it
   * knows nothing about boards, and an ARCHIVED board's cards kept turning up
   * here forever: rendered as "in a board", with no name, no labels and no
   * assignee chips, because the board is not in `boardById`. Archiving a board
   * is meant to put it away; leaving its work in everyone's list is the opposite.
   *
   * Scoping to the board list is the same thing Search already does, and it
   * needs no denormalised `boardArchived` on every card. Sound either way:
   * `useMyBoards` drops archived boards, gives everyone the boards they belong
   * to (and assignment implies membership), and an admin every live board.
   */
  const onVisibleBoard = useCallback(
    (cards: MyWorkCard[] | undefined) =>
      (cards ?? []).filter((c) => boardById.has(c.boardId)),
    [boardById],
  );
  const assigned = useMemo(() => onVisibleBoard(work.data), [work.data, onVisibleBoard]);
  const subscribed = useMemo(() => onVisibleBoard(subs.data), [subs.data, onVisibleBoard]);

  // A card assigned to you AND subscribed appears in both lists, deliberately:
  // the two answer different questions, and hiding it from one would make the
  // counts disagree with what you can see.
  const visible = mode === 'assigned' ? assigned : subscribed;
  const groups = useMemo(() => groupByDue(visible, today), [visible, today]);

  // Wait for BOTH: filtering against a board list that has not arrived yet would
  // briefly show "nothing assigned to you" to someone who has plenty.
  if (
    work.status === 'loading' ||
    subs.status === 'loading' ||
    boards.status === 'loading'
  ) {
    return <Spinner label="Loading your work…" />;
  }
  // Only the list being VIEWED can take the screen down. A failure in the other
  // one must not cost you the phone's most useful screen — and its chip shows
  // "?" rather than a count, because reporting 0 for a query that errored is
  // the same "not loaded is not empty" lie that has bitten this codebase twice.
  const activeFailed = mode === 'assigned' ? work.status === 'error' : subs.status === 'error';
  const countFor = (state: { status: string }, list: MyWorkCard[]) =>
    state.status === 'error' ? '?' : String(list.length);

  if (activeFailed || boards.status === 'error') {
    return (
      <Screen width="list">
        <Title>My work</Title>
        <LoadError what="your work" />
      </Screen>
    );
  }

  const total = visible.length;

  return (
    <Screen width="list">
      {/* No Back button: My work is a tab root reached from the nav bar, never
          pushed, so there is nothing to go back to. */}
      <Title>My work</Title>

      {/* A mode switch, not two filters: exactly one is ever active, so the
          chips read as "which list am I looking at". Counts are shown because
          both queries are already running and "is there anything over there?"
          is the question a hidden tab always raises. */}
      <Row style={styles.modes}>
        <FilterChip
          label={`Assigned (${countFor(work, assigned)})`}
          active={mode === 'assigned'}
          onPress={() => setMode('assigned')}
        />
        <FilterChip
          label={`Subscribed (${countFor(subs, subscribed)})`}
          active={mode === 'subscribed'}
          onPress={() => setMode('subscribed')}
        />
      </Row>

      <Hint>
        {mode === 'assigned'
          ? total === 0
            ? 'Nothing is assigned to you right now.'
            : `${total} card${total === 1 ? '' : 's'} assigned to you across all your boards.`
          : total === 0
            ? 'You have not subscribed to any cards. Open a card and use the bell to hear about everything on it.'
            : `${total} card${total === 1 ? '' : 's'} you subscribe to.`}
      </Hint>

      {groups.map((g) => (
        <View key={g.bucket}>
          <Heading>
            {g.label} ({g.cards.length})
          </Heading>
          <CardGrid>
            {g.cards.map((c: MyWorkCard) => {
              const board = boardById.get(c.boardId);
              return (
                <Pressable
                  key={`${c.boardId}/${c.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={c.title}
                  testID={`card-${c.title}`}
                  onPress={() =>
                    nav.push({ name: 'card', boardId: c.boardId, cardId: c.id })
                  }
                >
                  <Panel>
                    <CardFace
                      card={c}
                      labels={allLabels.data ?? NO_LABELS}
                      boardMembers={board?.members ?? NO_MEMBERS}
                    />
                    <Hint>in {board?.name ?? 'a board'}</Hint>
                  </Panel>
                </Pressable>
              );
            })}
          </CardGrid>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  modes: { flexWrap: 'wrap', gap: space.xs },
});
