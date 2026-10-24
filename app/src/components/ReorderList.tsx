import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { Icon } from '../icons';
import { radius, space, useTheme, type Theme } from '../theme';

/**
 * A user-reorderable list with a drag HANDLE — the native sibling (web:
 * ReorderList.web.tsx). Reorderable lists use a handle, not up/down buttons.
 *
 * This stack ships no GESTURE library (no gesture-handler, by design), so the
 * drag is hand-rolled with PanResponder + Animated: the handle picks the row up,
 * it follows the finger, and on release the row is dropped at the index its
 * travel implies (rounded to whole rows). Fine for a short list (columns are a
 * handful, fixed height, no nested scroll).
 *
 * Reanimated IS present — `react-native-keyboard-controller` requires it, and
 * `RichEditor.tsx` uses one worklet to read the caret. It is not used here: a
 * PanResponder drag that works has no reason to be rewritten.
 */
const ROW_GAP = space.xs;

export function ReorderList<T>({
  items,
  keyOf,
  renderItem,
  onReorder,
  disabled,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onReorder: (next: T[]) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [dragKey, setDragKey] = useState<string | null>(null);
  const pan = useRef(new Animated.Value(0)).current;
  const rowH = useRef(56);
  const startIndex = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const onGrant = useCallback(
    (key: string) => {
      startIndex.current = itemsRef.current.findIndex((i) => keyOf(i) === key);
      pan.setValue(0);
      setDragKey(key);
    },
    [keyOf, pan],
  );
  const onMove = useCallback((dy: number) => pan.setValue(dy), [pan]);
  const onRelease = useCallback(
    (dy: number) => {
      const from = startIndex.current;
      const delta = Math.round(dy / rowH.current);
      const to = Math.max(0, Math.min(itemsRef.current.length - 1, from + delta));
      pan.setValue(0);
      setDragKey(null);
      if (from >= 0 && to !== from) {
        const next = [...itemsRef.current];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onReorder(next);
      }
    },
    [onReorder, pan],
  );

  return (
    <View>
      {items.map((item, index) => {
        const key = keyOf(item);
        return (
          <ReorderRow
            key={key}
            itemKey={key}
            first={index === 0}
            dragging={dragKey === key}
            pan={pan}
            rowH={rowH}
            disabled={!!disabled}
            onGrant={onGrant}
            onMove={onMove}
            onRelease={onRelease}
            t={t}
          >
            {renderItem(item)}
          </ReorderRow>
        );
      })}
    </View>
  );
}

function ReorderRow({
  itemKey,
  first,
  dragging,
  pan,
  rowH,
  disabled,
  onGrant,
  onMove,
  onRelease,
  t,
  children,
}: {
  itemKey: string;
  first: boolean;
  dragging: boolean;
  pan: Animated.Value;
  rowH: React.MutableRefObject<number>;
  disabled: boolean;
  onGrant: (key: string) => void;
  onMove: (dy: number) => void;
  onRelease: (dy: number) => void;
  t: Theme;
  children: ReactNode;
}) {
  // Created once so an active gesture isn't dropped by the grant re-render.
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: (_e, g) => !disabled && Math.abs(g.dy) > 2,
      onPanResponderGrant: () => onGrant(itemKey),
      onPanResponderMove: (_e, g) => onMove(g.dy),
      onPanResponderRelease: (_e, g) => onRelease(g.dy),
      onPanResponderTerminate: () => onRelease(0),
    }),
  ).current;

  return (
    <Animated.View
      onLayout={(e) => {
        if (first) rowH.current = e.nativeEvent.layout.height + ROW_GAP;
      }}
      style={[
        styles.row,
        { borderColor: t.border.subtle, backgroundColor: t.bg.surface },
        dragging && {
          transform: [{ translateY: pan }],
          borderColor: t.accent.base,
          opacity: 0.97,
          zIndex: 2,
          elevation: 4,
        },
      ]}
    >
      <View {...responder.panHandlers} hitSlop={10} style={styles.handle}>
        <Icon
          name="drag-indicator"
          size={22}
          color={t.text.muted}
          accessibilityLabel="Drag to reorder"
        />
      </View>
      <View style={styles.content}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    marginBottom: ROW_GAP,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  handle: { paddingRight: space.xs },
  content: { flex: 1 },
});
