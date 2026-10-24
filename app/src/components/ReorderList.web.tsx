import { useState, type ReactNode } from 'react';
import { Icon } from '../icons';
import { radius, space, useTheme } from '../theme';

/**
 * A user-reorderable list with a drag HANDLE — the web sibling (native:
 * ReorderList.tsx). Reorderable lists use a handle, not up/down buttons.
 *
 * WEB uses the HTML5 drag API on raw <div>s — the same approach the board uses
 * for cards (react-native-web's View does not forward drag props cleanly, so we
 * drop to the DOM). `onReorder` fires once, on drop, with the new order.
 */
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
  const [overKey, setOverKey] = useState<string | null>(null);

  function drop(targetKey: string) {
    const from = items.findIndex((i) => keyOf(i) === dragKey);
    const to = items.findIndex((i) => keyOf(i) === targetKey);
    setDragKey(null);
    setOverKey(null);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  }

  return (
    <div>
      {items.map((item) => {
        const key = keyOf(item);
        const dragging = dragKey === key;
        const isOver = overKey === key && dragKey !== null && dragKey !== key;
        return (
          <div
            key={key}
            draggable={!disabled}
            onDragStart={(e) => {
              setDragKey(key);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
              setDragKey(null);
              setOverKey(null);
            }}
            onDragOver={(e) => {
              if (dragKey && dragKey !== key) {
                e.preventDefault();
                setOverKey(key);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(key);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              padding: space.sm,
              marginBottom: space.xs,
              borderRadius: radius.md,
              border: `1px solid ${isOver ? t.accent.base : t.border.subtle}`,
              background: t.bg.surface,
              opacity: dragging ? 0.4 : 1,
              cursor: disabled ? 'default' : 'grab',
            }}
          >
            <Icon
              name="drag-indicator"
              size={20}
              color={t.text.muted}
              // The whole row is draggable; the handle just signals where to grab.
              accessibilityLabel="Drag to reorder"
            />
            {/* `minWidth: 0` is the load-bearing half. A flex item defaults to
                min-width:auto, which refuses to shrink below its content, so a
                long column name overflowed this row and carried its rename
                pencil past the right edge of the screen instead of
                truncating. */}
            <div style={{ flex: 1, minWidth: 0 }}>{renderItem(item)}</div>
          </div>
        );
      })}
    </div>
  );
}
