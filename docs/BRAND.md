# Sabeel Institute brand colors

**Source of truth: the designer's "Option 1" palette (2026-07-21).** This is a
deliberate *revision* of the original `docs/brand/sabeel-color-usage-guide.jpg`,
not a re-measure of it — the guide JPG is **superseded** and kept only for
history. This file is the machine-readable restatement plus the app-level decisions
the palette itself does not state (accessibility cuts, the no-dark-mode call).

**Both apps share this palette exactly** — the Kanban board and the sibling
`sabeel-institute-time-tracker`. It is one identity across two products. The
canonical write-up for every Sabeel surface is the shared **`sabeel-brand`
skill** in [Sabeel-Institute/brand](https://github.com/Sabeel-Institute/brand); when the
two disagree, the skill wins.

## The palette

| Color | Hex | Share | Role | Where |
|---|---|---|---|---|
| Warm Ivory | `#F6EBDD` | 35% | Foundation | Main backgrounds, cards, content areas, forms |
| Soft Sage | `#A8B89A` | 30% | Calm & community | Alternate sections, highlights, footer, decor |
| Dark Raspberry | `#83114F` | 20% | Brand identity | Logo, headings, buttons, links, CTAs, titles |
| Antique Gold | `#C6A15B` | 10% | Elegance | Icons, dividers, borders, accents, hover states |
| Mushroom Taupe | `#A58D7A` | 5% | Support | Secondary text, borders, shadows, captions |

### What changed from the old guide, and why it matters

Two colours moved far enough to reread as different colours; the other three
barely shifted. Both apps had shipped the *old* values, so adopting Option 1 was
a coordinated change to both — not a correction of one against the other.

- **Raspberry `#8A1538` → `#83114F`** (ΔE ~17): brick red to plum. This is the
  most visible change in either app — it is every primary button, heading and
  link. Anything that hand-tuned a tint of the old red (a soft accent
  background, a pressed state) had to be re-derived, not nudged.
- **Gold `#C89B3C` → `#C6A15B`** (ΔE ~13): a brighter yellow-gold to a muted tan.
- Ivory, sage and taupe shifted only slightly (ΔE 3–5).

The guide's stated principles, which the app follows:

- **Keep it light and airy** — Warm Ivory and Soft Sage carry the base.
- **Use raspberry with purpose** — reserved for key actions, headings and brand
  presence. It is the primary button and the accent, never a background wash.
- **Let gold shine sparingly** — small touches only: dividers, focus rings,
  selected states.
- **Ensure accessibility** — strong contrast between text and background.

## Three deliberate departures, and why

**1. Body text is a darkened taupe, not Mushroom Taupe.**
The palette lists Mushroom Taupe (`#A58D7A`) for support text. On Warm Ivory that
is roughly **2.7:1** contrast — well below the WCAG AA minimum of 4.5:1 for body
text, and genuinely hard to read on a phone outdoors. Since the guide *also*
insists on accessibility, the two instructions conflict, and legibility wins:

- Primary text: `#3A2F28` — a deep warm brown that reads as the same family.
- Secondary text: `#6A5748` — a darkened taupe, ~5.8:1 on ivory.
- Mushroom Taupe itself is kept for **borders, dividers, shadows and muted
  captions**, exactly where its softness is an asset and contrast is not
  load-bearing.

Raspberry on ivory is ~8.3:1, so headings and links are comfortably fine as
specified. A second, quieter case of the same rule: **gold as a functional
signal is deepened** — `#C6A15B` is ~2.1:1 on ivory, so the `warning` token uses
`#977535`. True gold stays true where it is decoration (dividers, borders), not
signal.

**2. Chart bars are a darkened sage, not Soft Sage (added 2026-07-28).**
The same rule as above, reaching a third place. Soft Sage `#A8B89A` measures
**1.79:1** on canvas, **1.96:1** on surface and **1.57:1** on inset — below even
the 3:1 floor WCAG sets for non-text content, so bars drawn in it are barely
separable from the page they sit on. `chart.bar` is therefore `#616B59`: the same
hue at 58%, measuring 4.75 / 5.20 / 4.17:1. Sage is still the right family by the
brand's own reading — data is decoration, not identity — so raspberry stays
reserved for the identity accent, and is used in the chart only to mark the bar
you have selected.

There is exactly ONE bar colour, because the chart shows one metric at a time. A
second, lighter tint for the in-progress period was measured and rejected:
anything light enough to read as different fails 3:1, and anything that passes
sits at 1.29:1 against the main bar, which is not a difference anyone can see.
The unfinished period is drawn **outlined** instead.

**3. There is no dark mode — single light theme (decided 2026-07-21).**
The palette defines only a light appearance and the app ships only that;
`app.json` pins `userInterfaceStyle: "light"`. `useTheme()` returns one theme.
An earlier build had a derived dark palette; it was removed, not disabled — a
dormant second theme invites someone to switch it back on against this decision.
If the brand ever wants dark, a `dark` variant goes back into
`app/src/theme/palette.ts` and `useTheme()` is the single place that would
select it; no screen would change, because screens only ever read role tokens.

## Resolved: muted captions that carry meaning (2026-07-28)

Departure 1 keeps Mushroom Taupe for "borders, dividers, shadows and muted
captions". The question was whether small text that carries real meaning — an
empty state, a helper sentence, an error, a control's label — may sit at that
contrast. Re-measured on all four backgrounds:

| Text token | on `canvas` | on `surface` | on `inset` | on `accentSoft` |
|---|---|---|---|---|
| `Caption` → `text.muted` `#A58D7A` | **2.67:1** | **2.92:1** | **2.34:1** | **2.07:1** |
| `Hint` → `text.secondary` `#6A5748` | 5.81:1 | 6.37:1 | 5.10:1 | 4.51:1 |

`Caption` fails AA everywhere, and fails even the 3:1 floor for non-text on three
of the four.

**Decision: the line already stated in `ui.tsx` is the rule, and it is now
followed.** `Caption` is for text you could delete without losing information;
anything that conveys content is `Hint`. Thirty-five sites moved to `Hint`;
seven remain on `Caption`, all of them genuinely disposable — timestamps, the
build stamp, a file's type, "current", and two counts that repeat what the list
beside them already shows.

`Caption` was not the only route to `text.muted`. `Body` had a `muted` variant,
and **every one of its seven callers used it for something that carried
meaning** — an empty state, an instruction, "You are not a member of this
board". Those are now plain `Body` (same size, `text.secondary`), and the prop
is **removed** rather than left unused, so nothing invites the next person to
reach for it.

`text.muted` itself is **not** darkened. Doing so would collapse the difference
between muted and secondary, so counts and timestamps would stop receding and
every screen would read as busier — the softness is the point where the text is
decoration. The fix was to stop using it for things that are not.

Same size either way (`type.caption` for both), so this is a colour change only
and shifts no layout.

## The logo

Source: `docs/brand/sabeel-logo.png`, copied to `app/assets/logo.png`, which
is what the app bundles and what `npx sabeel-ci render-manual` puts on the
manual's cover (the path every Sabeel app uses).

Arabic calligraphy reading *Sabeel* with gold accent strokes, alongside the
wordmark. One rule follows from its construction:

**One asset, no plate and no tint.** `sabeel-logo.png` — dark calligraphy with
gold accents — ships with transparency and sits directly on the warm-ivory
canvas. A flat `tintColor` would recolour the whole mark and **throw the gold
away**. (The app is light-only, so the ivory-on-dark reverse mark a dark theme
would need is not bundled; it was removed with dark mode.)
- **It appears on the sign-in screen only.** Inside the app the brand is carried
  by the palette. A logo repeated on every screen is chrome, and on a phone it
  costs space the board needs.

If a vector version (SVG/PDF) exists, add it alongside — the PNG will soften on
large displays and at print sizes.

## The app icons — one mark, one badge per app

Three Sabeel apps share one identity, so they share one generator:
`scripts/make-app-icons.py` (kanban, time tracker, class recordings, LMS). Run
it from this repo; `--repo` points it at a sibling.

**The LMS is the exception: the brand's own icon.** It is the app the public
installs from the stores, so it carries the icon the `sabeel-brand` skill
gives: the brand logo's raspberry calligraphy alone, centred on Warm Ivory,
no badge (`docs/brand/sabeel-calligraphy.png`, cut from the logo above its
wordmark). The square icon has it across 76% of the tile, and the adaptive
foreground across 76% of the 72dp a launcher shows.

**The mark is the brand, the badge says which app.** Warm Ivory canvas, the
calligraphy low, a Dark Raspberry disc above-right carrying an ivory glyph — a
board, a stopwatch, a microphone. Raspberry is spent on the badge alone, which
keeps the icon inside its ~20% share.

**The wordmark is dropped**, unlike the sign-in lockup. At the 48dp a launcher
draws, "SABEEL INSTITUTE" is a smudge, and it costs the calligraphy the size it
needs to be recognisable. Source is `docs/brand/sabeel-mark.png` — the lockup
with the text removed.

**The geometry is measured, and the script re-proves it on every run** (it exits
non-zero if either invariant breaks, so these numbers cannot rot):

- Nothing outside **radius 341** of the 1024 canvas. An adaptive icon's
  foreground fills the whole 108dp layer and only the central 72dp survives the
  mask — 66.67%, *not* the ~68% that "roughly two thirds" suggests. Getting this
  wrong costs 9px of real badge edge to a circular mask.
- **Zero calligraphy hidden** by the badge, counted by rendering with and
  without it.

Badge 410px (40% of the icon), mark centred at y=637, badge bearing 38°. Each is
at its limit: 418px cuts the sweep, cy=643 puts the descender outside the
circle, 36° hides 12px. Mark and badge both land 338 from centre — the
composition is pressed against the same circle from two directions.

**Do not regenerate these with a bare `expo prebuild`.** All three repos commit
`android/`, so the script writes the native mipmaps directly. Prebuild defaults
to *clean* — it deletes and recreates the native folder — so an unscoped run
takes `build.gradle` with it, and this repo's release signing and Sentry setup.
It only clears the platforms named by `--platform`, which is why
`--platform ios` is safe. See `docs/IOS-BUILD.md`.

## How this is enforced in code

- `app/src/theme/palette.ts` is the **only** file allowed to contain color
  literals. An ESLint rule rejects hex/rgb/hsl anywhere else under `app/src`.
- Screens consume **semantic tokens** from `app/src/theme/index.ts`
  (`bg.canvas`, `text.primary`, `accent.base`, …), never brand names. That way a
  brand refresh is a one-file change, and no screen needs to know that "accent"
  currently means raspberry.
- **`Caption` vs `Hint` (`components/ui.tsx`) — small text is not all the same.**
  `Caption` is `text.muted` (true taupe, ~2.7:1) and is for METADATA you could
  delete without losing information: timestamps, counts, "N assigned". `Hint` is
  the same size at `text.secondary` (~5.8:1) and is for small CONTENT that must
  read: empty-state messages, field labels, emails, short helper sentences.
  Muted-weight content was the legibility bug the colour-scheme verification pass
  found (empty states washed out on a phone); see the `sabeel-brand`
  skill's muted-vs-secondary test.
- Card **priority** colors are a functional scale, not brand colors: red/amber/
  green must read as urgency and cannot be replaced by the brand palette without
  losing that meaning. They are tuned to sit harmoniously beside the brand
  palette and to stay mutually distinguishable on the app's ivory surfaces.
- Board **label** colors offer a fixed palette rather than a free picker, so
  nobody picks something that vanishes against the warm-ivory surfaces.
