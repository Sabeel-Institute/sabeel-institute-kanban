/**
 * Themed primitives. Screens compose these rather than styling from scratch, so
 * styling stays coherent and no screen ever needs a color literal.
 */
import {
  Children,
  createContext,
  forwardRef,
  useContext,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { KeyboardScroll, type Scroller } from './KeyboardScroll';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { priorityLabel, readableInkOn, type Priority } from '@sabeel/shared';
import { radius, space, type, useTheme } from '../theme';

/** Any MaterialIcons glyph name, without re-listing them here. */
type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

/**
 * Space kept below a focused field when the keyboard is up.
 *
 * Sized for a help line plus a submit button (~96), because a field is rarely
 * the last thing you interact with — the control you press after typing has to
 * be visible too.
 */
const KEYBOARD_BOTTOM_OFFSET = 96;
import {
  CONTENT_MAX_WIDTH,
  GRID_CARD_MIN_WIDTH,
  LIST_MAX_WIDTH,
  READ_MAX_WIDTH,
  useLayout,
} from '../theme/layout';
import { useListenerError } from '../liveQuery';

/**
 * Safe-area edges the app-wide nav chrome has already claimed, so a Screen does
 * not inset them a second time and double the gap. `AppNav` sets this via App.tsx:
 * `['bottom']` on a phone (the bottom bar owns the gesture-pill inset) and
 * `['left']` on wide (the left rail owns that edge). Empty by default, so a
 * chrome-less screen insets all four edges itself.
 */
export const NavClaimedEdgesContext = createContext<readonly Edge[]>([]);

const ALL_EDGES: readonly Edge[] = ['top', 'right', 'bottom', 'left'];

export function Screen({
  children,
  scroll = true,
  width = 'content',
  scrollRef,
}: {
  children: ReactNode;
  scroll?: boolean;
  /**
   * For a screen that has to move its own view — today only Stats, which brings
   * a breakdown into view when a bar is selected, because on a phone the chart
   * alone already reaches the fold and content appended below it would never be
   * seen. Ignored when `scroll` is false.
   */
  scrollRef?: Ref<Scroller>;
  /**
   * How wide the content may grow on a WIDE screen (ignored on a phone, where the
   * column is the whole screen). Capping-and-centring is what stops a phone-first
   * layout from looking like a phone screen stretched sideways on a desktop:
   *  - `read`    a narrow reading column — text, forms, card detail, settings.
   *  - `content` the default mid column — simple pages.
   *  - `list`    a wide column for card GRIDS that should fill a laptop/desktop.
   *  - `full`    no cap — the board, which uses every pixel.
   */
  width?: 'read' | 'content' | 'list' | 'full';
}) {
  const t = useTheme();
  const error = useListenerError();
  const { isWide } = useLayout();
  const claimedEdges = useContext(NavClaimedEdgesContext);
  const edges = ALL_EDGES.filter((e) => !claimedEdges.includes(e));

  // Cap and centre on wide screens; on a phone the column IS the screen, so a
  // maxWidth there would just add dead margin.
  const maxWidth =
    !isWide || width === 'full'
      ? undefined
      : width === 'read'
        ? READ_MAX_WIDTH
        : width === 'list'
          ? LIST_MAX_WIDTH
          : CONTENT_MAX_WIDTH;

  // `fill` when not scrolling is load-bearing, not decoration. This wrapper sits
  // between the flex:1 container and the screen's content, and a View with no
  // flex sizes to its CONTENT — so on native a child with flex:1 (the board's
  // pager) collapsed to zero height and rendered nothing at all. Header and
  // pager controls still drew, because they size to their content, which made it
  // look like the column was missing rather than the layout being broken.
  // react-native-web resolves the same tree differently, so web looked correct
  // throughout. Verified on a device 2026-07-19.
  const body = (
    <View
      style={[
        !scroll && styles.fill,
        /**
         * The content column, and its gap, apply at EVERY width.
         *
         * They used to ride on the same style object as `maxWidth`, which is
         * undefined on a phone — so a screen's top-level children sat flush at
         * 0px there and 8px apart on a desktop. Measured, not guessed: 390px
         * reported `row-gap: normal` and gaps of [0, 0] where 1024px reported 8.
         * Nothing looked broken, because most components carry their own
         * spacing; the screens that did not were quietly tighter on the surface
         * this app is designed around.
         *
         * `full` opts out. The board manages its own vertical rhythm and an
         * inherited gap would push its pager around — and since `full` never got
         * the style at any width, it was already consistent.
         */
        width === 'full' ? null : styles.column,
        maxWidth ? { maxWidth } : null,
      ]}
    >
      {children}
    </View>
  );

  /**
   * Live-data errors are shown, never left to a console nobody reads — and
   * shown where they can actually be seen.
   *
   * This banner used to be the first child INSIDE the scroll container, so on a
   * long card or board it sat above the fold and a scrolled reader never saw it.
   * The whole point is that a rejected listener is not silent, and it was silent
   * for exactly the people most likely to hit one: those deep in a screen with a
   * lot of content. Pinned outside the scroller it stays put.
   */
  const banner = error ? (
    <View style={[styles.banner, { backgroundColor: t.bg.dangerSoft }]}>
      <Text style={[type.caption, { color: t.text.danger }]}>{error}</Text>
    </View>
  ) : null;

  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: t.bg.canvas }]}>
      {banner}
      {scroll ? (
        <KeyboardScroll
          scrollRef={scrollRef}
          contentContainerStyle={styles.scrollContent}
          // Enough to clear the ACTION ROW under a field, not just the field
          // itself. At space.xxl the comment box scrolled clear while its
          // Comment button stayed sliced by the keyboard — technically the
          // focused element was visible, but the thing you press next was not,
          // so it still read as broken.
          bottomOffset={KEYBOARD_BOTTOM_OFFSET}
        >
          {body}
        </KeyboardScroll>
      ) : (
        <View style={styles.flexContent}>{body}</View>
      )}
    </SafeAreaView>
  );
}


export function Title({
  children,
  numberOfLines,
  style,
}: {
  children: ReactNode;
  /** Clamp to N lines (e.g. a long board name beside header icons). */
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <Text
      style={[type.title, { color: t.text.primary }, style]}
      numberOfLines={numberOfLines}
    >
      {children}
    </Text>
  );
}

/**
 * A section title, optionally with that section's own action on the same row.
 *
 * The `action` slot exists because a section-level control — add an assignee,
 * add a member, edit the description — otherwise costs a whole row inside the
 * panel, and the card screen is long enough that those rows add up to real
 * scrolling. Put the icon where the section is already named.
 *
 * Reserve it for ONE ordinary action per section. Anything destructive, or the
 * primary action of the screen, still gets a labelled button of its own.
 */
export function Heading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  const t = useTheme();
  const text = <Text style={[type.heading, { color: t.text.primary }]}>{children}</Text>;
  /*
   * THE SECTION GAP GOES ON THE ROW, NOT ON THE TEXT.
   *
   * Flexbox aligns MARGIN boxes, so a marginTop on the text made its box 16px
   * taller at the top while the 44px icon box had none — centring them then put
   * the glyph about 8px above the text's optical centre, on every section of
   * the card screen at once. Reported as "the icons don't line up with the text
   * on the left", and it is the same 16px in both branches, so nothing moves
   * except the alignment.
   */
  if (!action) return <View style={styles.headingGap}>{text}</View>;
  return (
    <View style={[styles.headingRow, styles.headingGap]}>
      {text}
      {action}
    </View>
  );
}

/**
 * Body copy. There is no `muted` variant, deliberately.
 *
 * There was one, and every caller used it for something that carried meaning —
 * an empty state, an instruction, "you are not a member of this board". At
 * `text.muted` that is 2.07–2.92:1 depending on the surface: below AA, and below
 * the 3:1 non-text floor on most of them. The prop is REMOVED rather than left
 * unused, because a dormant style invites the next person to reach for it.
 * Genuinely disposable metadata is `Caption`; see its note below.
 */
export function Body({
  children,
  numberOfLines,
}: {
  children: ReactNode;
  /** Truncate rather than wrap — for a name sharing its row with an action. */
  numberOfLines?: number;
}) {
  const t = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[type.body, { color: t.text.secondary }]}>
      {children}
    </Text>
  );
}

/**
 * Small METADATA — timestamps, counts, "N assigned", placeholders. Muted (true
 * taupe) on purpose: this is text you could delete without losing information,
 * which is the only job muted's ~2.7:1 contrast is legible enough for.
 *
 * If the small text CONVEYS content — an empty-state message, a field label, an
 * email, a helper sentence, an error, the label on a control — it is not a
 * caption. Use `Hint`, which is the same size at a readable colour.
 *
 * This was audited across the app on 2026-07-28 and thirty-five sites moved to
 * `Hint`; `text.muted` measures 2.07–2.92:1 depending on the surface, which
 * fails AA and, on three of the four backgrounds, the 3:1 non-text floor too.
 * What is left on `Caption` is disposable by that test — timestamps, the build
 * stamp, a file's type, a count the list beside it already shows. See
 * docs/BRAND.md § Resolved.
 */
export function Caption({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[type.caption, { color: t.text.muted }]}>{children}</Text>;
}

/**
 * Small CONTENT — caption-sized, but `text.secondary` (~5.8:1) because it
 * carries meaning and must actually read: empty states ("No comments yet."),
 * field labels ("Title"), emails, short helper sentences. The muted/content
 * split is a brand rule, not a preference — muted body-weight content was the
 * legibility bug the colour-scheme verification pass found.
 */
export function Hint({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[type.caption, { color: t.text.secondary }]}>{children}</Text>;
}

/**
 * A small colored badge: a word on a fill of `color`, with the ink chosen for
 * contrast so it reads on ANY color. The one "text over an arbitrary color"
 * primitive — used for priority and labels (which is why the contrast is
 * computed, not hardcoded white).
 */
export function ColorBadge({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  const ink = readableInkOn(color, t.text.inverse, t.text.primary) === 'light'
    ? t.text.inverse
    : t.text.primary;
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Text style={[type.caption, styles.badgeText, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A card's priority as a badge. `none` renders nothing — an unset priority is
 *  not worth a chip. */
export function PriorityBadge({ priority }: { priority: Priority }) {
  const t = useTheme();
  if (priority === 'none') return null;
  return <ColorBadge color={t.priority[priority]} label={priorityLabel(priority)} />;
}

/**
 * An assignee as a neutral name chip — deliberately NOT a colored badge, so
 * people don't read as labels. A small initials disc anchors who it is.
 */
export function AssigneeChip({ name }: { name: string }) {
  const t = useTheme();
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?';
  return (
    <View style={[styles.assignee, { backgroundColor: t.bg.inset, borderColor: t.border.subtle }]}>
      <View style={[styles.assigneeDisc, { backgroundColor: t.bg.surface }]}>
        <Text style={[styles.assigneeInitials, { color: t.text.secondary }]}>{initials}</Text>
      </View>
      {/* `shrink` is what turns the maxWidth above into an ellipsis. Without it
          the name is laid out at full width beside the disc and simply overruns
          the chip's own border. */}
      <Text
        style={[type.caption, styles.shrink, { color: t.text.secondary }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </View>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.bg.surface, borderColor: t.border.subtle },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * A responsive grid for card-like list items (boards, search results). On a wide
 * screen the cards flow into as many columns as fit (each ~GRID_CARD_MIN_WIDTH,
 * capped so a lone card on the last row does not stretch); on a phone it is a
 * single full-width column. Give it plain cards as children — it wraps each.
 */
export function CardGrid({ children }: { children: ReactNode }) {
  const { isWide } = useLayout();
  return (
    <View style={styles.grid}>
      {Children.map(children, (child) =>
        child == null || child === false ? null : (
          <View style={isWide ? styles.gridItemWide : styles.gridItemNarrow}>
            {child}
          </View>
        ),
      )}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  busy,
  block,
  expanded,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  /** Force full width even on wide screens. For the rare screen whose primary
   *  action should span its container — e.g. the sign-in screen. */
  block?: boolean;
  /**
   * Set when the button opens and closes something below it, so assistive tech
   * announces the disclosure rather than a plain button. `Select` sets the same
   * state for the same reason.
   */
  expanded?: boolean;
}) {
  const t = useTheme();
  const { isWide } = useLayout();
  const bg =
    variant === 'primary'
      ? t.accent.base
      : variant === 'danger'
        ? t.feedback.danger
        : t.bg.inset;
  const fg =
    variant === 'secondary' ? t.text.primary : t.accent.onAccent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        // Full-width is a good primary-action shape on a phone, but on a desktop
        // it stretches into a bar; there, size to the label and sit left. In a
        // Row the button is already content-width, so this only affects the
        // stretched column-child case. `block` opts back into full width for the
        // rare screen (sign-in) whose action should span its container.
        { alignSelf: block || !isWide ? 'stretch' : 'flex-start' },
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[type.label, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Small status pill — pending / active / rejected / disabled, role names. */

/**
 * On/off toggle.
 *
 * Built from a Pressable rather than React Native's `Switch` because
 * react-native-web renders that one with its own Material palette and ignores
 * `thumbColor`/`trackColor` (and the RNW-specific `activeThumbColor`) — the
 * thumb came out teal, a colour that appears nowhere in the Sabeel palette.
 * Owning the two views is less code than fighting a component we cannot style,
 * and it looks identical on web and native.
 */
export function Toggle({
  value,
  onValueChange,
  disabled,
  label,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      /**
       * `aria-checked` as well, and for the same reason `IconAction` carries
       * `aria-pressed`: react-native-web does not map `accessibilityState.checked`
       * to any ARIA attribute. Measured, not assumed — the rendered switch had the
       * right thumb position and NO state at all, so on the web a screen reader
       * could not tell an owner's row from a non-owner's, and neither could a
       * test. Inert on native, where `accessibilityState` above is what Android
       * reads.
       */
      aria-checked={value}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[
        styles.toggleTrack,
        {
          backgroundColor: value ? t.accent.base : t.border.strong,
          opacity: disabled ? 0.5 : 1,
          // The thumb is positioned by which end it is pushed to, so the track
          // needs no absolute layout maths and no animation to stay correct.
          justifyContent: value ? 'flex-end' : 'flex-start',
        },
      ]}
    >
      <View style={[styles.toggleThumb, { backgroundColor: t.accent.onAccent }]} />
    </Pressable>
  );
}

/**
 * A quiet icon action — an icon, not a labelled button.
 *
 * Labelled buttons cost a full row each. Comment actions, the description
 * editor and the bulk-selection bar all made the same mistake independently:
 * a screen ends up spending more height on chrome than on content. For
 * ordinary, well-known operations — edit, delete, move, archive, close — an
 * icon carries the meaning at a fraction of the space.
 *
 * `accessibilityLabel` carries the word the icon replaces, so nothing is lost
 * for screen readers, and the target stays finger-sized while the ink stays
 * small.
 *
 * The target is a real 44×44 BOX, not `hitSlop`. That distinction is the whole
 * point: hitSlop paints invisible margin *outside* the element, so two icons
 * sitting a few pixels apart had touch areas that OVERLAPPED — 12px of slop each
 * side across a 4px gap meant a 20px band belonging to both, and which one you
 * hit was arbitrary. Reported from a real phone as "you have to use the very tip
 * of your finger" to tell save from cancel. Laid-out boxes cannot overlap, so
 * adjacent icons are always unambiguous, and 44 is the platform accessibility
 * minimum rather than a number picked to feel right.
 *
 * Because the box supplies its own spacing, rows of these want a SMALL gap
 * (space.xs), not a large one — the separation is already inside the target.
 */
/**
 * ONE ink size for every icon ACTION in the app.
 *
 * There were four in use (13/18/22/24) with no rule, and three on the card
 * screen alone. 24 inside the fixed 44x44 box is 55% ink; the box does not
 * change, so nothing reflows and no control moves — only how much of a target
 * that was already reserved gets drawn. Crowding is set by the GAP between
 * boxes, a separate number held at `space.sm` or more.
 *
 * Raw `<MaterialIcons>` used as INLINE METADATA (a paperclip on a card face, a
 * chevron in a reorder handle) keeps its own smaller size — that is text-scale
 * ornament, not a target.
 */
// Not exported: nothing outside needs to name it, because the default reaches
// every call site. An exported constant no caller uses is an invitation to
// start passing sizes again, which is the state this replaced.
const ICON_INK = 24;

export function IconAction({
  icon,
  label,
  onPress,
  danger,
  accent,
  disabled,
  selected,
  size = ICON_INK,
}: {
  icon: MaterialIconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  /** The affirmative half of a pair, so it cannot be mistaken for its sibling. */
  accent?: boolean;
  /** Disable while a write it triggers is in flight, so it cannot re-fire. */
  disabled?: boolean;
  /**
   * For a TOGGLE rather than an action — a formatting button that is currently
   * on. Without it an active Bold announces identically to an inactive one, and
   * looks identical too. Same `accessibilityState.selected` the mention list
   * already uses.
   */
  selected?: boolean;
  /** Ink size. Larger for a high-stakes pair like save/cancel. */
  size?: number;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      /**
       * `aria-pressed` as well, and deliberately.
       *
       * react-native-web does not map `accessibilityState.selected` to any ARIA
       * attribute for `role="button"` — measured, not assumed: the rendered
       * element carried the active BACKGROUND and no state at all, so a screen
       * reader could not tell an active Bold from an inactive one. `aria-pressed`
       * is the correct ARIA for a toggle, and it is inert on native, where
       * `accessibilityState` above is what Android reads.
       */
      aria-pressed={selected}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.action,
        selected && { backgroundColor: t.bg.accentSoft, borderRadius: radius.sm },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.6 },
      ]}
    >
      <MaterialIcons
        name={icon}
        size={size}
        // text.secondary, NOT text.muted. An icon is non-text content and needs
        // 3:1; muted measures 2.07–2.92:1 depending on the surface and fails
        // that on most of them. These icons are the ONLY label many actions
        // have — edit, delete, move, archive — so they are the last thing that
        // should be faint. Same rule the caption audit applied to text, and
        // `SegmentedIcons` below already states it.
        color={danger ? t.text.danger : accent ? t.accent.base : t.text.secondary}
      />
    </Pressable>
  );
}

/**
 * A segmented icon control — pick exactly one of a few.
 *
 * Deliberately NOT a row of `FilterChip`s. Chips are separate pills that each
 * turn on and off, so a row of them says "combine any of these"; a segmented
 * control is one object with one part lit, which says "choose one". Put both on
 * a screen as pills and they read as a single wrapped set with two selections —
 * which is exactly what the Stats screen did before this existed.
 *
 * Icons, per the standing rule that ordinary choices are icons rather than
 * labelled buttons, with each label carried on `accessibilityLabel` so nothing
 * is lost to a screen reader. Segments are 44pt so they stay finger-sized.
 */
export function SegmentedIcons<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: T; icon: MaterialIconName; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      style={[
        styles.segmented,
        { borderColor: t.border.strong, backgroundColor: t.bg.surface },
      ]}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on, checked: on }}
            // Same react-native-web gap as `Toggle` above: the state has to be
            // stated in ARIA directly or the web build announces every option
            // identically.
            aria-checked={on}
            onPress={() => onChange(o.key)}
            style={({ pressed }) => [
              styles.segment,
              on ? { backgroundColor: t.accent.base } : null,
              pressed && !on ? { backgroundColor: t.bg.inset } : null,
            ]}
          >
            <MaterialIcons
              name={o.icon}
              size={20}
              // text.secondary, not text.muted: an icon is non-text content and
              // needs 3:1: muted is 2.34:1 on this surface and fails it.
              color={on ? t.accent.onAccent : t.text.secondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.row, style]}>{children}</View>;
}

/**
 * The capped, scrollable list a "pick one of these" section is made of.
 *
 * Three identical copies existed — assignees, subtask links, board members —
 * each `<ScrollView style={{maxHeight: 220}} nestedScrollEnabled>` under a
 * filter field. That arrangement is precisely the one
 * `keyboardShouldPersistTaps` governs, and at its default a focused filter
 * makes the ScrollView EAT the tap on the row being picked: the row does not
 * light up and nothing happens. `Sheet` carries the mechanism in full.
 *
 * So it is one component rather than three, because the answer has to be in one
 * place: a fourth picker written by copying a third would have copied the bug.
 */
export function PickerList({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      style={styles.pickerList}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

const KIND_PROPS: Record<'email' | 'password', Partial<TextInputProps>> = {
  email: {
    autoCapitalize: 'none',
    autoCorrect: false,
    keyboardType: 'email-address',
    autoComplete: 'email',
    // `username`, not `emailAddress`: iOS pairs a password with the field
    // marked as its username, and that is what offers saved passwords.
    textContentType: 'username',
  },
  password: {
    autoCapitalize: 'none',
    autoCorrect: false,
    secureTextEntry: true,
    autoComplete: 'current-password',
    textContentType: 'password',
  },
};

export const TextField = forwardRef<TextInput, {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  multiline?: boolean;
  autoFocus?: boolean;
  label?: string;
  /** Cap input length so a write never exceeds what firestore.rules allows. */
  maxLength?: number;
  /**
   * Raw key events, for a field that has to interpret them. The rich editors
   * intercept their own keys (Lexical commands on web, the native editor's own
   * handlers), so nothing in the app supplies this today — it stays because a
   * plain `TextInput` still needs the escape hatch.
   */
  onKeyPress?: TextInputProps['onKeyPress'];
  /** Focus tracking, for a field whose UI depends on it — today only the
   *  @mention list, which has to disappear when you look away. */
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  /**
   * An address or a password: no capitals or corrections, the right keyboard,
   * the password hidden, and the platform's password autofill offered.
   */
  kind?: 'email' | 'password';
  /**
   * What the keyboard's Return key says, and so what it does: `next` moves on
   * (the caller's `onSubmit` focuses the next field, and on a phone the
   * keyboard stays up rather than dropping between the two), `go` submits.
   * `enterKeyHint`, not the deprecated `returnKeyType`: react-native maps it on
   * both phones and react-native-web renders it as the input's attribute.
   */
  enterKeyHint?: 'next' | 'go';
}>(function TextField(
  {
    value,
    onChangeText,
    placeholder,
    onSubmit,
    multiline,
    autoFocus,
    label,
    maxLength,
    onKeyPress,
    onFocus,
    onBlur,
    kind,
    enterKeyHint,
  },
  ref,
) {
  const t = useTheme();
  return (
    <TextInput
      {...(kind ? KIND_PROPS[kind] : null)}
      // Forwarded so callers can restore focus — picking a mention from the
      // autocomplete blurs this field, and without refocusing you cannot carry
      // on typing.
      ref={ref}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={t.text.muted}
      onSubmitEditing={onSubmit}
      enterKeyHint={enterKeyHint}
      submitBehavior={enterKeyHint === 'next' ? 'submit' : undefined}
      multiline={multiline}
      autoFocus={autoFocus}
      maxLength={maxLength}
      onKeyPress={onKeyPress}
      onFocus={onFocus}
      onBlur={onBlur}
      accessibilityLabel={label ?? placeholder}
      style={[
        styles.input,
        multiline && styles.inputMultiline,
        {
          backgroundColor: t.bg.inset,
          color: t.text.primary,
          borderColor: t.border.subtle,
        },
      ]}
    />
  );
});

/**
 * A toggleable filter chip. Reads as "on" by filling with the accent rather than
 * by a checkmark, so a row of them shows the active filters at a glance.
 */
export function FilterChip({
  label,
  active,
  onPress,
  name,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  /**
   * A distinct NAME for a chip whose visible text is not unique.
   *
   * Two chips can legitimately show the same word — "Urgent" inside the Filters
   * sheet and "Urgent" as the active-filter chip behind it — which leaves a
   * screen reader, and any test, with two controls answering to one name. This
   * separates what is announced from what is drawn; the state suffix is still
   * appended, so it stays a toggle.
   */
  name?: string;
  /**
   * Override for a chip that is NOT a toggle.
   *
   * The default announces "<label> filter, on/off", which is right for a chip
   * that turns a filter on and wrong for one that opens a picker — a screen
   * reader would describe a filter state the control does not have.
   */
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const announced = name ?? label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        accessibilityLabel ??
        (active ? `${announced} filter, on` : `${announced} filter, off`)
      }
      // 36pt of ink, 44pt of target — the four points top and bottom close the
      // gap without moving a single pixel on screen.
      hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? t.accent.base : t.bg.surface,
          borderColor: active ? t.accent.base : t.border.subtle,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text
        style={[type.label, { color: active ? t.accent.onAccent : t.text.secondary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Spinner({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={styles.centre}>
      <ActivityIndicator color={t.accent.base} />
      {label ? <Hint>{label}</Hint> : null}
    </View>
  );
}

/**
 * Determinate progress, for work whose length is actually known.
 *
 * `Spinner` and `Button busy` are indeterminate — right for a write that takes
 * an unknown moment, wrong for an upload, where "is this moving at all" is the
 * question and a 10 MB file over a phone connection takes long enough to look
 * stuck.
 *
 * `fraction` accepts null for work that has started but has no measurable
 * progress yet (a record being created before any bytes move). It renders an
 * empty track with its label rather than a misleading 0% that looks stalled.
 *
 * The label sits BELOW the bar, not on it, and the fill is the accent. That is
 * not a style preference: the first version painted `bg.accentSoft` on
 * `bg.inset`, which is 1.13:1 — the bar was invisible, so the only feedback
 * during an upload showed nothing at all. Accent gives 7.25:1, comfortably past
 * the 3:1 WCAG asks of a non-text component, and moving the label off the bar
 * is what makes that possible: text over a half-filled bar cannot be legible on
 * both halves at once.
 */
export function ProgressBar({ fraction, label }: { fraction: number | null; label: string }) {
  const t = useTheme();
  // Guard the division's output as well as clamping it: totalBytes can be 0 for
  // a moment at the start, and NaN width silently renders nothing.
  const pct =
    fraction === null || !Number.isFinite(fraction)
      ? 0
      : Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}>
      <View style={[styles.progressTrack, { backgroundColor: t.bg.inset }]}>
        <View style={[styles.progressFill, { backgroundColor: t.accent.base, width: `${pct}%` }]} />
      </View>
      <Hint>{label}</Hint>
    </View>
  );
}

/**
 * A live subscription that FAILED, in place of the list it was going to fill.
 *
 * The error itself is already reported: `Screen` renders a banner for any live
 * -data error (see useListenerError). What was missing is that every list screen
 * checked `loading` and then fell through to `data ?? []`, so the failure ALSO
 * rendered its empty state — a banner saying something broke, directly above
 * "No boards yet. Create one to get started." shown to someone with fifteen
 * boards. Two contradictory answers, and the calm one is the lie.
 *
 * Carries the code itself rather than pointing at the banner. The banner is
 * rendered by `Screen`, and an error path that returns early does not always go
 * through one — the first version of this said "the red bar above says what went
 * wrong" on a board screen that had no bar. A message that references something
 * not on screen is worse than a slightly redundant one.
 */
export function LoadError({ what, code }: { what: string; code?: string }) {
  /**
   * A REFUSAL is not a connection problem, and telling someone to wait for one
   * to clear on its own is advice that never comes good.
   *
   * It became an ordinary event when board authority went per-board: being
   * removed from a board you have open now ends the listener with
   * `permission-denied`, where before a manager could read every board and this
   * code meant a bug. The two cases need different sentences and a different
   * next step — go back, versus come back later.
   */
  const denied = code === 'permission-denied';
  return (
    <Card>
      <Body>
        {denied ? `You no longer have access to ${what}.` : `Could not load ${what}.`}
      </Body>
      <Hint>
        {denied
          ? 'If you could a moment ago, someone has just changed who can see it. Go back and start again from your board list.'
          : `This is usually a connection problem and often clears on its own — leave the screen and come back.${
              code ? ` If it keeps happening, quote this: ${code}` : ''
            }`}
      </Hint>
    </Card>
  );
}

const styles = StyleSheet.create({
  toggleTrack: {
    width: 52,
    height: 32,
    borderRadius: radius.pill,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleThumb: { width: 26, height: 26, borderRadius: radius.pill },
  // A thin bar: it has to be SEEN, not read, so it needs height enough to
  // register and nothing more. The label lives underneath.
  progressTrack: { borderRadius: radius.sm, overflow: 'hidden', height: 6 },
  progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  // A real 44x44 target, the platform accessibility minimum. NOT hitSlop — see
  // IconAction: slop overlaps between neighbours, laid-out boxes cannot.
  filterChip: {
    // The INK is 36 so a row of chips stays compact; the TARGET is 44 via the
    // hitSlop where these are rendered — the app's standard since v0.1.22, and
    // the pattern CLAUDE.md prescribes: finger-sized target, small ink.
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  action: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  /** One object with one part lit — see SegmentedIcons. */
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  segment: { minWidth: 52, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  /** Title left, its one action right, both on the baseline of the section. */
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  /** The space ABOVE a section, carried by the row so it cannot skew alignment. */
  headingGap: { marginTop: space.lg },
  fill: { flex: 1 },
  scrollContent: { padding: space.lg, gap: space.sm },
  flexContent: { flex: 1, padding: space.lg, gap: space.sm },
  /** The screen's content column. Centred, and the caller supplies any maxWidth. */
  column: {
    width: '100%',
    alignSelf: 'center',
    gap: space.sm,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  // Grow to fill the row but stay near the target width so a lone last card
  // does not stretch across the whole grid.
  gridItemWide: { flexGrow: 1, flexBasis: GRID_CARD_MIN_WIDTH, maxWidth: 380 },
  gridItemNarrow: { width: '100%' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  button: {
    borderRadius: radius.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeText: { fontWeight: '600' },
  shrink: { flexShrink: 1 },
  assignee: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.pill,
    paddingLeft: 2,
    paddingRight: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    /**
     * A chip is a box drawn AROUND its text, so it grows with the name and a
     * long one runs past the card it sits on — clipped by react-native-web,
     * drawn anyway by Android. Unlike a label, this name is the Google display
     * name: external input we never get to validate, so the bound belongs here
     * at the boundary. Wide enough for any real "First Last"; a name that
     * exceeds it ellipsises rather than escaping.
     */
    maxWidth: 180,
  },
  assigneeDisc: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assigneeInitials: { fontSize: 9, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  /** Capped so a picker cannot grow with the board or the directory. */
  pickerList: { maxHeight: 220 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  banner: {
    borderRadius: radius.sm,
    padding: space.sm,
    marginBottom: space.sm,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
    minHeight: 44,
    ...type.body,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: 'top' },
});
