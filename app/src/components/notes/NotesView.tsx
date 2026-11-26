import { Text } from 'react-native';
import { hasNotes, lastEditor, type BoardNotes, type NotesVersion } from '../../boardNotes';
import { when } from '../../activityTime';
import { ActivityActor } from '../ActivityActor';
import { RichText } from '../RichText';
import { Hint } from '../ui';

type Members = readonly { uid: string; displayName: string }[];

/**
 * "Edited by Sara · 2h ago": who last saved the notes and when, so a page
 * gone stale shows it, and whom to ask is plain.
 */
export function NotesStamp({
  notes,
  latest,
  members,
}: {
  notes: BoardNotes;
  latest: NotesVersion | null | undefined;
  members: Members;
}) {
  if (!hasNotes(notes)) return null;
  const by = lastEditor(notes, latest, members);
  return (
    <Hint>
      <Text>Edited by </Text>
      <ActivityActor name={by.name} via={by.via} />
      {by.at ? <Text>{` · ${when(by.at)}`}</Text> : null}
    </Hint>
  );
}

/** The notes as everyone reads them, or what to put there when there are none. */
export function NotesBody({ notes }: { notes: BoardNotes }) {
  if (!hasNotes(notes)) {
    return (
      <Hint>
        No notes yet. Keep the links, forms and how-tos everyone on this board needs here.
      </Hint>
    );
  }
  return <RichText markdown={notes.text} />;
}
