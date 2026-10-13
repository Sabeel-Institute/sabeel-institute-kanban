/**
 * NATIVE (web sibling: RichEditor.web.tsx). The Fabric half of the editor seam.
 *
 * `react-native-enriched-html` is a real native input — no WebView — so
 * `react-native-keyboard-controller` still sees a focused view and scrolls it
 * clear of the IME. That was the highest-risk question in the plan and it was
 * settled on a device before this was written: the editor, the toolbar row AND
 * the Save/Cancel row all stay visible with the keyboard up, inside the
 * existing 96px budget.
 *
 * Markdown in, markdown out, through the SAME `richtextHtml` seam the web half
 * uses, so identical keystrokes produce byte-identical markdown on both
 * surfaces.
 *
 * THREE PROPS ARE CORRECTIONS TO THE LIBRARY'S DEFAULTS, each read out of its
 * types rather than assumed:
 *  - `scrollEnabled={false}` — it defaults TRUE, giving the editor its own
 *    scroll view nested inside `Screen`'s `KeyboardScroll`. That is the same
 *    nested-scroller bug the mention list already had to solve.
 *  - `linkRegex={null}` — autodetection is ON by default and would rewrite a
 *    bare URL into a markdown link on Android ONLY, so the same typing would
 *    store different bytes than the browser did. Autolinking belongs at render
 *    time, where both surfaces share one implementation.
 *  - `textShortcuts` pinned to exactly our two list triggers. The default
 *    happens to match today; pinning means an upstream change cannot silently
 *    add a heading or quote trigger.
 *
 * Underline is the one rough edge: a hardware Ctrl+U can set it, markdown
 * cannot express it, and the converter drops it — so the text visibly
 * un-underlines. `textShortcuts` governs typed triggers, not hardware keys, and
 * the library exposes no opt-out. Documented in the manual.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import {
  useFocusedInputHandler,
  useKeyboardState,
  useReanimatedFocusedInput,
} from 'react-native-keyboard-controller';
import { runOnJS } from 'react-native-reanimated';
import {
  EnrichedTextInput,
  type EnrichedTextInputInstance,
} from 'react-native-enriched-html';
import {
  htmlToMarkdown,
  isMentionQuery,
  mentionInsertion,
  markdownToHtml,
  type MentionCandidate,
} from '@sabeel/shared';
import { RichToolbar, type RichMarks } from './RichToolbar';
import { LinkSheet } from './LinkSheet';
import { MENTION_DESIRED_HEIGHT, ROW_PITCH } from './MentionList';
import { anchorForCaret, anchorForField, type MentionAnchor } from './mentionAnchor';
import { useMentionOverlay } from './MentionOverlay';
import { useMentionPolicy } from './useMentionPolicy';
import { radius, space, type as type_, useTheme } from '../theme';

/** A caret as the OS reports it: field-relative x/y, plus the field's own origin. */
interface NativeCaret {
  x: number;
  y: number;
  height: number;
  /** The focused input's Y on screen, or -1 when the layout is not known yet. */
  inputTop: number;
  /** The focused input's X on screen. Only meaningful when `inputTop` is. */
  inputLeft: number;
}

/** A caret line, when the event reports no height of its own. */
const FALLBACK_LINE = 20;

/**
 * Turn a native caret into a popover placement.
 *
 * Returns null — meaning "fall back to the old placement above the field" —
 * whenever the inputs cannot support an honest answer. That is the important
 * case: if `useFocusedInputHandler` never fires for this editor, or the focused
 * input's layout is unknown, `caret` stays null and the popover behaves exactly
 * as it did before. A zero here would instead pin it to the field's top-left
 * corner and look like a deliberate position.
 */
function nativeAnchor({
  caret,
  fieldWidth,
  screenH,
  keyboardHeight,
}: {
  caret: NativeCaret | null;
  fieldWidth: number;
  screenH: number;
  keyboardHeight: number;
}): MentionAnchor | null {
  if (!caret || caret.inputTop < 0 || fieldWidth <= 0) return null;

  const height = caret.height > 0 ? caret.height : FALLBACK_LINE;
  // The caret on SCREEN, which is what the keyboard occludes — `caret.y` alone
  // is relative to a field that has been scrolled somewhere.
  const caretTop = caret.inputTop + caret.y;
  // The keyboard overlays the window under edge-to-edge, so its height off the
  // bottom is where the visible area ends.
  const visibleBottom = screenH - keyboardHeight;

  const anchor = anchorForCaret(
    { x: caret.x, y: caret.y, height },
    {
      fieldWidth,
      below: visibleBottom - (caretTop + height),
      above: caretTop,
    },
    MENTION_DESIRED_HEIGHT,
  );
  // Into the OVERLAY's space, which is the screen. `anchorForCaret` stays
  // field-relative — that is what makes its sideways clamp mean "inside the
  // field" — so the field's own origin is added here and nowhere else.
  return {
    ...anchor,
    top: anchor.top + caret.inputTop,
    left: anchor.left + caret.inputLeft,
  };
}

/** Exactly the two list triggers, pinned rather than defaulted. */
const TEXT_SHORTCUTS = [
  { trigger: '- ', style: 'unordered_list' as const },
  { trigger: '1. ', style: 'ordered_list' as const },
];

const EMPTY_MARKS: RichMarks = {
  bold: false,
  italic: false,
  bullets: false,
  numbers: false,
  link: false,
};

export function RichEditor({
  initialMarkdown,
  onChangeMarkdown,
  placeholder,
  autoFocus,
  candidates,
  prioritiseUids,
  minHeight = 120,
}: {
  initialMarkdown: string;
  onChangeMarkdown: (md: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  candidates?: readonly MentionCandidate[];
  prioritiseUids?: readonly string[];
  /** Web only — a contenteditable has no placeholder to select on. */
  testID?: string;
  /** Matches the web sibling; the native input sizes itself the same way. */
  minHeight?: number;
}) {
  const t = useTheme();
  const ref = useRef<EnrichedTextInputInstance>(null);
  /**
   * Seed ONCE, and mean it.
   *
   * Callers pass the same state they update from `onChangeMarkdown` — the card
   * screen hands us `description`, which every keystroke rewrites. Recomputing
   * `markdownToHtml(initialMarkdown)` on each render therefore produced a NEW
   * string per character and handed it back to the native input, which reapplied
   * it and reset the document underneath the caret. What you saw was the cursor
   * advancing and snapping back, characters going missing, and repeated spaces
   * being impossible — the editor was being rebuilt between keystrokes.
   *
   * Freezing it here rather than asking callers to memoise is deliberate: the
   * prop is named `initialMarkdown`, so honouring that is this component's job,
   * and no caller can reintroduce the loop. The web sibling already does the
   * same thing with its `seeded` ref.
   *
   * And IN `<html>`, the library's own envelope, or the box is born the wrong
   * height. Only an enveloped value goes to the library's parser everywhere;
   * a bare one is shown through its HTML normaliser, but its FIRST height
   * measurement (`MeasurementStore.getInitialText`) skips the normaliser and
   * measures the tags as plain text, and on first mount the later correction
   * does not reach layout. Measured in the sibling LMS app on an AVD, from
   * cold starts: a 495 px box for 542 px of text every time, its last line
   * hidden; enveloped, it fit. Every tag `markdownToHtml` emits (p, br, b, i,
   * a, ul, ol, li) is in that parser's vocabulary.
   */
  const initialHtml = useRef<string | null>(null);
  if (initialHtml.current === null) {
    initialHtml.current = `<html>${markdownToHtml(initialMarkdown)}</html>`;
  }
  const [marks, setMarks] = useState<RichMarks>(EMPTY_MARKS);
  /**
   * The link sheet, and the SELECTION IT WAS OPENED ON — range and text both.
   *
   * Reading `sel.current` as the sheet confirmed looked safe, since a ref cannot
   * change during a render. It is not: `onChangeSelection` keeps firing while
   * the sheet is up, so by the time Add link is pressed the range may no longer
   * be the one the user highlighted, and the link is applied somewhere else.
   * Capture it once, on the one event that means "the user asked for a link".
   */
  const [linkSheet, setLinkSheet] = useState<{
    open: boolean;
    text: string;
    start: number;
    end: number;
  }>({ open: false, text: '', start: 0, end: 0 });
  const closeLinkSheet = () =>
    setLinkSheet({ open: false, text: '', start: 0, end: 0 });
  const [query, setQuery] = useState<string | null>(null);
  const pitch = useRef(ROW_PITCH);

  /**
   * WHERE the caret is, so the popover can sit at it instead of above the whole
   * field. `react-native-enriched-html` has no caret API at all — its selection
   * event carries character offsets and nothing else — so the coordinates come
   * from `react-native-keyboard-controller`, which tracks the focused input at
   * the OS level and is already a dependency for `KeyboardScroll`.
   *
   * The handler is a WORKLET, hence `runOnJS`. It is the only worklet in app
   * code, and it earns that: nothing else in the tree can answer the question.
   */
  const { width: screenW, height: screenH } = useWindowDimensions();
  const keyboardHeight = useKeyboardState((k) => k.height);
  const { input } = useReanimatedFocusedInput();
  const [caret, setCaret] = useState<NativeCaret | null>(null);
  /**
   * The field's box ON SCREEN, for the no-caret fallback.
   *
   * `measureInWindow` rather than `onLayout`'s own numbers: the layout event
   * gives a position relative to the parent, and the overlay that draws the
   * popover is positioned against the screen. Measured on every layout, so a
   * keyboard opening or the card scrolling keeps it honest.
   */
  const fieldRef = useRef<View>(null);
  const [field, setField] = useState<{ x: number; y: number; width: number } | null>(
    null,
  );
  const measureField = useCallback(() => {
    fieldRef.current?.measureInWindow((x, y, width) => setField({ x, y, width }));
  }, []);
  /**
   * The latest caret, kept in a REF as well as state.
   *
   * Selection changes on every keystroke and cursor move; committing each one to
   * state would re-render this editor per character, which is the exact cost the
   * draft-ownership rule exists to avoid. So the ref is always current and state
   * is only written while a mention is open — and `onStartMention` seeds from
   * the ref, because the '@' keystroke moves the caret BEFORE the mention opens
   * and the popover would otherwise draw its first frame against a stale one.
   */
  const caretRef = useRef<NativeCaret | null>(null);
  const mentionOpen = useRef(false);
  mentionOpen.current = query !== null;

  const onCaret = useCallback(
    (x: number, y: number, height: number, inputTop: number, inputLeft: number) => {
      const next = { x, y, height, inputTop, inputLeft };
      caretRef.current = next;
      if (mentionOpen.current) setCaret(next);
    },
    [],
  );

  useFocusedInputHandler(
    {
      onSelectionChange: (e) => {
        'worklet';
        const layout = input.value?.layout;
        runOnJS(onCaret)(
          e.selection.start.x,
          e.selection.start.y,
          // The event gives the selection RECTANGLE: start is its top-left and
          // end its bottom-right, so for a collapsed caret the difference is one
          // line. -1 when that comes out as nothing, so the fallback below can
          // tell "no height" from "zero-height line".
          Math.max(0, e.selection.end.y - e.selection.start.y),
          layout ? layout.absoluteY : -1,
          layout ? layout.absoluteX : 0,
        );
      },
    },
    [onCaret],
  );

  /**
   * ONE anchor, always. The caret when the OS reports one, the field's own box
   * when it does not — both in screen coordinates, both drawn by the overlay.
   * There is no second rendering path any more: the fallback used to draw
   * inside the editor and needed a `zIndex` lift to escape it, and that lift is
   * what cost the input its focus on Android.
   */
  const anchor = useMemo(() => {
    const width = field?.width ?? screenW;
    return (
      nativeAnchor({ caret, fieldWidth: width, screenH, keyboardHeight }) ??
      (field ? anchorForField(field, MENTION_DESIRED_HEIGHT) : null)
    );
  }, [caret, field, screenW, screenH, keyboardHeight]);
  /**
   * `setLink` takes an explicit [start, end) range rather than "the current
   * selection", so the caret has to be tracked. Read out of the library's
   * types, and it shapes the whole link flow.
   */
  const sel = useRef({ start: 0, end: 0, text: '' });

  const policy = useMentionPolicy({
    query,
    candidates: candidates ?? [],
    prioritiseUids,
    rowPitch: pitch.current,
    // The library owns the mention node; we only say which handle it is.
    // Shape from @sabeel/shared, not spelled out here: web and native each
    // decided this for themselves once, disagreed, and native mentions notified
    // nobody for a month. See `mentionInsertion`.
    onInsert: (c) => {
      const m = mentionInsertion(c);
      ref.current?.setMention(m.indicator, m.text);
    },
    onRefocus: () => ref.current?.focus(),
  });

  const commands = useCallback(
    () => ({
      toggleBold: () => ref.current?.toggleBold(),
      toggleItalic: () => ref.current?.toggleItalic(),
      toggleBullets: () => ref.current?.toggleUnorderedList(),
      toggleNumbers: () => ref.current?.toggleOrderedList(),
      promptLink: () => setLinkSheet({ open: true, ...sel.current }),
    }),
    [],
  );

  const onMeasureRow = useCallback((p: number) => {
    pitch.current = p;
  }, []);

  /**
   * Memoised because `useMentionOverlay` publishes on identity: a fresh object
   * every render would re-render the root layer on every keystroke, not only on
   * the ones that change the list.
   */
  const overlay = useMemo(
    () =>
      policy.open && anchor
        ? {
            suggestions: policy.suggestions,
            index: policy.index,
            listRef: policy.listRef,
            onPick: policy.accept,
            onMeasureRow,
            anchor,
          }
        : null,
    [
      policy.open,
      policy.suggestions,
      policy.index,
      policy.listRef,
      policy.accept,
      onMeasureRow,
      anchor,
    ],
  );
  useMentionOverlay(overlay);

  return (
    <View style={styles.wrap}>
      <RichToolbar commands={commands()} marks={marks} />

      {/* The field, measured against the SCREEN. Nothing floats inside it any
          more — `MentionOverlay` draws the popover at the app root — so this
          View exists only to give the input a box worth measuring. */}
      <View ref={fieldRef} onLayout={measureField}>
        <EnrichedTextInput
          ref={ref}
          defaultValue={initialHtml.current}
          placeholder={placeholder}
          placeholderTextColor={t.text.muted}
          autoFocus={autoFocus}
          scrollEnabled={false}
          linkRegex={null}
          textShortcuts={TEXT_SHORTCUTS}
          mentionIndicators={candidates ? ['@'] : []}
          onChangeHtml={(e) => onChangeMarkdown(htmlToMarkdown(e.nativeEvent.value))}
          onChangeState={(e) => {
            const s = e.nativeEvent;
            setMarks({
              bold: !!s.bold?.isActive,
              italic: !!s.italic?.isActive,
              bullets: !!s.unorderedList?.isActive,
              numbers: !!s.orderedList?.isActive,
              link: !!s.link?.isActive,
            });
          }}
          onChangeSelection={(e) => {
            sel.current = {
              start: e.nativeEvent.start,
              end: e.nativeEvent.end,
              text: e.nativeEvent.text ?? '',
            };
          }}
          // The library extracts the query itself, so `activeMentionQuery` —
          // which exists to find one in a flat string — is simply not needed
          // here. Start fires with an empty query; change carries the text.
          onStartMention={() => {
            setCaret(caretRef.current);
            setQuery('');
          }}
          // The SHARED rule, not the library's. Its own notion of "still in a
          // mention" looks at the word before the caret with whitespace
          // boundaries that include `\n`, so putting the caret on the line below
          // a bare `@` reported an active mention whose query was a line break —
          // which trims to empty, and empty means "show everyone". Picking from
          // that list would have inserted the handle at the caret, on the wrong
          // line, orphaning the `@`. `isMentionQuery` is the same rule web gets
          // for free from `activeMentionQuery`'s character class.
          onChangeMention={(e) => setQuery(isMentionQuery(e.text) ? e.text : null)}
          onEndMention={() => setQuery(null)}
          onFocus={policy.onFocus}
          onBlur={policy.onBlur}
          style={{
            minHeight,
            backgroundColor: t.bg.surface,
            borderColor: t.border.subtle,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.sm,
            padding: space.md,
            color: t.text.primary,
            // RN's TextInput default is 14, the app's body text is 15. Left
            // alone, typing and reading the same words differ in size.
            fontSize: type_.body.fontSize,
          }}
          htmlStyle={{ a: { color: t.accent.base } }}
        />
      </View>

      <LinkSheet
        visible={linkSheet.open}
        initialText={linkSheet.text}
        onCancel={closeLinkSheet}
        onConfirm={(href, text) => {
          ref.current?.setLink(linkSheet.start, linkSheet.end, text, href);
          closeLinkSheet();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
});
