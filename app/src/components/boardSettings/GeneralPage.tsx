import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BOARD_NAME_MAX, validateBoardName } from '@sabeel/shared';
import { updateBoard, type BoardListItem } from '../../boards';
import { useNav } from '../../nav';
import { useAction } from '../../useAction';
import { Body, Button, Card, Heading, Hint, Row, TextField, Toggle } from '../ui';

/**
 * Board settings → General: the board's name, its template mark, and archiving
 * it. Owners and admins only.
 */
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

      <Card>
        <Row style={styles.between}>
          <View style={styles.grow}>
            <Body>This board is a template</Body>
          </View>
          <Toggle
            value={board.template}
            disabled={busy}
            label="This board is a template"
            onValueChange={(on) => run(() => updateBoard(board.id, { template: on }))}
          />
        </Row>
        {/* Everything the mark does, said where it is set. */}
        <Hint>
          {board.template
            ? 'Listed under Templates in the Boards list, for people to clone, and left out of the overview. It can be cloned like any board, and a clone is not a template.'
            : 'A board people clone to start their own. Marked, it is listed under Templates in the Boards list and left out of the overview.'}
        </Hint>
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

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
});
