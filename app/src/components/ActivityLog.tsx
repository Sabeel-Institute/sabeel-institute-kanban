import { useMemo } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import {
  describeActivity,
  isKnownActivityType,
  type ActivityType,
  type BoardColumn,
  type BoardLane,
} from '@sabeel/shared';
import { db } from '../firebase';
import { when } from '../activityTime';
import { useLiveQuery } from '../liveQuery';
import type { BoardMemberProfile } from '../boards';
import { Hint, Row, Spinner } from './ui';
import { StyleSheet, View } from 'react-native';
import { radius, space, useTheme } from '../theme';

interface Entry {
  id: string;
  /**
   * `null` when this build does not recognise the type — an entry written by a
   * newer release than the one running, which an Android user on a previous APK
   * genuinely sees. It renders as a neutral line rather than as nothing or, far
   * worse, as some other change that did not happen.
   */
  type: ActivityType | null;
  actorUid: string;
  /** Stored by the server when it happened; absent on lines older than that. */
  actorName?: string;
  at: number;
  from?: string;
  to?: string;
}

/**
 * The card's history, newest first.
 *
 * Capped at 50 entries: the timeline answers "what happened recently and who did
 * it", and an unbounded log on an old card would be a slow query nobody scrolls
 * to the end of.
 */
export function ActivityLog({
  cardId,
  members,
  columns,
  lanes,
  cardTitleFor,
}: {
  cardId: string;
  members: readonly BoardMemberProfile[];
  columns: readonly BoardColumn[];
  /** The board's lanes, kept or live, so a lane change names its lane. */
  lanes: readonly BoardLane[];
  /** Resolves a card id to a title, for subtask entries. Those store the other
   *  card's ID rather than its title, so history never goes stale on a rename —
   *  the same reason `moved` stores a column id. */
  cardTitleFor?: (cardId: string) => string;
}) {
  const t = useTheme();

  const log = useLiveQuery<Entry[]>(
    () =>
      query(
        collection(db, 'cards', cardId, 'activity'),
        orderBy('at', 'desc'),
        limit(50),
      ),
    [cardId],
    'activity',
    (docs) =>
      docs.map((d) => ({
        id: d.id,
        type: isKnownActivityType(d.data.type) ? d.data.type : null,
        actorUid: (d.data.actorUid as string) ?? '',
        actorName: typeof d.data.actorName === 'string' ? d.data.actorName : undefined,
        at: (d.data.at as number) ?? 0,
        from: d.data.from as string | undefined,
        to: d.data.to as string | undefined,
      })),
  );

  const nameFor = useMemo(() => {
    const m = new Map(members.map((x) => [x.uid, x.displayName]));
    return (uid: string) => m.get(uid) ?? 'Someone';
  }, [members]);

  const columnNameFor = useMemo(() => {
    const m = new Map(columns.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) ?? 'another column';
  }, [columns]);

  const laneNameFor = useMemo(() => {
    const m = new Map(lanes.map((l) => [l.id, l.name]));
    return (id: string) => m.get(id);
  }, [lanes]);

  if (log.status === 'loading') return <Spinner />;

  const entries = log.data ?? [];
  if (entries.length === 0) return <Hint>No activity recorded yet.</Hint>;

  return (
    <View style={styles.list}>
      {entries.map((e) => (
        <Row key={e.id} style={styles.row}>
          <View style={[styles.tick, { backgroundColor: t.border.strong }]} />
          <Hint>
            {e.actorName ?? nameFor(e.actorUid)}{' '}
            {e.type === null
              ? 'made a change'
              : describeActivity(
                  { type: e.type, from: e.from, to: e.to },
                  nameFor,
                  columnNameFor,
                  cardTitleFor,
                  laneNameFor,
                )}{' '}
            · {when(e.at)}
          </Hint>
        </Row>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  row: { alignItems: 'flex-start' },
  tick: { width: 6, height: 6, borderRadius: radius.pill, marginTop: 6 },
});
