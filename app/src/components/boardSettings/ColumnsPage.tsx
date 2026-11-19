import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  columnDeleteBlocked,
  columnsPatch,
  finishedColumnDeleteNote,
  localId,
  validateColumnName,
  type BoardColumn,
} from '@sabeel/shared';
import { updateBoard, type BoardListItem } from '../../boards';
import { cardsInColumn, useBoardCards } from '../../cards';
import { confirmAction, noticeAction } from '../../confirm';
import { useAction } from '../../useAction';
import { space } from '../../theme';
import { ColumnNameEditor } from '../ColumnNameEditor';
import { ReorderList } from '../ReorderList';
import { Body, Card, Hint, IconAction, Row, TextField } from '../ui';

/**
 * Board settings → Columns: rename, reorder, add and delete. Owners and admins
 * only. The only place a column is renamed or deleted: the board's column
 * headings carry the name, the count and the bell, nothing that edits.
 */
export function ColumnsPage({ board }: { board: BoardListItem }) {
  const { run, busy, error, setError } = useAction('boardSettings');
  // For "is this column empty", which deleting one asks. The board's open
  // cards, the same query the board itself uses. Delete waits for them: "no
  // cards" while they load, or after the read failed, would let a full column go.
  const cards = useBoardCards(board.id);
  // Which column is mid-rename: its delete steps aside, so the field keeps the
  // row at 320px and the bin is never beside the rename's cancel.
  const [renaming, setRenaming] = useState<string | null>(null);
  // The board and its cards as they are NOW: a confirmation is a wait, and
  // another owner may add a column or a card meanwhile. The delete writes
  // from these, never from what the tap saw.
  const live = useRef({ board, cards: cards.data });
  live.current = { board, cards: cards.data };

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
    return run(() => updateBoard(board.id, columnsPatch(board, next)));
  }

  /** Refused while the column holds cards; otherwise asks, since it cannot be undone. */
  async function askRemove(col: BoardColumn, columnCards: number) {
    const blocked = columnDeleteBlocked(col.name, columnCards);
    if (blocked) {
      await noticeAction('Cannot delete this column', blocked);
      return;
    }
    const ok = await confirmAction(
      `Delete “${col.name}”?`,
      ['The column is empty, but deleting it cannot be undone.', finishedColumnDeleteNote(board, col.id)]
        .filter(Boolean)
        .join(' '),
    );
    if (!ok) return;
    const now = live.current;
    // Filled while the question was open: refused, as it would have been.
    const nowBlocked = columnDeleteBlocked(col.name, cardsInColumn(now.cards ?? [], col.id).length);
    if (nowBlocked || !now.cards) {
      await noticeAction('Cannot delete this column', nowBlocked ?? 'The board’s cards could not be read.');
      return;
    }
    await run(() =>
      updateBoard(
        now.board.id,
        columnsPatch(now.board, now.board.columns.filter((c) => c.id !== col.id)),
      ),
    );
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
            on the pencil or the bin cannot start a reorder. */}
        <ReorderList
          items={board.columns}
          keyOf={(c) => c.id}
          renderItem={(c) => (
            <Row style={styles.between}>
              <View style={styles.grow}>
                <ColumnNameEditor
                  column={c}
                  columns={board.columns}
                  canEdit
                  busy={busy}
                  onError={setError}
                  onEditingChange={(on) => setRenaming(on ? c.id : null)}
                  onRename={(next) => updateBoard(board.id, columnsPatch(board, next))}
                  run={run}
                />
              </View>
              {renaming !== c.id ? (
                <IconAction
                  icon="delete-outline"
                  danger
                  label={`Delete column ${c.name}`}
                  disabled={busy || cards.status !== 'ready'}
                  onPress={() => {
                    if (cards.status === 'ready') {
                      void askRemove(c, cardsInColumn(cards.data, c.id).length);
                    }
                  }}
                />
              ) : null}
            </Row>
          )}
          onReorder={(next) => run(() => updateBoard(board.id, columnsPatch(board, next)))}
        />
        {cards.status === 'error' ? (
          <Hint>
            This board’s cards could not be counted, so no column can be deleted
            right now.
          </Hint>
        ) : null}
        <Hint>
          A column is deleted only once it is empty — so no cards can vanish
          with it.
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
  between: { justifyContent: 'space-between', alignItems: 'center', gap: space.xs },
  grow: { flex: 1, gap: space.xs, minWidth: 0 },
  /** A tight gap: IconAction is a laid-out 44pt box, not slop. */
  addRow: { alignItems: 'center', gap: space.xs },
});
