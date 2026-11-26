import { useState } from 'react';
import { BOARD_NAME_MAX } from '@sabeel/shared';
import { Sheet } from './Sheet';
import { NewCardBell } from './board/Bells';
import { Body, Button, Hint, Row, TextField } from './ui';

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
 *
 * The bell subscribes the cloner to every cloned card, as a new card's bell
 * does to one, but starts OFF (Faisal, 2026-11-14): a template can hold
 * hundreds of cards, and each would tell them of every change made to it.
 * It holds still once Clone has been pressed. A try whose answer was lost may
 * have made the clone, and a retry returns that board as it was made: a name
 * changed since is put right afterwards (`BoardsScreen`), but who follows its
 * cards is not, so the bell must not show a choice the clone did not get.
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
  onClone: (name: string, subscribe: boolean) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(boardName);
  const [subscribe, setSubscribe] = useState(false);
  // Pressed once in this offer: the bell holds from here (above).
  const [tried, setTried] = useState(false);
  const ready = name.trim().length > 0 && name.trim() !== boardName.trim() && !busy;
  const clone = () => {
    setTried(true);
    onClone(name, subscribe);
  };
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
          if (ready) clone();
        }}
      />
      {/* Clone right under the field it acts on, the explanation after it. */}
      <Row>
        <Button label="Clone" busy={busy} disabled={!ready} onPress={clone} />
        <NewCardBell
          on={subscribe}
          onToggle={() => setSubscribe((on) => !on)}
          label="Subscribe to every card"
          disabled={tried}
        />
      </Row>
      {error ? <Body>{error}</Body> : null}
      <Hint>
        The clone gets this board&rsquo;s columns, its lanes, its colour, its notes and its
        details&rsquo; fields (empty), and its open cards, each in the column it is in now,
        with their descriptions, subtasks and lanes; you are its only member. Due dates,
        assignees, priorities, comments, attachments, archived cards and this
        board&rsquo;s own labels stay behind. Turn on the bell to subscribe to
        every card in the clone.
      </Hint>
    </Sheet>
  );
}
