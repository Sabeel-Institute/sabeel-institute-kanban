import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { describeLane, laneBadge, type LaneInfo } from '@sabeel/shared';
import { space, type, useTheme } from '../../theme';
import { DisclosureHeading } from '../ui';

/**
 * A lane's heading on the board: its name, and one badge saying how many of
 * its cards are finished, in every column. Green only when the lane is
 * complete, red when a card is late, the ordinary secondary colour otherwise.
 * "No lane" has no badge: nothing is counted towards it.
 *
 * One component for every board layout, so the phone, the browser and a tablet
 * cannot word or colour a lane differently. The badge's colour is said in
 * words to a screen reader (`describeLane`).
 */
/**
 * Every lane heading carries this, collapsible (a button) or not (a header),
 * on the element that holds its words: the suites, the sweep and the manual's
 * pictures find lanes by it, not by a role that changes with collapsing.
 */
const LANE_HEADING_TEST_ID = 'lane-heading';

export function LaneHeading({
  name,
  info,
  collapsed,
  onToggle,
  here,
  bell,
  stacked,
}: {
  name: string;
  info: LaneInfo | null;
  /**
   * With `onToggle`, the heading folds the lane's cards away and opens them
   * again (#115). Collapsed, it still says the lane's count in its colour:
   * collapsing hides cards, never the lane's state.
   */
  collapsed?: boolean;
  onToggle?: () => void;
  /**
   * How many of the lane's cards are in THIS column. Said only while folded,
   * when the cards are not there to count: the badge is the whole board's.
   */
  here?: number;
  /** The lane's bell, beside its count and outside the fold button. */
  bell?: ReactNode;
  /**
   * The count on its own line under the name: the lane grid's narrow name
   * column, where name, count, + and bell do not fit on one row.
   */
  stacked?: boolean;
}) {
  const t = useTheme();
  const colour =
    info?.status === 'complete'
      ? t.feedback.success
      : info?.status === 'late'
        ? t.feedback.danger
        : t.text.secondary;
  const folded = !!onToggle && !!collapsed && here !== undefined;
  const label = `${info ? describeLane(name, info) : name}${folded ? `, ${here} in this column` : ''}`;
  const words = (
    <>
      {/* Shrinks and wraps, so a long name cannot push the badge off the row:
          Yoga's flexShrink defaults to 0, unlike CSS. */}
      <Text style={[type.label, styles.name, { color: t.text.secondary }]}>
        {name}
        {folded ? <Text style={styles.here}>{`  · ${here} here`}</Text> : null}
      </Text>
      {info ? (
        <Text style={[type.label, styles.badge, { color: colour }]}>{laneBadge(info)}</Text>
      ) : null}
    </>
  );
  if (onToggle) {
    return (
      <View style={[styles.toggleGap, styles.withBell]}>
        <View style={styles.grow}>
          <DisclosureHeading
          label={label}
          expanded={!collapsed}
          onToggle={onToggle}
          testID={LANE_HEADING_TEST_ID}
        >
            <View style={[styles.row, styles.inToggle, stacked && styles.stacked]}>{words}</View>
          </DisclosureHeading>
        </View>
        {bell}
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={label}
      testID={LANE_HEADING_TEST_ID}
      style={styles.row}
    >
      {words}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.sm,
    paddingTop: space.sm,
    paddingHorizontal: 2,
  },
  name: {
    flexShrink: 1,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  badge: { flexShrink: 0, fontWeight: '600', fontVariant: ['tabular-nums'] },
  // The chevron's row is a 44-point target; the words sit on its baseline
  // without the plain heading's own top padding.
  toggleGap: { paddingTop: space.xs },
  inToggle: { paddingTop: 0, paddingHorizontal: 0 },
  withBell: { flexDirection: 'row', alignItems: 'center' },
  stacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 2, flexShrink: 1, minWidth: 0 },
  grow: { flex: 1, minWidth: 0 },
  // Ordinary case and weight beside the capitals: a count, not a name.
  here: { textTransform: 'none', letterSpacing: 0, fontWeight: '400' },
});
