/**
 * A parsed description or comment, on a phone: ONE native text view.
 *
 * Android selection cannot cross text views. Drawn as one `Text` per paragraph
 * and list row, "Select all" took one paragraph, and a list row without
 * `selectable` could not be selected at all. So the whole document has to be a
 * single view, and only a real list span keeps a wrapped bullet line indented:
 * a single React Native `Text` puts it back at the left edge. The editor's
 * library already ships such a view, so this adds no library; `patches/`
 * changes one line of its Android parser, and `app/src/richTextSeam.test.ts`
 * holds the library to what this relies on.
 *
 * The browser keeps `RichDocView.web.tsx`, whose selection already crosses
 * elements. Both take the document `RichText` parsed.
 *
 * A long-press that starts on a link opens the link, as it does in a plain
 * `Text`. Selecting across one still works by dragging a handle over it.
 */
import { useMemo } from 'react';
import { Linking, Platform } from 'react-native';
import { EnrichedText } from 'react-native-enriched-html';
import { decodeDisplayHref, richDocToDisplayHtml, type RichDoc } from '@sabeel/shared';
import { type, useTheme } from '../theme';
import { useRichHtmlStyle } from './richHtmlStyle';

// iOS hands the address back as written in the HTML, escapes included, so
// `?a=1&b=2` would open as `?a=1&amp;b=2`. Android has decoded it already.
function openLink({ url }: { url: string }) {
  const href = Platform.OS === 'ios' ? decodeDisplayHref(url) : url;
  void Linking.openURL(href).catch(() => undefined);
}

export function RichDocView({ doc }: { doc: RichDoc }) {
  const t = useTheme();
  const style = useMemo(() => ({ ...type.body, color: t.text.primary }), [t]);
  const shared = useRichHtmlStyle();
  // Memoised because a new object re-parses the text natively (see
  // `useRichHtmlStyle`). pressColor too, or a pressed link flashes the
  // library's own dark blue.
  const htmlStyle = useMemo(
    () => ({ ...shared, a: { ...shared.a, pressColor: t.accent.hover } }),
    [shared, t],
  );
  return (
    <EnrichedText
      selectable
      useHtmlNormalizer={false}
      style={style}
      htmlStyle={htmlStyle}
      onLinkPress={openLink}
    >
      {richDocToDisplayHtml(doc)}
    </EnrichedText>
  );
}
