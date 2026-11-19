import { StyleSheet, View } from 'react-native';
import { IconAction } from '../ui';
import { space } from '../../theme';
import type { useLaneCollapse } from './useLaneCollapse';

/**
 * Collapse every lane, or open every lane, at once (#115). Two icon actions
 * in every layout: in the wide boards' header beside Archived cards, and on a
 * phone in a slim row above the lanes, since the phone's footer already holds
 * Add card and three icons and two more would squeeze Add card below its
 * label at 320 points. Each is disabled when it has nothing to do, so its
 * state says where the board stands. Drawn only on a board with lanes.
 */
export function LaneCollapseActions({
  collapse,
  row,
}: {
  collapse: ReturnType<typeof useLaneCollapse>;
  /** On its own row, right-aligned (the phone), rather than inline in a header. */
  row?: boolean;
}) {
  const actions = (
    <>
      <IconAction
        icon="unfold-less"
        label="Collapse all lanes"
        disabled={collapse.allCollapsed}
        onPress={() => void collapse.collapseAll()}
      />
      <IconAction
        icon="unfold-more"
        label="Expand all lanes"
        disabled={collapse.noneCollapsed}
        onPress={() => void collapse.expandAll()}
      />
    </>
  );
  return row ? <View style={styles.row}>{actions}</View> : actions;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm },
});
