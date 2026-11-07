/**
 * A parsed description or comment, in a browser.
 *
 * A browser's selection crosses elements, so plain `Text` blocks do everything
 * here, including the marker column that keeps a wrapped list item aligned.
 * The phones cannot do that: see `RichDocView.tsx`.
 *
 * Nothing here interprets HTML. The document maps to `Text` nodes, so a
 * description containing `<script>` renders as literal characters and there is
 * no sanitiser to get wrong. `react-native-enriched-html`'s web build must stay
 * out of this file: it renders through `dangerouslySetInnerHTML` and DOMPurify,
 * ignores the app's font, and brings TipTap into the bundle.
 */
import { Fragment } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import type { RichDoc, RichInline } from '@sabeel/shared';
import { space, type, useTheme } from '../theme';

function openHref(href: string) {
  void Linking.openURL(href).catch(() => undefined);
}

function Inline({ nodes }: { nodes: RichInline[] }) {
  const t = useTheme();
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case 'text':
            return <Fragment key={i}>{n.text}</Fragment>;
          case 'bold':
            return (
              <Text key={i} style={styles.bold}>
                <Inline nodes={n.content} />
              </Text>
            );
          case 'italic':
            return (
              <Text key={i} style={styles.italic}>
                <Inline nodes={n.content} />
              </Text>
            );
          case 'link':
            return (
              <Text
                key={i}
                style={[styles.link, { color: t.accent.base }]}
                accessibilityRole="link"
                onPress={() => openHref(n.href)}
              >
                <Inline nodes={n.content} />
              </Text>
            );
        }
      })}
    </>
  );
}

/** A list row: the marker sits in its own column so wrapped text stays aligned. */
function Row({ marker, nodes }: { marker: string; nodes: RichInline[] }) {
  const t = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[type.body, { color: t.text.secondary }, styles.marker]}>{marker}</Text>
      <Text style={[type.body, { color: t.text.primary }, styles.rowText]}>
        <Inline nodes={nodes} />
      </Text>
    </View>
  );
}

export function RichDocView({ doc }: { doc: RichDoc }) {
  const t = useTheme();

  return (
    <View style={styles.doc}>
      {doc.map((b, i) => {
        if (b.kind === 'paragraph') {
          return (
            <Text key={i} selectable style={[type.body, { color: t.text.primary }]}>
              <Inline nodes={b.content} />
            </Text>
          );
        }
        return (
          <View key={i} style={styles.list}>
            {b.items.map((item, j) => (
              <Row
                key={j}
                marker={b.kind === 'bullets' ? '•' : `${j + 1}.`}
                nodes={item}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  doc: { gap: space.sm },
  list: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  // A fixed column keeps "10." from shoving its text out of line with "9.".
  marker: { minWidth: 18, textAlign: 'right' },
  rowText: { flex: 1 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  link: { textDecorationLine: 'underline' },
});
