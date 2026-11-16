import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { columnsPatch, localId, validateColumnName, type BoardColumn } from '@sabeel/shared';
import { updateBoard, type BoardListItem } from '../../boards';
import { useAction } from '../../useAction';
import { space } from '../../theme';
import { ColumnNameEditor } from '../ColumnNameEditor';
import { ReorderList } from '../ReorderList';
import { Body, Card, Hint, IconAction, Row, TextField } from '../ui';

/** Board settings → Columns: rename, reorder and add. Owners and admins only. */
export function ColumnsPage({ board }: { board: BoardListItem }) {
  const { run, busy, error, setError } = useAction('boardSettings');

  // Returns whether the column was ADDED, so the row knows whether to clear
  // itself: a name refused here or by the rules stays in the field.
  async function addColumn(name: string): Promise<boolean> {
    const problem = validateColumnName(name, board.columns);
    if (problem) {
      setError(problem);
      return false;
    }
    const next: BoardColumn[] = [...board.columns, { id: localId('col'), name: name.trim() }];
    // columnsPatch, never a bare `columns` write: rules validate card writes
    // against the flat `columnIds` mirror, so a desynced pair means cards cannot
    // be created in the new column at all — with a bare PERMISSION_DENIED as the
    // only clue.
    return run(() => updateBoard(board.id, columnsPatch(next)));
  }

  return (
    <>
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}
      <Card>
        {/* Drag the handle to reorder. One document write per drop
            (columnsPatch keeps columns/columnIds in sync — never a bare
            `columns` write, or card rules reject the new column). */}
        {/* The name is editable in place. Dragging is the handle's job, so a tap
            on the pencil cannot start a reorder. */}
        <ReorderList
          items={board.columns}
          keyOf={(c) => c.id}
          renderItem={(c) => (
            <ColumnNameEditor
              column={c}
              columns={board.columns}
              canEdit
              busy={busy}
              onError={setError}
              onRename={(next) => updateBoard(board.id, columnsPatch(next))}
              run={run}
            />
          )}
          onReorder={(next) => run(() => updateBoard(board.id, columnsPatch(next)))}
        />
        <Hint>
          Columns are removed from the board screen, and only once they are
          empty — so no cards can vanish with them.
        </Hint>
        <AddColumnRow busy={busy} onAdd={addColumn} />
      </Card>
    </>
  );
}

/**
 * The new-column row, owning its draft.
 *
 * Typing a column name re-rendered every column and the ReorderList on each
 * character when the draft lived on the screen, for a field that nothing else
 * reads.
 *
 * Unmount-scoped in spirit but long-lived in practice — this row is always on
 * the page — so it clears itself on a successful add.
 */
function AddColumnRow({
  busy,
  onAdd,
}: {
  busy: boolean;
  /** Whether the column was written; false leaves the name in the field. */
  onAdd: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');

  async function submit() {
    // Cleared only if it was accepted. A rejected name stays in the field —
    // retyping it to be told again which word was the problem is worse than
    // the duplicate.
    if (await onAdd(name)) setName('');
  }

  return (
    <Row style={styles.addRow}>
      <View style={styles.grow}>
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="New column name"
          onSubmit={submit}
        />
      </View>
      <IconAction
        icon="add"
        label="Add column"
        accent
        onPress={submit}
        disabled={busy || !name.trim()}
      />
    </Row>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: space.xs },
  /** A tight gap: IconAction is a laid-out 44pt box, not slop. */
  addRow: { alignItems: 'center', gap: space.xs },
});
