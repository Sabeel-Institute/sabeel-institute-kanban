import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import {
  describeBoardActivity,
  isKnownBoardActivityType,
  type BoardActivityDoc,
} from '@sabeel/shared';
import { db } from '../firebase';
import { useLiveQuery } from '../liveQuery';
import { when, whenWithin } from '../activityTime';
import { Button, Hint, Row, Spinner } from './ui';
import { radius, space, useTheme } from '../theme';

/** How many entries are shown at first, and how many each Show older adds. */
const PAGE = 20;
/**
 * How many entries are fetched. Read ONCE and revealed a page at a time:
 * growing the query's limit instead would start a new query on every press,
 * and `useLiveQuery` shows a new query as loading, which collapsed the list
 * under the reader's thumb. A board changes rarely, so this is years of it.
 */
const FETCHED = 200;

interface Entry extends Partial<BoardActivityDoc> {
  id: string;
}

/**
 * The board's history, newest first: who renamed it, archived it, added or
 * took off whom, and what happened to its columns. Server-written
 * (functions/src/boardHistory.ts), and readable by everyone on the board.
 */
export function BoardHistory({ boardId }: { boardId: string }) {
  const t = useTheme();
  const [shown, setShown] = useState(PAGE);

  const log = useLiveQuery<Entry[]>(
    () =>
      query(
        collection(db, 'boards', boardId, 'activity'),
        orderBy('at', 'desc'),
        limit(FETCHED),
      ),
    [boardId],
    'boardHistory',
    (docs) => docs.map((d) => ({ id: d.id, ...(d.data as Partial<BoardActivityDoc>) })),
  );

  if (log.status === 'loading') return <Spinner />;
  // The failure itself is on the screen's banner; this says what it cost.
  if (log.status === 'error') return <Hint>The board&rsquo;s history could not be loaded.</Hint>;

  const entries = log.data ?? [];
  if (entries.length === 0) return <Hint>No changes recorded yet.</Hint>;

  return (
    <View style={styles.list}>
      {entries.slice(0, shown).map((e) => (
        <Row key={e.id} style={styles.row}>
          <View style={[styles.tick, { backgroundColor: t.border.strong }]} />
          <View style={styles.text}>
            <Hint>
              {/* An entry newer than this build reads as a neutral line, never
                  as nothing and never as some other change. */}
              {isKnownBoardActivityType(e.type)
                ? describeBoardActivity({ ...e, type: e.type })
                : 'The board was changed'}
              {' · '}
              {e.since !== undefined ? whenWithin(e.since, e.at ?? 0) : when(e.at ?? 0)}
            </Hint>
          </View>
        </Row>
      ))}
      {entries.length > shown ? (
        <Button label="Show older" variant="secondary" onPress={() => setShown((n) => n + PAGE)} />
      ) : entries.length === FETCHED ? (
        <Hint>Older changes are not shown.</Hint>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  row: { alignItems: 'flex-start' },
  text: { flex: 1 },
  tick: { width: 6, height: 6, borderRadius: radius.pill, marginTop: 6 },
});
