import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  LANE_NAME_MAX,
  cardsInLane,
  finishedColumnChoice,
  laneAddBlocked,
  laneDeleteBlocked,
  lanesSwitchPatch,
  localId,
  validateLaneName,
  type BoardLane,
} from '@sabeel/shared';
import { updateBoard, type BoardListItem } from '../../boards';
import { useBoardCards } from '../../cards';
import { confirmAction } from '../../confirm';
import { space } from '../../theme';
import { useAction } from '../../useAction';
import { LaneNameEditor } from '../ColumnNameEditor';
import { ReorderList } from '../ReorderList';
import { Select } from '../Select';
import { Body, Card, Hint, IconAction, Row, TextField, Toggle } from '../ui';

/**
 * Board settings → Lanes: the switch, the lanes, and where finished cards are.
 * Owners and admins only, like every other setting of the board.
 *
 * Switching lanes off keeps them, and every card's lane, so switching them on
 * again restores the board. With the switch off the board is drawn exactly as
 * it was before lanes existed, so this page says so and shows nothing else.
 */
export function LanesPage({ board }: { board: BoardListItem }) {
  const { run, busy, error, setError } = useAction('boardSettings');
  // For "is this lane empty", which removing one asks. The board's open cards,
  // the same query the board itself uses.
  const cards = useBoardCards(board.id);
  const lanes = board.lanes;
  const finished = finishedColumnChoice(board);

  // Returns whether the lane was ADDED, so the row clears itself only then:
  // a name refused here or by the rules stays in the field.
  async function addLane(name: string): Promise<boolean> {
    const problem = laneAddBlocked(lanes) ?? validateLaneName(name, lanes);
    if (problem) {
      setError(problem);
      return false;
    }
    const next: BoardLane[] = [...lanes, { id: localId('ln'), name: name.trim() }];
    return run(() => updateBoard(board.id, { lanes: next }));
  }

  function askRemove(lane: BoardLane) {
    void (async () => {
      // Counted only once the cards are known: "no cards" while they load would
      // let a full lane go.
      if (cards.status !== 'ready') {
        setError('Still counting this lane’s cards. Try again in a moment.');
        return;
      }
      const blocked = laneDeleteBlocked(lane.name, cardsInLane(cards.data ?? [], lane.id));
      if (blocked) {
        await confirmAction('Cannot remove this lane', blocked);
        return;
      }
      const ok = await confirmAction(`Remove “${lane.name}”?`, 'The lane is empty, but removing it cannot be undone.');
      if (!ok) return;
      await run(() => updateBoard(board.id, { lanes: lanes.filter((l) => l.id !== lane.id) }));
    })();
  }

  return (
    <>
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      <Card>
        <Row style={styles.between}>
          <View style={styles.grow}>
            <Body>Lanes on this board</Body>
          </View>
          <Toggle
            value={board.lanesOn}
            disabled={busy}
            label="Lanes on this board"
            onValueChange={(on) => run(() => updateBoard(board.id, lanesSwitchPatch(board, on)))}
          />
        </Row>
        <Hint>
          {board.lanesOn
            ? 'Columns run across the board and lanes run down it. A card sits in one of each.'
            : `Off. The board is drawn as it always has been.${
                lanes.length > 0
                  ? ` Its ${lanes.length === 1 ? 'lane is' : `${lanes.length} lanes are`} kept for when you switch back.`
                  : ''
              }`}
        </Hint>
      </Card>

      {board.lanesOn ? (
        <>
          <Card>
            {lanes.length === 0 ? <Hint>No lanes yet. Add the first below.</Hint> : null}
            <ReorderList
              items={lanes}
              keyOf={(l) => l.id}
              renderItem={(l) => (
                <Row style={styles.between}>
                  <View style={styles.grow}>
                    <LaneNameEditor
                      lane={l}
                      lanes={lanes}
                      canEdit
                      busy={busy}
                      onError={setError}
                      onRename={(next) => updateBoard(board.id, { lanes: next })}
                      run={run}
                    />
                  </View>
                  <IconAction
                    icon="delete-outline"
                    danger
                    label={`Remove lane ${l.name}`}
                    disabled={busy}
                    onPress={() => askRemove(l)}
                  />
                </Row>
              )}
              onReorder={(next) => run(() => updateBoard(board.id, { lanes: next }))}
            />
            <Hint>
              Drag a lane by its handle to reorder it. A lane is removed only once
              it is empty. Cards from before lanes sit under No lane until someone
              places them.
            </Hint>
            {laneAddBlocked(lanes) ? (
              <Hint>{laneAddBlocked(lanes)}</Hint>
            ) : (
              <AddLaneRow busy={busy} onAdd={addLane} />
            )}
          </Card>

          <Card>
            <Body>Finished cards are in</Body>
            {finished ? (
              <Select
                label="Finished cards are in"
                value={finished}
                options={board.columns.map((c) => ({ value: c.id, label: c.name }))}
                disabled={busy}
                onChange={(id) => run(() => updateBoard(board.id, { doneColumnId: id }))}
              />
            ) : (
              <Hint>The board has no columns yet.</Hint>
            )}
            <Hint>
              A lane’s badge counts the cards in this column as finished, and they
              stop showing as late.
            </Hint>
          </Card>
        </>
      ) : null}
    </>
  );
}

/** The new-lane row, owning its draft, as `AddColumnRow` does. */
function AddLaneRow({
  busy,
  onAdd,
}: {
  busy: boolean;
  /** Resolves true once the lane is accepted. */
  onAdd: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');

  async function submit() {
    if (await onAdd(name)) setName('');
  }

  return (
    <Row style={styles.addRow}>
      <View style={styles.grow}>
        <TextField
          value={name}
          onChangeText={setName}
          placeholder="New lane name"
          maxLength={LANE_NAME_MAX}
          onSubmit={submit}
        />
      </View>
      <IconAction
        icon="add"
        label="Add lane"
        accent
        onPress={submit}
        disabled={busy || !name.trim()}
      />
    </Row>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  /** A tight gap: IconAction is a laid-out 44pt box, not slop. */
  addRow: { alignItems: 'center', gap: space.xs },
});
