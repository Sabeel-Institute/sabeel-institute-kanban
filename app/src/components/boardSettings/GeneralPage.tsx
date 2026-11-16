import { useState } from 'react';
import { BOARD_NAME_MAX, validateBoardName } from '@sabeel/shared';
import { updateBoard, type BoardListItem } from '../../boards';
import { useNav } from '../../nav';
import { useAction } from '../../useAction';
import { Body, Button, Card, Heading, TextField } from '../ui';

/** Board settings → General: the board's name, and archiving it. Owners and admins only. */
export function GeneralPage({ board }: { board: BoardListItem }) {
  const nav = useNav();
  const { run, busy, error, setError } = useAction('boardSettings');

  async function renameBoard(name: string) {
    const problem = validateBoardName(name);
    if (problem) {
      setError(problem);
      return;
    }
    await run(() => updateBoard(board.id, { name: name.trim() }));
  }

  return (
    <>
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      <Heading>Name</Heading>
      <Card>
        <BoardNameEditor initial={board.name} onSave={renameBoard} />
      </Card>

      <Heading>Archive</Heading>
      <Card>
        <Body>
          Archiving hides the board from everyone&rsquo;s list. Boards are
          never permanently deleted — too much work accumulates in them.
        </Body>
        <Button
          busy={busy}
          label={board.archived ? 'Restore board' : 'Archive board'}
          variant={board.archived ? 'primary' : 'danger'}
          onPress={() =>
            run(async () => {
              await updateBoard(board.id, { archived: !board.archived });
              if (!board.archived) nav.reset({ name: 'boards' });
            })
          }
        />
      </Card>
    </>
  );
}

function BoardNameEditor({
  initial,
  onSave,
}: {
  initial: string;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <>
      <TextField
        value={name}
        onChangeText={setName}
        placeholder="Board name"
        maxLength={BOARD_NAME_MAX}
      />
      <Button
        label="Save name"
        onPress={() => onSave(name)}
        disabled={name.trim() === initial}
      />
    </>
  );
}
