# Rich-text editing for card descriptions — research, 2026-07-20

> **BUILT 2026-07-30, v0.7.0.** No longer shelved. What follows is the original
> survey, kept because its reasoning is still the reasoning — with one claim now
> WRONG and one outcome section appended at the end.
>
> **Out of date:** *"There is no third category. Feature-complete native rich
> text input does not exist."* Software Mansion shipped
> `react-native-enriched-html` — native Fabric, no WebView — after this was
> written. That is what changed the decision, because "a rich editor means a
> WebView on Android" was the cost that made it not worth doing.
>
> **Still correct:** Lexical with first-party markdown for web; a toolbar
> constrained to what the renderer supports; and the warning that the round trip,
> not the first conversion, is the risk. See "What the build actually measured"
> at the foot of this file.

**No code changed.** This revisits the `CLAUDE.md` invariant *"descriptions are
markdown in a native TextInput — never a WebView rich-text editor"*, at Faisal's
request. The goal he set: **the user sees and edits rich text; markdown stays the
storage format.**

Our stack: Expo ~57, React Native 0.86, React 19.2, react-native-web.

## The honest state of the ecosystem

Expo's own guide is unusually blunt: *"There is currently no default solution for
that in the React Native ecosystem."* It splits the field in two, and every
option lands in one of them.

**1. Wrap a web editor in a WebView.** Real WYSIWYG with a toolbar, one
implementation across web and native. Expo names a *"performance and UX
penalty"*.

**2. Style a native `TextInput` as you type.** Native keyboard behaviour, no
WebView, but the user still sees markers — `**bold**` rendered bold rather than
a toolbar button. Expo calls this "markdown editors with visible styling
markers".

There is no third category. Feature-complete native rich text input does not
exist: React Native's `TextInput` returns plain strings from its callbacks, so
styled editing has to be faked either in a WebView or by re-styling the raw text.

## Candidates, checked against our versions

| Package | Version | Fits our stack? | Output | Verdict |
|---|---|---|---|---|
| `lexical` + `@lexical/markdown` | 0.48.0 | web only — no RN support; needs a WebView / DOM component on native | **markdown, first-party bidirectional** | **Strongest.** Markdown is a supported target, not a bolt-on. |
| `@10play/tentap-editor` | 1.0.1 | peer deps are `*` — unverified against RN 0.86 | **HTML or plain text** | Closest to plug-and-play on native. Markdown needs a conversion layer. |
| `lexkit` | 0.0.38 | built on Lexical | markdown via Lexical | **No.** 17 downloads/week, unpublished since Nov 2025. Read it, do not depend on it. |
| `@expensify/react-native-live-markdown` | 0.1.333 | needs `react-native-worklets` ≥0.7, `expensify-common` | **markdown, unconverted** | Native input, no WebView. **ExpensiMark flavour only** out of the box, not CommonMark. |
| `@siposdani87/expo-rich-text-editor` | 1.3.0 | requires Expo ≥55, RN ≥0.83 — we satisfy this | HTML | WebView + `contentEditable`. Smaller and less proven than TenTap. |
| `react-native-enriched-markdown` | 0.7.4 | pulls in `katex`, a config plugin | — | **Not an editor.** "Markdown Text component" — rendering only. |

Also available and worth naming: **Expo DOM components** (`'use dom'`, SDK 52+,
so we qualify). These let a plain React *web* component render inside a WebView
on native and natively on web. That means TipTap or Lexical could be used
directly with no React-Native-specific wrapper — the same WebView cost on
native, but no dependency on a third-party bridge staying maintained.

## Lexical, and LexKit

Faisal raised both. They are not the same kind of bet.

**Lexical (Meta) is the strongest option, and for one specific reason.**
`@lexical/markdown` is **first-party**: official bidirectional import/export
driven by a `TRANSFORMERS` array, with round-trip (import → export → import)
coverage in Lexical's own test suite. That speaks directly to the risk this
whole decision turns on. TipTap's equivalent is a third-party plugin at 0.9.0.
Lexical is at **0.48.0, ~4.2M downloads/week, last published today** — it is
what Meta ships in its own products, so it will outlive this project.

Its cost is blunt and unavoidable: **Lexical has no React Native support**, and
the maintainers have said so. On native it must run in a WebView — either
hand-rolled with `react-native-webview`, or through Expo DOM components, which
is the same thing with less glue to maintain. `Planable/react-native-lexical`
exists on GitHub but is not published to npm.

**LexKit is a headless toolkit built on Lexical — and I would not adopt it.**
The numbers are not close:

| | version | downloads/week | last published |
|---|---|---|---|
| `lexical` | 0.48.0 | **4,159,944** | today |
| `@10play/tentap-editor` | 1.0.1 | 57,300 | recent |
| `lexkit` | **0.0.38** | **17** | Nov 2025 (8 months ago) |

Seventeen downloads a week, a single-author repository, no release in eight
months, and a version number that says pre-alpha. For a nonprofit tool expected
to run for years with one part-time developer, adopting that means owning it.
Its actual value is as a **reference implementation** — it demonstrates wiring
Lexical's markdown transformers into a toolbar, which is the fiddly part, and
that can be read without taking on the dependency.

## The part that actually decides it

**Markdown is not a lossless target for a WYSIWYG editor.** TenTap emits HTML;
turning that into markdown needs `tiptap-markdown` (0.9.0, pre-1.0) or Turndown.
The risk is not the first conversion, it is the round trip: open → edit → save →
reopen. Anything the editor can express that markdown cannot — nested tables,
coloured text, arbitrary spans — degrades silently, and it degrades on someone's
real notes rather than on a test string.

That risk is controllable by **constraining the editor to exactly what our
renderer supports** (bold, italic, code, headings, lists, links, quotes) and
disabling everything else. A toolbar with six buttons that round-trips perfectly
is a better product than a rich toolbar that quietly eats formatting.

The second consideration is specific to us and recent: **we have just spent a
long session fixing keyboard behaviour** — edge-to-edge insets, a submit button
under the keyboard, a composer on a non-scrolling screen. A WebView introduces
its own keyboard, focus, and selection layer inside the one we just tuned, and
bugs in it are markedly harder to diagnose because the usual inspection tools
stop at the WebView boundary.

## Recommendation

**Do it, but prove the round trip before committing, and do web first.**

1. **Prototype on web only with Lexical**, where the cost is zero. It runs
   natively in the browser — no WebView, no bridge, no third-party editor
   dependency. Our `.web.tsx`/`.tsx` seams already exist for exactly this split.
   Use `@lexical/markdown`'s transformers so markdown is the editor's own
   format rather than something reconstructed from HTML.
2. **Constrain the toolbar** to what `Markdown.tsx` renders today, so markdown
   remains a faithful representation rather than a lossy export.
3. **Measure fidelity with real content**, not samples: take the descriptions
   from the ClickUp export once it arrives, round-trip every one, and diff.
   Anything that does not survive is a feature to disable, not a bug to fix
   later.
4. **Only then decide native.** Lexical in an Expo DOM component gives one
   codebase across both surfaces at the cost of a WebView; `live-markdown` keeps
   the native input but speaks ExpensiMark and would need a CommonMark parser.
   Web usage patterns should inform which — and if the team turns out to edit
   mostly on phones, that ordering is wrong and native should lead.

Staging it this way means the invariant is retired on evidence rather than
enthusiasm, and the fallback at every point is the editor we already ship.

## What would change the recommendation

- If the team edits mostly on phones, web-first is the wrong order.
- If descriptions are consistently short and plain, this is effort spent on a
  problem the team does not have — worth checking against the ClickUp export
  before building anything.

---

## What the build actually measured (2026-07-30)

The spike answered the four questions this document could not, and each is a
number rather than an impression:

| | Result |
|---|---|
| Lexical under Metro | Bundles with no `metro.config.js`. Web bundle **740 → 963 KB gzipped (+223 KB)** |
| A contenteditable inside `KeyboardScroll` | Works at 390px; Playwright drives it |
| `enriched-html` vs the committed `android/` | Autolinks, no config plugin, no SDK/Kotlin/AGP bump. APK **36.1 → 37.2 MB** |
| keyboard-controller + a Fabric non-`TextInput` | **Scrolls it clear.** Editor, toolbar row and Save row all visible with the IME up, inside the existing 96px budget |

**Measured again on 2026-10-13: that +223 KB carried both of Lexical's builds.**
Lexical's default entry imports its development and its production build and
picks one at run time; Metro does not tree-shake, so both shipped.
`app/metro.config.js` resolves Lexical's packages to their `production` export
condition in an export (`development` under the dev server). From the export's
source map: Lexical 988 → 445 KB minified, every Lexical file a `.prod.mjs`;
the web bundle 4.18 → 3.63 MB, 1,032 → 902 KB gzipped.

Two corrections to this document's own recommendation, both found by building:

1. **`@lexical/markdown` is NOT the save path.** It escapes a different set from
   ours (`_`, backtick, `~`), and running two serializers would mean proving they
   agree. HTML is the single seam on both platforms instead, so one converter has
   to be proved to work and the same keystrokes store identical bytes on a phone
   and in a browser.
2. **Lexical DOES escape on export** — this document implied the risk lay there.
   It escapes `*_`~\` and a leading ordered marker. The real reason to own the
   serializer is cross-surface byte identity, not Lexical's escaping.

What the fidelity worry turned out to be, concretely: `[draft](note)` losing its
parens, `[x](javascript:…)` leaving a stray `)`, `***x***` parsing as bold plus a
loose asterisk, and an href escaped on `)` but not `(` silently ceasing to be a
link on its SECOND round trip. All four were found by a seeded 400-document fuzz
before any of it shipped, which is the argument for stating the contract as a
property rather than as a list of cases.

**The one thing no test found was typographic.** Lexical's editable is a real DOM
element, and react-native-web writes its font stack onto each `Text` it renders
rather than onto `body` — so the editor inherited nothing and came up in **Times
at 16px** inside an app that is sans at 15. Every assertion passed; the colour
lint rule cannot see into a CSS string; the layout was not broken. What caught it
was regenerating the user manual's screenshots and looking at one. The editor now
takes its font from the same tokens the app does, `richtext-e2e.mjs` compares the
two *computed* fonts rather than restating the stack, and the native editor's
size is pinned for the same reason (RN's `TextInput` default is 14, not 15).
