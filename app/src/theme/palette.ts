/**
 * Raw color values. THE ONLY FILE IN THE APP ALLOWED TO CONTAIN COLOR LITERALS —
 * an ESLint rule enforces this everywhere under app/src except app/src/theme.
 *
 * These are the Sabeel Institute brand colors, **Option 1** — the designer's
 * revised palette (2026-07-21), which SUPERSEDES the original
 * `docs/brand/sabeel-color-usage-guide.jpg`. `docs/BRAND.md` restates it and
 * records where this palette deliberately departs from it for accessibility
 * (body text and gold-as-signal need deeper cuts). Read BRAND.md first.
 *
 * SINGLE LIGHT THEME. There is no dark mode — decided 2026-07-21. The app is
 * light only; `palette` is one object, not light/dark variants.
 *
 *   Warm Ivory     #F6EBDD   foundation — backgrounds, cards
 *   Soft Sage      #A8B89A   calm & community — alternate surfaces
 *   Dark Raspberry #83114F   brand identity — headings, buttons, links
 *   Antique Gold   #C6A15B   elegance — dividers, accents, hover
 *   Mushroom Taupe #A58D7A   support — borders, captions, shadows
 *
 * Option 1 is a real revision, not a re-measure: raspberry moved from a brick
 * red (#8A1538) to this plum (ΔE ~17), and gold to a muted tan (ΔE ~13). Both
 * apps shipped the old hues, so this is a coordinated change, not a correction
 * of one against the other. The sibling time-tracker matches this same palette.
 *
 * Nothing outside src/theme imports this. Screens consume the semantic tokens in
 * ./index.ts, so a brand refresh is a one-file change.
 */
export const palette = {
  // Warm Ivory carries the base; cards sit a shade brighter so they lift off it.
  canvas: '#F6EBDD',
  surface: '#FBF6F0',
  raised: '#FFFFFF',
  inset: '#E7DDD0',
  // NOT Mushroom Taupe: that is ~2.7:1 on ivory and fails WCAG AA for body
  // text. These stay in the same warm family while remaining legible.
  textPrimary: '#3A2F28',
  textSecondary: '#6A5748',
  textMuted: '#A58D7A', // Mushroom Taupe — captions only, never body text
  textInverse: '#F9F2E9',

  // Borders lean on taupe and sage, where softness is the point.
  borderSubtle: '#DFD1C1',
  borderStrong: '#C9B7A7',

  // Dark Raspberry: key actions, headings, brand presence — used with purpose.
  accent: '#83114F',
  accentHover: '#660D3E',
  accentText: '#F9F2E9',
  accentSoft: '#E6CCC9',

  danger: '#A32218',
  dangerSoft: '#F8E4E1',
  // Soft Sage, darkened until it reads as TEXT on every background it sits
  // on: a lane's finished count is drawn in it on a column (inset). #456B3B
  // measures 4.58:1 on inset, 5.22 on canvas, 5.72 on surface, and carries
  // the light tick of the overview's mark at 5.53. A lighter sage that reads
  // on ivory can still fail on inset (#4E7A43: 4.26 and 3.74).
  success: '#456B3B',
  // Antique Gold deepened to #977535 so a warning actually reads — true gold
  // #C6A15B is ~2.1:1 on ivory. Gold stays true where it is decoration, not
  // signal (borders, dividers); the semantic tokens keep those separate.
  warning: '#977535',

  // Soft Sage darkened to #616B59 so a chart bar is actually visible.
  //
  // The THIRD instance of the departure BRAND.md already documents twice (body
  // text is a darkened taupe; `warning` is a deepened gold): a brand colour that
  // starts carrying meaning has to earn its contrast first. Soft Sage #A8B89A is
  // 1.79:1 on ivory and 1.57:1 on inset — below even the 3:1 floor for non-text,
  // so bars drawn in it are barely separable from the page they sit on.
  //
  // #616B59 is the same hue at 58% and measures 4.75:1 on canvas, 5.20:1 on
  // surface, 4.17:1 on inset. Sage is right for this by the brand's own reading
  // — data is decoration, not identity — so raspberry stays reserved.
  //
  // Only ONE bar colour: the chart shows one metric at a time. A second tint was
  // measured and rejected — anything light enough to read as "different" fails
  // 3:1, and anything that passes sits at 1.29:1 against this one, which is not
  // a difference anyone can see. The in-progress bucket is drawn OUTLINED
  // instead.
  chartBar: '#616B59',

  // Priority is a FUNCTIONAL scale, not brand colour: it must read as urgency.
  // With raspberry now plum, these oranges/reds no longer risk reading as it.
  // Each is a pill's fill under its own word, so each carries its better ink
  // at 4.5:1 or more (`readableInkOn`; the sweep's contrast check): High is
  // darkened for light ink (4.58), Medium lightened for dark ink (4.52).
  priorityNone: '#A58D7A',
  priorityLow: '#4E7A43',
  priorityMedium: '#C58F0C',
  priorityHigh: '#AD561C',
  priorityUrgent: '#A32218',

  overlay: '#3A2F2866',
  shadow: '#A58D7A33',
} as const;
