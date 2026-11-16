import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BOARD_FIELD_NAME_MAX,
  DETAIL_LINK_MAX,
  DETAIL_VALUE_MAX,
  FIELD_TYPE_LABELS,
  addField,
  addableFieldTypes,
  fieldAddBlocked,
  isDateType,
  isNamedType,
  safeLink,
  shortDay,
  todayInOrgTz,
  validateDetailValue,
  type BoardField,
  type BoardFieldType,
} from '@sabeel/shared';
import {
  removeBoardField,
  setBoardDetail,
  setBoardFields,
  type BoardListItem,
} from '../../boards';
import { confirmAction } from '../../confirm';
import { space, type, useTheme } from '../../theme';
import { useAction } from '../../useAction';
import { FieldNameEditor } from '../ColumnNameEditor';
import { DateField } from '../DateField';
import { ReorderList } from '../ReorderList';
import { Select } from '../Select';
import { Body, Button, Card, Hint, IconAction, Row, TextField } from '../ui';

/**
 * Board settings → Details: facts about what the board is for, such as a start
 * date, the teachers or a meeting link (Faisal, 2026-11-15).
 *
 * Everyone on the board reads them here. The board's owners and admins change
 * them: each value on the page, in an editor of its own that holds its own
 * draft (a draft held by the page would re-render every field per keystroke),
 * and the fields themselves behind "Edit fields".
 */
export function DetailsPage({ board, canEdit }: { board: BoardListItem; canEdit: boolean }) {
  const { run, busy, error, setError } = useAction('boardSettings');
  // Which half of the page is showing: the values, or the fields' editor.
  // Local, not view state: leaving the page should close the editor.
  const [editingFields, setEditingFields] = useState(false);
  const fields = board.fields;

  return (
    <>
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {canEdit && editingFields ? (
        <FieldsEditor
          board={board}
          busy={busy}
          run={run}
          onError={setError}
          onDone={() => setEditingFields(false)}
        />
      ) : fields.length === 0 ? (
        <Card>
          <Body>No details yet.</Body>
          <Hint>
            Details are facts about what this board is for, such as a start date,
            the teachers or a meeting link. A board that needs none can leave
            this empty.
          </Hint>
          {canEdit ? (
            <View style={styles.start}>
              <Button label="Add details" onPress={() => setEditingFields(true)} />
            </View>
          ) : null}
        </Card>
      ) : (
        <>
          <Row style={styles.between}>
            <View style={styles.grow}>
              <Hint>
                {canEdit
                  ? 'Everyone on the board reads these. Tap a pencil to change a value.'
                  : 'The board’s owners fill these in.'}
              </Hint>
            </View>
            {canEdit ? (
              <IconAction icon="edit" label="Edit fields" onPress={() => setEditingFields(true)} />
            ) : null}
          </Row>
          <Card>
            {fields.map((f) => (
              <DetailValue
                key={f.id}
                boardId={board.id}
                field={f}
                value={board.details[f.id]}
                canEdit={canEdit}
                busy={busy}
                run={run}
                onError={setError}
              />
            ))}
          </Card>
        </>
      )}
    </>
  );
}

/**
 * One field and its value. For an owner, a pencil opens an editor holding its
 * own draft, which closes only once the write lands, so a failed save keeps
 * what was typed. A date is its own control, saved when it is picked, as a
 * card's due date is.
 */
function DetailValue({
  boardId,
  field,
  value,
  canEdit,
  busy,
  run,
  onError,
}: {
  boardId: string;
  field: BoardField;
  value: string | undefined;
  canEdit: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<string | null>(null);

  function save(raw: string) {
    const result = validateDetailValue(field.type, raw);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    void run(async () => {
      await setBoardDetail(boardId, field.id, result.value);
      setDraft(null);
    });
  }

  if (canEdit && isDateType(field.type)) {
    return (
      <View style={styles.field}>
        <Hint>{field.name}</Hint>
        <DateField
          value={value}
          label={field.name}
          emptyLabel="Not set"
          onChange={(next) => save(next ?? '')}
        />
      </View>
    );
  }

  if (draft !== null) {
    return (
      <View style={styles.field}>
        <Hint>{field.name}</Hint>
        <Row style={styles.editRow}>
          <View style={styles.grow}>
            <TextField
              value={draft}
              onChangeText={setDraft}
              onSubmit={() => save(draft)}
              autoFocus
              label={field.name}
              placeholder={field.type === 'link' ? 'https://' : undefined}
              maxLength={field.type === 'link' ? DETAIL_LINK_MAX : DETAIL_VALUE_MAX}
            />
          </View>
          <IconAction icon="check" label={`Save ${field.name}`} accent disabled={busy} onPress={() => save(draft)} />
          <IconAction icon="close" label="Cancel" disabled={busy} onPress={() => setDraft(null)} />
        </Row>
      </View>
    );
  }

  const link = field.type === 'link' ? safeLink(value) : null;
  return (
    <Row style={styles.between}>
      <View style={[styles.field, styles.grow]}>
        <Hint>{field.name}</Hint>
        {!value ? (
          // Secondary, not muted: "nothing here" is information, and muted
          // text measures under 3:1 (CLAUDE.md, Caption vs Hint).
          <Text style={[type.body, { color: t.text.secondary }]}>Not set</Text>
        ) : link ? (
          // Opened only when it is http or https, checked again here: another
          // client could have stored anything.
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${field.name}: ${link}`}
            onPress={() => void Linking.openURL(link).catch(() => undefined)}
          >
            <Text style={[type.body, styles.link, { color: t.text.accent }]}>{link}</Text>
          </Pressable>
        ) : (
          <Text style={[type.body, { color: t.text.primary }]} selectable>
            {isDateType(field.type) ? shortDay(value, todayInOrgTz()) : value}
          </Text>
        )}
      </View>
      {canEdit ? (
        <IconAction
          icon="edit"
          label={`Edit ${field.name}`}
          disabled={busy}
          onPress={() => setDraft(value ?? '')}
        />
      ) : null}
    </Row>
  );
}

/**
 * The fields themselves: renamed in place, dragged into order, removed after
 * a confirmation that names the value going with them, and added with a type.
 * A field's type is chosen once.
 */
function FieldsEditor({
  board,
  busy,
  run,
  onError,
  onDone,
}: {
  board: BoardListItem;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onError: (message: string) => void;
  onDone: () => void;
}) {
  const fields = board.fields;

  async function remove(f: BoardField) {
    const value = board.details[f.id];
    const ok = await confirmAction(
      `Remove “${f.name}”?`,
      value
        ? `What it holds, “${value}”, goes with it. This cannot be undone.`
        : 'This cannot be undone.',
    );
    if (ok) void run(() => removeBoardField(board.id, fields, f.id));
  }

  return (
    <>
      <Card>
        {fields.length === 0 ? <Hint>No fields yet. Add the first below.</Hint> : null}
        <ReorderList
          items={fields}
          keyOf={(f) => f.id}
          renderItem={(f) => (
            <Row style={styles.between}>
              <View style={styles.grow}>
                {isNamedType(f.type) ? (
                  <Body>{f.name}</Body>
                ) : (
                  <FieldNameEditor
                    field={f}
                    fields={fields}
                    canEdit
                    busy={busy}
                    onError={onError}
                    onRename={(next) => setBoardFields(board.id, next)}
                    run={run}
                  />
                )}
                <Hint>{isNamedType(f.type) ? 'A date. Keeps its name' : FIELD_TYPE_LABELS[f.type]}</Hint>
              </View>
              <IconAction
                icon="delete-outline"
                danger
                label={`Remove field ${f.name}`}
                disabled={busy}
                onPress={() => void remove(f)}
              />
            </Row>
          )}
          onReorder={(next) => void run(() => setBoardFields(board.id, next))}
        />
        <Hint>
          Drag a field by its handle to move it. A field’s type is chosen once:
          to change it, remove the field and add another. Removing a field
          removes what was typed in it.
        </Hint>
      </Card>

      {fieldAddBlocked(fields) ? (
        <Hint>{fieldAddBlocked(fields)}</Hint>
      ) : (
        <AddFieldRow
          fields={fields}
          busy={busy}
          onAdd={async (type, name) => {
            const r = addField(fields, type, name);
            if (!r.ok) {
              onError(r.error);
              return false;
            }
            await run(() => setBoardFields(board.id, r.fields));
            return true;
          }}
        />
      )}

      <View style={styles.start}>
        <Button label="Done" variant="secondary" onPress={onDone} />
      </View>
    </>
  );
}

/** The new-field row, owning its type and its draft name. */
function AddFieldRow({
  fields,
  busy,
  onAdd,
}: {
  fields: readonly BoardField[];
  busy: boolean;
  /** Resolves true once the field is accepted. */
  onAdd: (type: BoardFieldType, name: string) => Promise<boolean>;
}) {
  const types = addableFieldTypes(fields);
  const [fieldType, setFieldType] = useState<BoardFieldType>('text');
  const [name, setName] = useState('');
  // Start date or End date added since: fall back to a type still offered.
  const chosen = types.includes(fieldType) ? fieldType : types[0];
  const named = isNamedType(chosen);

  async function submit() {
    if (await onAdd(chosen, name)) setName('');
  }

  return (
    <Card>
      <Body>Add a field</Body>
      <Select
        label="Type"
        value={chosen}
        options={types.map((t) => ({
          value: t,
          label: isNamedType(t) ? `${FIELD_TYPE_LABELS[t]} (read by other screens)` : FIELD_TYPE_LABELS[t],
        }))}
        disabled={busy}
        onChange={(v) => setFieldType(v as BoardFieldType)}
      />
      <Row style={styles.editRow}>
        {named ? (
          <View style={styles.grow}>
            <Hint>Named {FIELD_TYPE_LABELS[chosen]}, always.</Hint>
          </View>
        ) : (
          <View style={styles.grow}>
            <TextField
              value={name}
              onChangeText={setName}
              placeholder="Field name, such as Teachers"
              maxLength={BOARD_FIELD_NAME_MAX}
              onSubmit={submit}
            />
          </View>
        )}
        <IconAction
          icon="add"
          label="Add field"
          accent
          onPress={submit}
          disabled={busy || (!named && !name.trim())}
        />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between', alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  field: { gap: 2, paddingVertical: space.xs },
  editRow: { alignItems: 'center', gap: space.xs },
  start: { alignItems: 'flex-start' },
  link: { textDecorationLine: 'underline' },
});
