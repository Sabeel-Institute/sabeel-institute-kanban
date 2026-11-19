import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  BOARD_FIELD_NAME_MAX,
  COLUMN_NAME_MAX,
  LANE_NAME_MAX,
  renameColumn,
  renameField,
  renameLane,
  type BoardColumn,
  type BoardField,
  type BoardLane,
} from '@sabeel/shared';
import { IconAction, Row, TextField } from './ui';
import { space, type, useTheme } from '../theme';

type Named = { id: string; name: string };
type RenameResult<T> = { ok: true; items: T[] } | { ok: false; error: string };

/** What every caller passes, whichever kind of name it is. */
type EditorProps = {
  canEdit: boolean;
  busy?: boolean;
  /** The caller's `useAction` runner, so a failed rename reports in the same
   *  banner as every other failure on that screen. */
  run: (fn: () => Promise<unknown>) => void;
  onError: (message: string) => void;
  /**
   * Lets a row make room while editing: Board settings → Columns hides the
   * column's delete, so the field keeps the row and the bin never sits beside
   * the rename's cancel.
   */
  onEditingChange?: (editing: boolean) => void;
};

/**
 * A column's name, renamed in place, in Board settings → Columns.
 *
 * The board's own column headings are read-only (`ColumnHeading`); a column is
 * renamed and deleted on the settings page. Lanes and fields share the editor,
 * so this is ONE component rather than copies of the same edit state. That
 * matters more than it looks: the validation
 * has a trap in it (a column must be excluded from its own duplicate check, or
 * re-saving its name — or just fixing its capitalisation — is rejected), which is
 * why the rule itself lives in `renameColumn` in @sabeel/shared and is
 * unit-tested there.
 *
 * Renaming a column is a board write, so it is board-owner/admin only, exactly like
 * adding and removing them. Callers pass `canEdit`; a member simply sees the name.
 *
 * The write is the caller's: each surface already has its own `useAction` `run`
 * for busy/error, and reusing it keeps a failed rename reporting in the same
 * place as every other failure on that screen.
 */
export function ColumnNameEditor({
  column,
  columns,
  onRename,
  ...rest
}: EditorProps & {
  column: BoardColumn;
  /** The whole list — needed to reject a name another column already has. */
  columns: readonly BoardColumn[];
  /**
   * The write itself, and it must REJECT if the write fails — that rejection is
   * what keeps the field open. Do not wrap it in the caller's `run`; pass `run`
   * separately, or a failure resolves quietly and the draft is discarded.
   */
  onRename: (columns: BoardColumn[]) => Promise<unknown>;
}) {
  return (
    <ItemNameEditor
      {...rest}
      item={column}
      noun="column"
      maxLength={COLUMN_NAME_MAX}
      rename={(name) => {
        const r = renameColumn(columns, column.id, name);
        return r.ok ? { ok: true, items: r.columns } : r;
      }}
      onRename={onRename}
    />
  );
}

/** A lane's name, renamed in place: the same editor as a column's, under the lane's rules. */
export function LaneNameEditor({
  lane,
  lanes,
  onRename,
  ...rest
}: EditorProps & {
  lane: BoardLane;
  /** The whole list — needed to reject a name another lane already has. */
  lanes: readonly BoardLane[];
  /** The write; it must REJECT on failure, as `ColumnNameEditor`'s does. */
  onRename: (lanes: BoardLane[]) => Promise<unknown>;
}) {
  return (
    <ItemNameEditor
      {...rest}
      item={lane}
      noun="lane"
      maxLength={LANE_NAME_MAX}
      rename={(name) => {
        const r = renameLane(lanes, lane.id, name);
        return r.ok ? { ok: true, items: r.lanes } : r;
      }}
      onRename={onRename}
    />
  );
}

/** A detail's field name, renamed in place: the same editor, under the field's rules. */
export function FieldNameEditor({
  field,
  fields,
  onRename,
  ...rest
}: EditorProps & {
  field: BoardField;
  fields: readonly BoardField[];
  /** The write; it must REJECT on failure, as `ColumnNameEditor`'s does. */
  onRename: (fields: BoardField[]) => Promise<unknown>;
}) {
  return (
    <ItemNameEditor
      {...rest}
      item={field}
      noun="field"
      maxLength={BOARD_FIELD_NAME_MAX}
      rename={(name) => {
        const r = renameField(fields, field.id, name);
        return r.ok ? { ok: true, items: r.fields } : r;
      }}
      onRename={onRename}
    />
  );
}

function ItemNameEditor<T extends Named>({
  item,
  noun,
  maxLength,
  rename,
  onRename,
  canEdit,
  busy,
  run,
  onError,
  onEditingChange,
}: EditorProps & {
  item: T;
  /** Says what is renamed, in every label: "Rename column To Do". */
  noun: 'column' | 'lane' | 'field';
  maxLength: number;
  /** The shared rule: the renamed list, or why not. */
  rename: (name: string) => RenameResult<T>;
  onRename: (items: T[]) => Promise<unknown>;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;

  function begin() {
    setDraft(item.name);
    onEditingChange?.(true);
  }

  function close() {
    setDraft(null);
    onEditingChange?.(false);
  }

  // CLOSES ONLY ONCE THE WRITE LANDS.
  //
  // It used to close first and hand the write up afterwards, so a rename that
  // failed on the network took your text with it and left an error banner
  // pointing at a name you could no longer see. `run` reports the failure and
  // the throw never reaches `close()`, so the field stays open with the draft
  // intact — the same commit timing `saveLabelName` in board settings has
  // always had. One rule for both, rather than a note explaining why two
  // editors one screen apart behave differently.
  function commit() {
    const result = rename(draft ?? '');
    if (!result.ok) {
      onError(result.error);
      return;
    }
    run(async () => {
      await onRename(result.items);
      close();
    });
  }

  if (editing) {
    return (
      <Row style={styles.editRow}>
        <View style={styles.grow}>
          <TextField
            value={draft}
            onChangeText={setDraft}
            onSubmit={commit}
            autoFocus
            label={`Rename ${item.name}`}
            maxLength={maxLength}
          />
        </View>
        {/* Save is the affirmative and is tinted; cancel stays quiet. Two muted
            18px glyphs side by side were reported as indistinguishable on a real
            phone — shape alone is not enough to tell them apart in a hurry. */}
        <IconAction
          icon="check"
          label={`Save ${noun} name`}
          onPress={commit}
          accent
          disabled={busy}
        />
        <IconAction
          icon="close"
          label="Cancel rename"
          onPress={close}
          disabled={busy}
        />
      </Row>
    );
  }

  return (
    <Row style={styles.nameRow}>
      {/* `shrink` is not optional. Without it Yoga measures the name against the
          whole row and then lays it out NEXT TO the edit icon, so the row is
          wider than its parent. A View clips on web but not on Android, where a
          long name paints over its neighbour. It shrinks, then truncates. */}
      <Text
        numberOfLines={1}
        style={[type.body, { color: t.text.secondary }, styles.shrink]}
      >
        {item.name}
      </Text>
      {canEdit ? (
        <IconAction
          icon="edit"
          label={`Rename ${noun} ${item.name}`}
          onPress={begin}
          disabled={busy}
        />
      ) : null}
    </Row>
  );
}

const styles = StyleSheet.create({
  /*
   * `flexShrink: 1` is not optional either. react-native-web's View base style
   * sets flex-shrink to 0, so this row sizes to its content and OVERFLOWS its
   * parent rather than letting the name truncate — which pushed the rename
   * pencil 15px past the right edge of a 320px screen in Board settings, for a
   * column whose name was merely long. The Text's own `shrink` cannot help
   * while the row around it refuses to give.
   */
  nameRow: { alignItems: 'center', gap: space.xs, flexShrink: 1, minWidth: 0 },
  editRow: { alignItems: 'center', gap: space.xs, flex: 1 },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
});
