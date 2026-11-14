import { useState } from 'react';
import { BOARD_NAME_MAX } from '@sabeel/shared';
import { Sheet } from './Sheet';
import { Body, Button, Hint, TextField } from './ui';

/**
 * Cloning a board, opened by a long-press (or a right-click) on its row in the
 * boards list. `cloneBoard` in functions/src/boards.ts makes the clone; what it
 * holds is `boardClone` in @sabeel/shared, which the hint below says in words.
 *
 * MOUNTED ONLY WHILE OPEN, so the name is scoped to one try, like the New
 * board form. It cannot be closed while a clone is on its way (`Sheet`'s
 * `busy`): the clone cannot be called back, and it opens when it lands.
 *
 * The name starts as the board's own, since a template's clone is named after
 * it, and Clone waits until it differs: two boards under one name is a list
 * nobody can tell apart.
 */
export function CloneBoardSheet({
  boardName,
  busy,
  error,
  onClone,
  onClose,
}: {
  boardName: string;
  busy: boolean;
  /** Why the last try failed, shown in the sheet: it covers the screen's own. */
  error: string | null;
  onClone: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(boardName);
  const ready = name.trim().length > 0 && name.trim() !== boardName.trim() && !busy;
  return (
    <Sheet visible title={`Clone ${boardName}`} onClose={onClose} busy={busy}>
      <TextField
        label="Name of the clone"
        value={name}
        onChangeText={setName}
        placeholder="Board name"
        autoFocus
        maxLength={BOARD_NAME_MAX}
        enterKeyHint="go"
        // Return as well as the button, and `ready` holds both while a clone is
        // on its way: a second Return would make a second clone.
        onSubmit={() => {
          if (ready) onClone(name);
        }}
      />
      {/* Clone right under the field, the explanation after it: on Android the
          keyboard does not push a sheet up (edge-to-edge leaves the dialog
          window unresized), so whatever sits low in it is under the keys. */}
      <Button label="Clone" busy={busy} disabled={!ready} onPress={() => onClone(name)} />
      {error ? <Body>{error}</Body> : null}
      <Hint>
        The clone gets this board&rsquo;s columns and its open cards, with their
        descriptions and subtasks, and you are its only member. Due dates,
        assignees, priorities, comments, attachments, archived cards and this
        board&rsquo;s own labels stay behind.
      </Hint>
    </Sheet>
  );
}
