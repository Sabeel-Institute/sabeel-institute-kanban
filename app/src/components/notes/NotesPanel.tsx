import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { BoardNotes, NotesVersion } from '../../boardNotes';
import type { LiveState } from '../../liveQuery';
import { useNav } from '../../nav';
import type { SessionUser } from '../../session';
import { radius, space, type, useTheme } from '../../theme';
import { IconAction, LoadError, Row, Spinner } from '../ui';
import { NotesEditor } from './NotesEditor';
import { NotesBody, NotesStamp } from './NotesView';

/**
 * Wide enough for a link list and a short how-to, narrow enough to leave the
 * board three columns on a laptop: 320, and less on a smaller wide screen,
 * where a fixed 320 took half the board.
 */
function panelWidth(window: number): number {
  return Math.round(Math.min(320, Math.max(240, window * 0.28)));
}

type Members = readonly { uid: string; displayName: string }[];

/**
 * A board's notes on a wide screen: a panel docked at the left of the
 * columns, where the quick-links column it replaces stood. Opened and closed
 * from the board's header (the choice is the person's, kept on their user
 * document); edited in place, so the board stays beside it.
 */
export function NotesPanel({
  boardId,
  notes,
  latest,
  members,
  user,
  onClose,
}: {
  boardId: string;
  /** Three states (CLAUDE.md): "no notes" is never drawn for "could not find out". */
  notes: LiveState<BoardNotes>;
  latest: NotesVersion | null | undefined;
  members: Members;
  user: SessionUser;
  onClose: () => void;
}) {
  const t = useTheme();
  const nav = useNav();
  const [editing, setEditing] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const nameOf = (uid: string | undefined) =>
    members.find((m) => m.uid === uid)?.displayName ?? 'Someone';

  return (
    <View
      style={[
        styles.panel,
        { width: panelWidth(windowWidth), backgroundColor: t.bg.raised, borderColor: t.border.subtle },
      ]}
      role="region"
      aria-label="Board notes"
      testID="notes-panel"
    >
      <Row style={styles.head}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[type.heading, styles.title, { color: t.text.primary }]}
        >
          Board notes
        </Text>
        {editing || !notes.data ? null : (
          <>
            <IconAction icon="edit" label="Edit notes" onPress={() => setEditing(true)} />
            <IconAction
              icon="history"
              label="Notes history"
              onPress={() => nav.push({ name: 'boardNotesHistory', boardId })}
            />
          </>
        )}
        <IconAction icon="close" label="Close notes" onPress={onClose} />
      </Row>
      <ScrollView style={styles.fill} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {notes.status === 'loading' ? (
          <Spinner label="Loading notes…" />
        ) : notes.status === 'error' || !notes.data ? (
          <LoadError what="these notes" code={notes.error} />
        ) : editing ? (
          <NotesEditor
            boardId={boardId}
            notes={notes.data}
            user={user}
            otherName={nameOf}
            onClosed={() => setEditing(false)}
            autoFocus
          />
        ) : (
          <>
            <NotesStamp notes={notes.data} latest={latest} members={members} />
            <NotesBody notes={notes.data} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flexShrink: 0,
    alignSelf: 'stretch',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    marginRight: space.md,
    // Level with the columns, which keep this much below their last card.
    marginBottom: space.lg,
  },
  head: { alignItems: 'center', gap: space.xs },
  title: { flex: 1, minWidth: 0 },
  fill: { flex: 1 },
  body: { gap: space.sm, paddingBottom: space.md },
});
