import { StyleSheet, Text } from 'react-native';
import { type, useTheme } from '../../theme';

/**
 * A column's name on the board, with its card count when the layout shows one.
 *
 * Read-only on every board: a column is renamed and deleted in Board settings →
 * Columns, nowhere else. Drawn as the settings page's name is when it is not
 * being edited, so the board and the page read alike.
 */
export function ColumnHeading({
  name,
  count,
  center,
  lines = 1,
  bold,
}: {
  name: string;
  /** The column's cards, said after the name in the muted colour. */
  count?: number;
  /** Centred, wrapping as one centred block: the phone pager. */
  center?: boolean;
  /** Lines before the name truncates: two on the phone pager, which has room above and below. */
  lines?: number;
  bold?: boolean;
}) {
  const t = useTheme();
  return (
    // `shrink`, or Yoga lays a long name out at full width next to the bell
    // and the row overflows its column.
    <Text
      numberOfLines={lines}
      style={[
        type.body,
        bold && styles.bold,
        { color: t.text.secondary },
        styles.shrink,
        center && styles.center,
      ]}
    >
      {name}
      {count !== undefined ? <Text style={{ color: t.text.muted }}>{` (${count})`}</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  center: { textAlign: 'center', alignSelf: 'stretch' },
  bold: { fontWeight: '600' },
});
