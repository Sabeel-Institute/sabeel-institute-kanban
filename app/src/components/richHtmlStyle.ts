import { useMemo } from 'react';
import type { HtmlStyle } from 'react-native-enriched-html';
import { space, useTheme } from '../theme';

/**
 * How a phone draws links and lists, in the card AND in its editor: one
 * definition, so editing shows what the card will.
 *
 * The editor once styled only links, so its bullets came out large and black
 * and its numbers dark beside the card's small grey ones (2026-11-14).
 * Memoised because a new object re-parses the text natively: the library
 * treats a style change as a reason to rebuild every span, which in the
 * editor is every keystroke's render.
 */
export function useRichHtmlStyle() {
  const t = useTheme();
  return useMemo(
    () =>
      ({
        a: { color: t.accent.base, textDecorationLine: 'underline' },
        // Text starts at about the same place in both, as it does in a
        // browser. The library centres a number on its margin plus half the
        // font size, so the gap is what keeps "10." clear of the words after it.
        ul: { bulletColor: t.text.secondary, bulletSize: 4, marginLeft: space.sm, gapWidth: space.lg },
        ol: { markerColor: t.text.secondary, marginLeft: space.xs, gapWidth: space.lg },
      }) satisfies HtmlStyle,
    [t],
  );
}
