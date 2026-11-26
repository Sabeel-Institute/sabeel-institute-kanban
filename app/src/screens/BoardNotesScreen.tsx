import { StyleSheet } from 'react-native';
import { useBoard } from '../boards';
import { useBoardNotes } from '../boardNotes';
import { useNav } from '../nav';
import type { SessionUser } from '../session';
import { NotesEditor } from '../components/notes/NotesEditor';
import { IconAction, LoadError, Row, Screen, Spinner, Title } from '../components/ui';

/**
 * A board's notes, being edited, on a screen of their own.
 *
 * The phone's way to edit them: the keyboard and the toolbar need the whole
 * screen, and inside the board's pager a sideways drag would fight a text
 * selection. A wide screen edits in the panel beside the board instead.
 * Saving or cancelling goes back to the board; Back leaves without saving,
 * as it does from a card's description.
 */
export function BoardNotesScreen({ boardId, user }: { boardId: string; user: SessionUser }) {
  const nav = useNav();
  const board = useBoard(boardId);
  const notes = useBoardNotes(boardId);
  const members = board.data?.members ?? [];

  return (
    <Screen width="read">
      <Row style={styles.between}>
        <Title numberOfLines={1} style={styles.title}>
          Board notes
        </Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>
      {notes.status === 'loading' ? (
        <Spinner label="Loading notes…" />
      ) : notes.status === 'error' || !notes.data ? (
        <LoadError what="these notes" code={notes.error} />
      ) : (
        <NotesEditor
          boardId={boardId}
          notes={notes.data}
          user={user}
          otherName={(uid) => members.find((m) => m.uid === uid)?.displayName ?? 'Someone'}
          onClosed={nav.pop}
          autoFocus
          actionsFirst
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
  title: { flexShrink: 1 },
});
