import { useRef } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BOARD_COLORS, BOARD_COLOR_NAMES, type BoardColor } from '@sabeel/shared';
import { Icon } from '../icons';
import { contextMenuProps } from '../contextMenu';
import { space, useTheme } from '../theme';
import { useLayout } from '../theme/layout';
import { Sheet } from './Sheet';

/**
 * A board's colour in the Boards list: a stripe down the left edge of its
 * card, and the way to change it (Faisal, 2026-11-25). Nowhere else draws a
 * board's colour.
 *
 * The stripe IS the control, on every surface: whoever may change the board
 * taps or clicks it, and nobody else can. Press and hold on the card stays
 * Clone, as it was.
 */

/** The stripe's width, which every card in the list leaves room for. */
const BOARD_STRIPE = 12;
/** The left padding of every board card, coloured or not, so names line up. */
export const BOARD_CARD_INSET = BOARD_STRIPE + 10;

/**
 * The stripe, laid over the card's left edge (the card clips it to its
 * corners). Nothing at all for a board with no colour that this person cannot
 * colour, so such a card looks as it always did.
 *
 * Its target is wider than the stripe: a finger needs 44 points, which on a
 * phone reaches into the start of the name (Faisal chose that, 2026-11-25, over
 * press and hold); a mouse needs about 24, which stays at the edge. A board
 * with no colour shows whoever can colour it a faint stripe, so there is
 * something to aim at.
 */
export function BoardStripe({
  boardName,
  color,
  onColour,
  onLongPress,
}: {
  boardName: string;
  color: BoardColor | undefined;
  /** Present only for someone who may change the colour. Gets the stripe's element, for a popover. */
  onColour: ((anchor: unknown) => void) | undefined;
  /** The card's own press and hold, so holding anywhere on it still clones. */
  onLongPress: (() => void) | undefined;
}) {
  const t = useTheme();
  const { isWide } = useLayout();
  const ref = useRef<View>(null);
  if (!color && !onColour) return null;
  const ink = color ? t.board[color] : t.border.subtle;
  if (!onColour) {
    return (
      <View
        testID={`stripe:${boardName}`}
        style={[styles.bar, { width: BOARD_STRIPE, backgroundColor: ink }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    );
  }
  const target = Platform.OS === 'web' && isWide ? 24 : 44;
  return (
    <Pressable
      ref={ref}
      onPress={() => onColour(ref.current)}
      onLongPress={onLongPress}
      {...contextMenuProps(onLongPress)}
      accessibilityRole="button"
      accessibilityLabel={`Colour of ${boardName}: ${color ? BOARD_COLOR_NAMES[color] : 'none'}`}
      style={[styles.target, { width: target }]}
    >
      {/* `hovered` is react-native-web's; a phone never sets it. */}
      {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => (
        <View
          testID={`stripe:${boardName}`}
          style={[
            styles.bar,
            {
              width: BOARD_STRIPE + (pressed || hovered ? 3 : 0),
              backgroundColor: color ? ink : pressed || hovered ? t.border.strong : ink,
            },
          ]}
        />
      )}
    </Pressable>
  );
}

/** The colours to choose from, and none. One tap picks. */
export function BoardColourSwatches({
  value,
  onPick,
  size = 44,
}: {
  value: BoardColor | undefined;
  onPick: (color: BoardColor | null) => void;
  size?: number;
}) {
  const t = useTheme();
  const disc = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={styles.swatches}>
      {BOARD_COLORS.map((c) => {
        const on = value === c;
        return (
          <Pressable
            key={c}
            onPress={() => onPick(c)}
            accessibilityRole="button"
            accessibilityLabel={BOARD_COLOR_NAMES[c]}
            accessibilityState={{ selected: on }}
            aria-pressed={on}
            style={({ pressed }) => [
              styles.swatch,
              disc,
              { backgroundColor: t.board[c] },
              on && { borderWidth: 3, borderColor: t.bg.raised, outlineColor: t.board[c], outlineWidth: 2, outlineStyle: 'solid' },
              pressed && { opacity: 0.7 },
            ]}
          >
            {on ? <Icon name="check" size={20} color={t.text.inverse} /> : null}
          </Pressable>
        );
      })}
      <Pressable
        onPress={() => onPick(null)}
        accessibilityRole="button"
        accessibilityLabel="No colour"
        accessibilityState={{ selected: !value }}
        aria-pressed={!value}
        style={({ pressed }) => [
          styles.swatch,
          disc,
          { backgroundColor: t.bg.surface, borderWidth: 1, borderColor: t.border.strong },
          !value && { outlineColor: t.border.strong, outlineWidth: 2, outlineStyle: 'solid', outlineOffset: 2 },
          pressed && { opacity: 0.7 },
        ]}
      >
        <Icon name="block" size={20} color={t.text.secondary} />
      </Pressable>
    </View>
  );
}

/** The picker as a dialog: on a phone, and on any narrow screen. */
export function BoardColourSheet({
  boardName,
  value,
  onPick,
  onClose,
}: {
  boardName: string;
  value: BoardColor | undefined;
  onPick: (color: BoardColor | null) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible title={`Colour of ${boardName}`} onClose={onClose} closeLabel="Close">
      <BoardColourSwatches value={value} onPick={onPick} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  target: { position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 1 },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { alignItems: 'center', justifyContent: 'center' },
});
