import { StyleSheet, Text, View } from 'react-native';
import { describeLane, laneBadge, type LaneInfo } from '@sabeel/shared';
import { space, type, useTheme } from '../../theme';

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
export function LaneHeading({ name, info }: { name: string; info: LaneInfo | null }) {
  const t = useTheme();
  const colour =
    info?.status === 'complete'
      ? t.feedback.success
      : info?.status === 'late'
        ? t.feedback.danger
        : t.text.secondary;
  return (
    <View
      accessible
      accessibilityRole="header"
      accessibilityLabel={info ? describeLane(name, info) : name}
      style={styles.row}
    >
      {/* Shrinks and wraps, so a long name cannot push the badge off the row:
          Yoga's flexShrink defaults to 0, unlike CSS. */}
      <Text style={[type.label, styles.name, { color: t.text.secondary }]}>{name}</Text>
      {info ? (
        <Text style={[type.label, styles.badge, { color: colour }]}>{laneBadge(info)}</Text>
      ) : null}
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
});
