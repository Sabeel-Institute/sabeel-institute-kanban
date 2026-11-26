import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BOARD_NOTES_MAX, normalizeMarkdown, storedLength } from '@sabeel/shared';
import { NotesConflict, saveBoardNotes, type BoardNotes } from '../../boardNotes';
import type { SessionUser } from '../../session';
import { useAction } from '../../useAction';
import { radius, space, useTheme } from '../../theme';
import { RichEditor } from '../RichEditor';
import { Body, Button, Hint, Row } from '../ui';

/**
 * The notes being edited, and the DRAFT OF THEM.
 *
 * Mounted only while editing, so the draft and the version it started from
 * are seeded once and the unmount is the reset (the `AddCardForm` shape in
 * CLAUDE.md): a reseeding effect here would pour a colleague's save over
 * what is being typed, which is the conflict this editor exists to show.
 *
 * Closes only once the save LANDS (`onClosed` inside the `run`). A save over
 * a version someone else saved meanwhile is refused by the rules; the editor
 * then keeps the text and says whose save came first. "Save mine" saves on
 * top of theirs, which stays in the history; "Discard mine" closes onto
 * theirs.
 */
export function NotesEditor({
  boardId,
  notes,
  user,
  otherName,
  onClosed,
  autoFocus,
}: {
  boardId: string;
  /** The page as it stood when editing began. */
  notes: BoardNotes;
  user: SessionUser;
  /** Who a conflicting save came from, by uid. */
  otherName: (uid: string | undefined) => string;
  onClosed: () => void;
  autoFocus?: boolean;
}) {
  const t = useTheme();
  // The page as editing began, kept: the parent passes the live page, and a
  // colleague's save arriving meanwhile must neither count as this editor's
  // change nor become its starting point.
  const [seed] = useState(notes);
  const [draft, setDraft] = useState(seed.text);
  const [base, setBase] = useState(seed.version);
  const [conflict, setConflict] = useState<BoardNotes | null>(null);
  const { run, busy, error } = useAction('boardNotes');

  const length = storedLength(draft);
  const over = length > BOARD_NOTES_MAX;

  const save = (from: number) => {
    return run(async () => {
      // Nothing to write: closing is the whole of it.
      if (normalizeMarkdown(draft) === normalizeMarkdown(seed.text) && from === seed.version) {
        onClosed();
        return;
      }
      try {
        await saveBoardNotes(boardId, draft, from, user);
      } catch (e) {
        if (e instanceof NotesConflict) {
          setConflict(e.theirs);
          return;
        }
        throw e;
      }
      onClosed();
    });
  };

  return (
    <View style={styles.wrap}>
      {conflict ? (
        <View
          style={[styles.notice, { backgroundColor: t.bg.raised, borderColor: t.border.strong, borderLeftColor: t.accent.base }]}
          accessibilityRole="alert"
        >
          <Body>
            {otherName(conflict.updatedBy)} saved the notes while you were editing. Your text is
            still here.
          </Body>
          <Hint>Saving yours keeps theirs in the notes history.</Hint>
          <Row style={styles.wrapRow}>
            <Button
              label="Save mine"
              busy={busy}
              disabled={over}
              onPress={() => {
                const theirs = conflict.version;
                setBase(theirs);
                setConflict(null);
                void save(theirs);
              }}
            />
            <Button label="Discard mine" variant="secondary" onPress={onClosed} />
          </Row>
        </View>
      ) : null}
      <RichEditor
        initialMarkdown={seed.text}
        onChangeMarkdown={setDraft}
        placeholder="Links, forms and how-tos for everyone on this board"
        autoFocus={autoFocus}
        minHeight={220}
        testID="notes-editor"
      />
      {over ? (
        <Hint>
          {length - BOARD_NOTES_MAX} characters over the {BOARD_NOTES_MAX} limit. Shorten the notes
          to save.
        </Hint>
      ) : length > BOARD_NOTES_MAX * 0.9 ? (
        <Hint>{BOARD_NOTES_MAX - length} characters left.</Hint>
      ) : null}
      {error ? <Body>{error}</Body> : null}
      {conflict ? null : (
        <Row style={styles.wrapRow}>
          <Button label="Save" busy={busy} disabled={over} onPress={() => void save(base)} />
          <Button label="Cancel" variant="secondary" onPress={onClosed} />
        </Row>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  wrapRow: { flexWrap: 'wrap' },
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 4,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
});
