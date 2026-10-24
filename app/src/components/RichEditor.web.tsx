/**
 * WEB (native sibling: RichEditor.tsx). The Lexical half of the editor seam.
 *
 * Markdown in, markdown out — neither HTML nor editor state ever reaches a
 * screen. Both surfaces convert through the SAME `richtextHtml` seam, so the
 * same keystrokes produce byte-identical markdown from a phone and a browser.
 *
 * `@lexical/markdown` is used for TYPING SHORTCUTS ONLY, never as the save
 * path. It escapes a different set from ours (`_`, backtick, `~`), and two
 * serializers would have to be proved to agree; one converter only has to be
 * proved to work.
 *
 * FOUR THINGS CONSTRAIN THIS TO THE VOCABULARY, in decreasing order of trust:
 *  1. Only ListNode/ListItemNode/LinkNode are registered. Lexical cannot create
 *     a node type absent from the config, so a pasted <h1> or <blockquote>
 *     becomes a paragraph by construction rather than by our filtering.
 *  2. A TextNode transform clears every format bit except bold/italic. This is
 *     the layer that kills pasted underline, strikethrough, sub/superscript and
 *     inline code, which survive as FORMAT BITS rather than nodes and so slip
 *     past (1).
 *  3. `htmlToMarkdown` on save, which can only emit the five.
 *  4. No AutoLink plugin: a bare URL is stored exactly as typed and made
 *     tappable at render time, so web and Android agree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $isListNode,
  ListItemNode,
  ListNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { $isLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import {
  BOLD_STAR,
  ITALIC_STAR,
  ORDERED_LIST,
  UNORDERED_LIST,
} from '@lexical/markdown';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $createRangeSelectionFromDom,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
} from 'lexical';
import {
  activeMentionQuery,
  htmlToMarkdown,
  isSafeHref,
  markdownToHtml,
  MENTION_INDICATOR,
  type MentionCandidate,
  mentionInsertion,
} from '@sabeel/shared';
import { RichToolbar, type RichMarks } from './RichToolbar';
import { LinkSheet } from './LinkSheet';
import { MENTION_DESIRED_HEIGHT, ROW_PITCH } from './MentionList';
import { anchorForCaret, anchorForField, type MentionAnchor } from './mentionAnchor';
import { useMentionOverlay } from './MentionOverlay';
import { useMentionPolicy } from './useMentionPolicy';
import { radius, space, type as type_, useTheme } from '../theme';

/** Exactly the five. Nothing else can be typed into existence as a shortcut. */
const TRANSFORMERS = [UNORDERED_LIST, ORDERED_LIST, BOLD_STAR, ITALIC_STAR];

/**
 * The app's own font stack, restated because it CANNOT be imported.
 *
 * react-native-web sets this per-`Text` element (its `fontFamily: 'System'`
 * default, resolved in
 * `react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle.js`),
 * never on `body` — so a raw `contenteditable` inherits nothing and falls back
 * to the UA default, which is **Times**. The editor rendered in serif while
 * the card beneath it rendered in sans, at 16px against the app's 15.
 *
 * No lint rule covers this and every assertion passed; the manual's own
 * screenshot is what showed it. `richtext-e2e.mjs` now compares the editor's
 * COMPUTED font against a real rendered control, so drift here fails a test
 * rather than waiting for the next screenshot.
 */
const SYSTEM_FONT_STACK =
  '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';

const EMPTY_MARKS: RichMarks = {
  bold: false,
  italic: false,
  bullets: false,
  numbers: false,
  link: false,
};

/** Keys whose keydown edits at, or moves, the caret (the set facebook/lexical#9283 reads the DOM for). */
const CARET_KEYS = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Backspace', 'Delete', 'Enter', 'Tab']);

/** Load markdown into the editor, and report it back out as markdown. */
function Bridge({
  initialMarkdown,
  onChangeMarkdown,
  onMarks,
  registerCommands,
}: {
  initialMarkdown: string;
  onChangeMarkdown: (md: string) => void;
  onMarks: (m: RichMarks) => void;
  registerCommands: (c: {
    toggleBold: () => void;
    toggleItalic: () => void;
    toggleBullets: () => void;
    toggleNumbers: () => void;
    selectedText: () => string;
    applyLink: (href: string, text: string) => void;
  }) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const seeded = useRef(false);

  // Seed ONCE. Re-seeding a focused editor moves the caret and drops
  // keystrokes; the screen's dirty flag decides when a reseed is safe.
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (initialMarkdown) {
        const dom = new DOMParser().parseFromString(
          markdownToHtml(initialMarkdown),
          'text/html',
        );
        root.append(...$generateNodesFromDOM(editor, dom));
      }
    });
  }, [editor, initialMarkdown]);

  /**
   * Strip every format bit except bold and italic.
   *
   * Underline, strikethrough, code, subscript and superscript arrive as bits on
   * a TextNode rather than as nodes, so restricting the node list does not stop
   * a paste — or a hardware Ctrl+U — from setting them. Clearing them here is
   * what makes what you see equal what will be stored.
   */
  useEffect(
    () =>
      editor.registerNodeTransform(TextNode, (node) => {
        if (!$isTextNode(node)) return;
        for (const fmt of ['underline', 'strikethrough', 'code', 'subscript', 'superscript'] as const) {
          if (node.hasFormat(fmt)) node.toggleFormat(fmt);
        }
      }),
    [editor],
  );

  /**
   * Act on the caret the browser shows, not the one Lexical last heard of.
   *
   * On keydown, Lexical 0.52 reuses its last selection instead of reading the
   * DOM. Chromium coalesces `selectionchange`, so a caret move the browser made
   * natively (End, Home, a click) can still be unreported when the next key
   * arrives on a busy page, and that key then acts on the caret from before the
   * move: select a word, Bold, End, Enter, and the Enter and what follows
   * REPLACED the word. Lexical fixed it upstream (facebook/lexical#9283, after
   * 0.52.0) by reading the DOM for these keys; this does the same, first, in
   * the capture phase. Remove it once a Lexical release carries #9283.
   * `scripts/richtext-e2e.mjs` reproduces it.
   */
  useEffect(() => {
    let root: HTMLElement | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!CARET_KEYS.has(event.key) || event.isComposing) return;
      const domSelection = root?.ownerDocument.defaultView?.getSelection() ?? null;
      editor.update(
        () => {
          const fromDom = $createRangeSelectionFromDom(domSelection, editor);
          if (fromDom !== null) $setSelection(fromDom);
        },
        { discrete: true },
      );
    };
    const unregister = editor.registerRootListener((next, prev) => {
      prev?.removeEventListener('keydown', onKeyDown, true);
      next?.addEventListener('keydown', onKeyDown, true);
      root = next;
    });
    return () => {
      unregister();
      root?.removeEventListener('keydown', onKeyDown, true);
    };
  }, [editor]);

  /**
   * Hold the callbacks in refs so the listener registers ONCE.
   *
   * Callers pass inline arrows — `onChangeMarkdown={(v) => { … }}` on the card
   * screen — so their identity changes on every render. With them in the
   * dependency array, every keystroke tore down Lexical's update listener and
   * registered a new one, on top of the work the listener itself does. Reading
   * them through refs keeps the latest function without making registration
   * depend on its identity.
   *
   * Deliberately not solved by asking callers to `useCallback`: this component
   * cannot enforce that, and forgetting it is silent.
   */
  const onChangeRef = useRef(onChangeMarkdown);
  const onMarksRef = useRef(onMarks);
  onChangeRef.current = onChangeMarkdown;
  onMarksRef.current = onMarks;

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          const html = $generateHtmlFromNodes(editor, null);
          onChangeRef.current(htmlToMarkdown(html));

          const sel = $getSelection();
          if (!$isRangeSelection(sel)) {
            onMarksRef.current(EMPTY_MARKS);
            return;
          }
          const anchor = sel.anchor.getNode();
          const list = $findMatchingParent(anchor, $isListNode);
          onMarksRef.current({
            bold: sel.hasFormat('bold'),
            italic: sel.hasFormat('italic'),
            bullets: $isListNode(list) && list.getListType() === 'bullet',
            numbers: $isListNode(list) && list.getListType() === 'number',
            link: $findMatchingParent(anchor, $isLinkNode) !== null,
          });
        });
      }),
    [editor],
  );

  useEffect(() => {
    registerCommands({
      toggleBold: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold'),
      toggleItalic: () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic'),
      toggleBullets: () => {
        let on = false;
        editor.getEditorState().read(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          const l = $findMatchingParent(sel.anchor.getNode(), $isListNode);
          on = $isListNode(l) && l.getListType() === 'bullet';
        });
        editor.dispatchCommand(
          on ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND,
          undefined,
        );
      },
      toggleNumbers: () => {
        let on = false;
        editor.getEditorState().read(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          const l = $findMatchingParent(sel.anchor.getNode(), $isListNode);
          on = $isListNode(l) && l.getListType() === 'number';
        });
        editor.dispatchCommand(
          on ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND,
          undefined,
        );
      },
      selectedText: () => {
        let text = '';
        editor.getEditorState().read(() => {
          const sel = $getSelection();
          if ($isRangeSelection(sel)) text = sel.getTextContent();
        });
        return text;
      },
      applyLink: (href, text) => {
        if (!isSafeHref(href)) return;
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          if (sel.isCollapsed()) sel.insertText(text);
        });
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, href);
      },
    });
  }, [editor, registerCommands]);

  return null;
}


/**
 * Where the caret is on screen, relative to the popover's positioned ancestor.
 *
 * `getBoundingClientRect` on the live DOM range is the only thing that knows —
 * Lexical's model has offsets, not pixels, and a wrapped line makes the two
 * unrelated. A COLLAPSED range legitimately has zero width, and at the very
 * start of a text node some engines hand back an all-zero rect; the anchor
 * node's own element is the fallback, which is the right line even if not the
 * right column.
 *
 * Returns null rather than a guess when nothing can be measured, because
 * `MentionList` treats null as "no caret known" and falls back to its old
 * placement. A zero would instead pin the popover to the field's top-left
 * corner and look deliberate.
 */
function measureCaret(anchorTo: React.RefObject<unknown>): MentionAnchor | null {
  const host = anchorTo.current as HTMLElement | null;
  if (!host || typeof window === 'undefined') return null;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);

  let rect = range.getBoundingClientRect();
  if (rect.height === 0) {
    const el =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;
    if (!el) return null;
    rect = el.getBoundingClientRect();
  }
  if (rect.height === 0) return null;

  const box = host.getBoundingClientRect();
  const anchor = anchorForCaret(
    { x: rect.left - box.left, y: rect.top - box.top, height: rect.height },
    {
      fieldWidth: box.width,
      below: window.innerHeight - rect.bottom,
      above: rect.top,
    },
    MENTION_DESIRED_HEIGHT,
  );
  // Into the OVERLAY's space, which is the viewport: the layer is the last child
  // of the app root and scrolls with nothing. `anchorForCaret` stays field-
  // relative — it is what makes the sideways clamp mean "inside the field" —
  // so the field's own origin is added here and nowhere else.
  return { ...anchor, top: anchor.top + box.top, left: anchor.left + box.left };
}

/**
 * The field's own box, for when no caret can be measured.
 *
 * Same coordinate space as `measureCaret` — the viewport, which is what the
 * overlay is positioned against — so the two are interchangeable and there is
 * only ONE rendering path to keep correct.
 */
function measureField(anchorTo: React.RefObject<unknown>): MentionAnchor | null {
  const host = anchorTo.current as HTMLElement | null;
  if (!host) return null;
  const box = host.getBoundingClientRect();
  if (box.width === 0) return null;
  return anchorForField(
    { x: box.left, y: box.top, width: box.width },
    MENTION_DESIRED_HEIGHT,
  );
}

/**
 * @mention autocomplete, using a REAL caret.
 *
 * This is the half a plain `TextInput` cannot have. The old box passed its
 * whole value to `activeMentionQuery`, which is `$`-anchored, so a mention had
 * to be the last thing in the field — put the caret in the middle, type `@`, and
 * nothing opens. Here the query comes from the text BEFORE the caret in the
 * anchor node, so mid-text mentions work, which is a bug fix rather than a new
 * feature.
 *
 * The list, its ranking, the highlight and the popover are the SHARED ones.
 * Only "where is the caret" and "insert here" live in this file.
 */
function MentionPlugin({
  candidates,
  prioritiseUids,
  anchorTo,
}: {
  candidates: readonly MentionCandidate[];
  prioritiseUids?: readonly string[];
  /** The element `anchor` is measured against. */
  anchorTo: React.RefObject<unknown>;
}) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<MentionAnchor | null>(null);
  const pitch = useRef(ROW_PITCH);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        let open = false;
        editorState.read(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) {
            setQuery(null);
            return;
          }
          const node = sel.anchor.getNode();
          if (!$isTextNode(node)) {
            setQuery(null);
            return;
          }
          // Text up to the CARET, not the whole value.
          const q = activeMentionQuery(
            node.getTextContent().slice(0, sel.anchor.offset),
          );
          setQuery(q);
          open = q !== null;
        });
        // Read the caret's position AFTER the editor-state read, and only while
        // a mention is actually being typed — a rect per keystroke otherwise,
        // and `getBoundingClientRect` forces layout.
        setAnchor(open ? (measureCaret(anchorTo) ?? measureField(anchorTo)) : null);
      }),
    [editor, anchorTo],
  );

  const policy = useMentionPolicy({
    query,
    candidates,
    prioritiseUids,
    rowPitch: pitch.current,
    onInsert: (candidate) => {
      // Both the literal AND the range come from @sabeel/shared. This used to
      // spell out `@${handle}` here while native called setMention() there, and
      // the two disagreed about whether the indicator was part of the text —
      // which is how native mentions notified nobody for a month.
      const { literal } = mentionInsertion(candidate);
      editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
        const node = sel.anchor.getNode();
        if (!$isTextNode(node)) return;
        const offset = sel.anchor.offset;
        const before = node.getTextContent().slice(0, offset);
        // The SHARED matcher, not a fourth copy of the pattern. It returns the
        // partial handle; what has to be selected back over is that plus the
        // indicator.
        const partial = activeMentionQuery(before);
        if (partial === null) return;
        const typed = partial.length + MENTION_INDICATOR.length;
        sel.setTextNodeRange(node, offset - typed, node, offset);
        sel.insertText(`${literal} `);
      });
    },
    onRefocus: () => editor.focus(),
  });

  // Focus drives whether the popover may open at all.
  useEffect(() => {
    const el = editor.getRootElement();
    if (!el) return;
    const on = () => policy.onFocus();
    const off = () => policy.onBlur();
    el.addEventListener('focus', on);
    el.addEventListener('blur', off);
    return () => {
      el.removeEventListener('focus', on);
      el.removeEventListener('blur', off);
    };
  }, [editor, policy]);

  /**
   * Keys, intercepted ONLY while the list is open.
   *
   * Returning true swallows the event, so Enter must still insert a paragraph
   * and Tab must still move focus whenever the popover is closed.
   */
  useEffect(() => {
    const stop = (fn: () => void) => () => {
      if (!policy.open) return false;
      fn();
      return true;
    };
    const accept = () => {
      const s = policy.suggestions[policy.index];
      if (s) policy.accept(s);
    };
    return mergeRegister(
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, stop(() => policy.move(1)), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, stop(() => policy.move(-1)), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ENTER_COMMAND, stop(accept), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_TAB_COMMAND, stop(accept), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ESCAPE_COMMAND, stop(() => policy.dismiss()), COMMAND_PRIORITY_HIGH),
    );
  }, [editor, policy]);

  const onMeasureRow = useCallback((p: number) => {
    pitch.current = p;
  }, []);

  /**
   * Memoised because `useMentionOverlay` publishes on identity: a fresh object
   * every render would re-render the root layer on every keystroke of the
   * document, not just the ones that change the list.
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

  return null;
}

export function RichEditor({
  initialMarkdown,
  onChangeMarkdown,
  placeholder,
  autoFocus,
  candidates,
  prioritiseUids,
  testID,
  minHeight = 120,
}: {
  initialMarkdown: string;
  onChangeMarkdown: (md: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Board members, when this box supports @mentions (comments do; descriptions do not). */
  candidates?: readonly MentionCandidate[];
  prioritiseUids?: readonly string[];
  /** Stable handle for e2e: a contenteditable exposes no placeholder to select on. */
  testID?: string;
  /** Comments are short; a description-sized box wastes the scarcest thing on
   *  the card screen. */
  minHeight?: number;
}) {
  const t = useTheme();
  const [marks, setMarks] = useState<RichMarks>(EMPTY_MARKS);
  /**
   * The mention popover's positioned ancestor.
   *
   * `LexicalComposer` renders no DOM node of its own, so the popover's
   * containing block is THIS View — react-native-web gives every View
   * `position: relative`. Measuring the caret against it is what turns a
   * viewport rect into the popover's own coordinate space.
   */
  const wrapRef = useRef(null);
  /**
   * The link sheet, and the selected text CAPTURED at the moment it opens.
   *
   * `initialText` used to be `cmds.current?.selectedText()` read inline in the
   * render below — a live editor read on every render, which answers "" as soon
   * as the sheet takes focus and the editor's selection goes. See `LinkFields`
   * for what that cost. One capture, on the one event that needs it.
   */
  const [linkSheet, setLinkSheet] = useState<{ open: boolean; text: string }>({
    open: false,
    text: '',
  });
  const cmds = useRef<Parameters<Parameters<typeof Bridge>[0]['registerCommands']>[0] | null>(null);
  const registerCommands = useCallback((c: NonNullable<typeof cmds.current>) => {
    cmds.current = c;
  }, []);

  /**
   * Node styling by CLASS, generated from theme tokens.
   *
   * `ContentEditable` is a real DOM element, so react-native-web styles do not
   * reach it and descendant rules (`strong`, `ul`, `a`) cannot be inline. The
   * ESLint no-hardcoded-colour rule cannot see inside a CSS string either, so
   * every colour here comes from `useTheme()` deliberately.
   */
  const css = useMemo(
    () => `
      .sk-rt {
        outline: none;
        /* NOT inherited from anywhere — see SYSTEM_FONT_STACK above. */
        font-family: ${SYSTEM_FONT_STACK};
        font-size: ${type_.body.fontSize}px;
      }
      .sk-rt-p { margin: 0 0 ${space.sm}px; }
      .sk-rt-b { font-weight: 700; }
      .sk-rt-i { font-style: italic; }
      .sk-rt-a { color: ${t.accent.base}; text-decoration: underline; }
      .sk-rt-ul, .sk-rt-ol { margin: 0 0 ${space.sm}px; padding-left: ${space.lg}px; }
      .sk-rt-li { margin: 0 0 ${space.xs}px; }
    `,
    [t.accent.base],
  );

  const initialConfig = useMemo(
    () => ({
      namespace: 'sabeel-rich',
      nodes: [ListNode, ListItemNode, LinkNode],
      theme: {
        paragraph: 'sk-rt-p',
        text: { bold: 'sk-rt-b', italic: 'sk-rt-i' },
        link: 'sk-rt-a',
        list: { ul: 'sk-rt-ul', ol: 'sk-rt-ol', listitem: 'sk-rt-li' },
      },
      onError: (e: Error) => {
        throw e;
      },
    }),
    [],
  );

  const commands = useMemo(
    () => ({
      toggleBold: () => cmds.current?.toggleBold(),
      toggleItalic: () => cmds.current?.toggleItalic(),
      toggleBullets: () => cmds.current?.toggleBullets(),
      toggleNumbers: () => cmds.current?.toggleNumbers(),
      promptLink: () =>
        setLinkSheet({ open: true, text: cmds.current?.selectedText() ?? '' }),
    }),
    [],
  );

  // Into <head>, not into the tree: a <style> element inside a View is invalid
  // nesting and React says so on every render. One node, shared by every editor
  // instance, replaced when the theme changes.
  useEffect(() => {
    const id = 'sk-richtext-style';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [css]);

  return (
    <View ref={wrapRef} style={styles.wrap}>
      {/*
        Pressing a toolbar button steals focus and collapses the selection
        before the command runs, so the format applies to nothing. Preventing
        the default on mousedown is the standard fix and has no RN equivalent,
        which is precisely the kind of thing the seam exists to hold.
      */}
      <div onMouseDown={(e) => e.preventDefault()}>
        <RichToolbar commands={commands} marks={marks} />
      </div>

      <LexicalComposer initialConfig={initialConfig}>
        {/*
          A POSITIONED container around the editable and its placeholder.

          The placeholder is absolutely positioned, and without an explicit
          relative parent it anchored to an ancestor further up — landing on top
          of the toolbar, so the icons and the words "Add a comment" drew over
          each other. Only a screenshot showed it; every assertion still passed.
        */}
        <div style={{ position: 'relative' }}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="sk-rt"
              data-testid={testID}
              aria-label={placeholder ?? 'Rich text'}
              autoFocus={autoFocus}
              style={{
                minHeight,
                backgroundColor: t.bg.surface,
                color: t.text.primary,
                borderColor: t.border.subtle,
                borderWidth: StyleSheet.hairlineWidth,
                borderStyle: 'solid',
                borderRadius: radius.sm,
                padding: space.md,
                // Font family and size live in `.sk-rt` — an inline value here
                // would win over the class and silently undo it.
                lineHeight: 1.5,
              }}
            />
          }
          placeholder={
            <div
              style={{
                // top/left are NOT optional. `position: absolute` without them
                // falls at the element's STATIC position — which, since the
                // placeholder is rendered after the editable, put it below the
                // box and over the Comment button.
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                padding: space.md,
                color: t.text.muted,
                // Matches the editable exactly, or the text jumps size and
                // typeface on the first keystroke.
                fontFamily: SYSTEM_FONT_STACK,
                fontSize: type_.body.fontSize,
                lineHeight: 1.5,
              }}
            >
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin validateUrl={isSafeHref} />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        {candidates ? (
          <MentionPlugin
            candidates={candidates}
            prioritiseUids={prioritiseUids}
            anchorTo={wrapRef}
          />
        ) : null}
        <Bridge
          initialMarkdown={initialMarkdown}
          onChangeMarkdown={onChangeMarkdown}
          onMarks={setMarks}
          registerCommands={registerCommands}
        />
      </LexicalComposer>

      <LinkSheet
        visible={linkSheet.open}
        initialText={linkSheet.text}
        onCancel={() => setLinkSheet({ open: false, text: '' })}
        onConfirm={(href, text) => {
          cmds.current?.applyLink(href, text);
          setLinkSheet({ open: false, text: '' });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
});
