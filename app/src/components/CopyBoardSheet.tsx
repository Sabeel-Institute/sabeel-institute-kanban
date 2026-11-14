import { useState } from 'react';
import { BOARD_NAME_MAX } from '@sabeel/shared';
import { Sheet } from './Sheet';
import { Body, Button, Hint, TextField } from './ui';

/**
 * Copying a board, opened by a long-press (or a right-click) on its row in the
 * boards list. `copyBoard` in functions/src/boards.ts makes the copy; what it
 * holds is `boardCopy` in @sabeel/shared, which the hint below says in words.
 *
 * MOUNTED ONLY WHILE OPEN, so the name is scoped to one try, like the New
 * board form. It starts as the board's own name, since a template's copy is
 * named after it, and Copy waits until it differs: two boards under one name
 * is a list nobody can tell apart.
 */
export function CopyBoardSheet({
  boardName,
  busy,
  error,
  onCopy,
  onClose,
}: {
  boardName: string;
  busy: boolean;
  /** Why the last try failed, shown in the sheet: it covers the screen's own. */
  error: string | null;
  onCopy: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(boardName);
  const ready = name.trim().length > 0 && name.trim() !== boardName.trim() && !busy;
  return (
    <Sheet visible title={`Copy ${boardName}`} onClose={onClose}>
      <TextField
        label="Name of the copy"
        value={name}
        onChangeText={setName}
        placeholder="Board name"
        autoFocus
        maxLength={BOARD_NAME_MAX}
        enterKeyHint="go"
        // Return as well as the button, and `ready` holds both while a copy is
        // on its way: a second Return would make a second copy.
        onSubmit={() => {
          if (ready) onCopy(name);
        }}
      />
      <Hint>
        The copy gets this board&rsquo;s columns and its open cards, with their
        descriptions and subtasks, and you are its only member. Due dates,
        assignees, priorities, comments, attachments, archived cards and this
        board&rsquo;s own labels stay behind.
      </Hint>
      {error ? <Body>{error}</Body> : null}
      <Button label="Copy" busy={busy} disabled={!ready} onPress={() => onCopy(name)} />
    </Sheet>
  );
}
