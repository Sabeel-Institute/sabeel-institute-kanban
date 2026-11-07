/**
 * Managing labels, in the two places that do it.
 *
 * A label is an INSTITUTE label (no `boardId`: on every board, and changed by
 * admins alone, in More → Labels) or a BOARD label (on that board only, and
 * changed by anyone on it). `LabelManager` is the list with its controls for one
 * of those scopes, and both the admin panel and a board's own screen use it, so
 * renaming, recolouring and deleting work the same way in both.
 *
 * On a board, institute labels are listed first and LOCKED, for admins too: the
 * one place they change is the panel, because a change there reaches every
 * board. The lock is the whole explanation, so there is no text beside it.
 */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  LABEL_COLORS,
  LABEL_NAME_MAX,
  describeLabelUsage,
  labelsForBoard,
  validateLabelName,
  type Label,
} from '@sabeel/shared';
import { Icon } from '../icons';
import {
  countLabelUsage,
  createLabel,
  deleteLabel,
  updateLabel,
  useLabels,
  type LabelUsage,
} from '../labels';
import type { SessionUser } from '../session';
import { Body, Button, Card, Heading, Hint, IconAction, Row, Spinner, TextField } from './ui';
import { radius, space, useTheme } from '../theme';
import { useAction } from '../useAction';

/**
 * One scope's labels, each with palette, pencil and bin, and a row to add one.
 *
 * `known` is every label a new name must not repeat: for a board, the institute
 * labels as well as its own, since both appear in its pickers. `null` until the
 * list has loaded, and adding stays disabled until then, because a uniqueness
 * check against a list that has not arrived waves every duplicate through.
 */
export function LabelManager({
  boardId,
  user,
  labels,
  known,
}: {
  /** The board whose own labels these are, or `null` for institute labels. */
  boardId: string | null;
  user: SessionUser;
  labels: readonly Label[];
  known: readonly Label[] | null;
}) {
  const { run, busy, error, setError } = useAction('labels');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<Label | null>(null);
  // null = still counting, 'unknown' = the count failed.
  const [pendingCards, setPendingCards] = useState<LabelUsage | 'unknown' | null>(null);
  const countReq = useRef(0);

  async function add(name: string, color: string): Promise<boolean> {
    if (known === null) return false;
    const problem = validateLabelName(name, known);
    if (problem) {
      setError(problem);
      return false;
    }
    let created = false;
    await run(async () => {
      await createLabel({ name, color, user, boardId });
      created = true;
    });
    return created;
  }

  async function saveName(label: Label, name: string): Promise<boolean> {
    // Exclude the label being renamed, or "no change" fails its own check.
    if (known === null) return false;
    const problem = validateLabelName(name, known, label.id);
    if (problem) {
      setError(problem);
      return false;
    }
    // Closes only once the write lands, so a refused rename keeps its text.
    let saved = false;
    await run(async () => {
      await updateLabel(label.id, { name });
      setRenaming(null);
      saved = true;
    });
    return saved;
  }

  /**
   * Deleting takes the label off every card carrying it, so it asks first and
   * says how many. The dialog opens at once, because it is the feedback, and
   * the count drops in when the callable answers; a stale answer is ignored.
   */
  function askDelete(label: Label) {
    setPending(label);
    setPendingCards(null);
    const req = ++countReq.current;
    countLabelUsage(label.id)
      .then((n) => {
        if (countReq.current === req) setPendingCards(n);
      })
      .catch(() => {
        if (countReq.current === req) setPendingCards('unknown');
      });
  }

  const reach = boardId ? 'on this board' : 'across every board';

  return (
    <>
      {error ? <Body>{error}</Body> : null}
      {labels.map((l) =>
        renaming === l.id ? (
          <LabelNameEditor
            key={l.id}
            label={l}
            busy={busy}
            ready={known !== null}
            onSave={(name) => saveName(l, name)}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <Row key={l.id} style={styles.between}>
            {/* The NAME gives way and the actions never do: a long name, or one
                starting with an emoji, used to push the bin off the screen.
                Two lines, because one clipped "Waiting on Response" to "Waitin…". */}
            <Row style={styles.grow}>
              <View style={[styles.swatch, { backgroundColor: l.color }]} />
              <Body numberOfLines={2}>{l.name}</Body>
            </Row>
            <Row style={styles.noShrink}>
              {/* Cycling the palette is one tap; the swatch row below belongs to
                  the label being added. */}
              <IconAction
                icon="palette"
                label={`Change colour of ${l.name}`}
                disabled={busy}
                onPress={() =>
                  run(() =>
                    updateLabel(l.id, {
                      color:
                        LABEL_COLORS[
                          (LABEL_COLORS.indexOf(l.color as (typeof LABEL_COLORS)[number]) + 1) %
                            LABEL_COLORS.length
                        ],
                    }),
                  )
                }
              />
              <IconAction
                icon="edit"
                // "Rename LABEL x": a column on Board settings can share the name,
                // and two controls must not share an accessible name.
                label={`Rename label ${l.name}`}
                disabled={busy}
                onPress={() => setRenaming(l.id)}
              />
              <IconAction
                icon="delete-outline"
                label={`Delete label ${l.name}`}
                danger
                disabled={busy}
                onPress={() => askDelete(l)}
              />
            </Row>
          </Row>
        ),
      )}
      {/* HERE, under the bin that opened it. Further down the screen it was
          off-screen on a phone, and the bin looked as if it had done nothing. */}
      {pending ? (
        <Card>
          <Body>
            {pendingCards === null
              ? `Delete “${pending.name}”? Checking how many cards use it…`
              : pendingCards === 'unknown'
                ? `Delete “${pending.name}”? Could not check how many cards use it. It will be removed from all of them, ${reach}. This cannot be undone.`
                : `Delete “${pending.name}”? ${describeLabelUsage(pendingCards)}${
                    pendingCards.active + pendingCards.archived > 0
                      ? ` It will be removed from all of them, ${reach}. This cannot be undone.`
                      : ''
                  }`}
          </Body>
          <Row>
            <Button
              busy={busy}
              label="Delete"
              variant="danger"
              onPress={() =>
                run(async () => {
                  await deleteLabel(pending.id);
                  setPending(null);
                })
              }
            />
            <Button label="Cancel" variant="secondary" onPress={() => setPending(null)} />
          </Row>
        </Card>
      ) : null}
      <AddLabelRow busy={busy} ready={known !== null} onAdd={add} />
    </>
  );
}

/**
 * The Labels section of a board's own screen, for everyone on the board.
 *
 * One list: institute labels first, locked, then the board's own with their
 * controls. Nothing explains the lock, by decision: the icon does.
 */
export function BoardLabelsSection({ boardId, user }: { boardId: string; user: SessionUser }) {
  const labels = useLabels();
  const all = labels.data ?? [];
  const shown = labelsForBoard(all, boardId);
  const institute = shown.filter((l) => !l.boardId);
  const own = shown.filter((l) => l.boardId === boardId);
  return (
    <>
      <Heading>Labels</Heading>
      <Card>
        {labels.status === 'loading' ? <Spinner label="Loading labels…" /> : null}
        {labels.status === 'ready' && shown.length === 0 ? <Hint>No labels yet.</Hint> : null}
        {institute.map((l) => (
          <LockedLabel key={l.id} label={l} />
        ))}
        <LabelManager
          boardId={boardId}
          user={user}
          labels={own}
          known={labels.status === 'ready' ? shown : null}
        />
      </Card>
    </>
  );
}

/** An institute label on a board: listed so people know it exists, never edited here. */
function LockedLabel({ label }: { label: Label }) {
  const t = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label.name}, set by admins`}
      style={[styles.between, styles.locked]}
    >
      <Row style={styles.grow}>
        <View style={[styles.swatch, { backgroundColor: label.color }]} />
        <Body numberOfLines={2}>{label.name}</Body>
      </Row>
      {/* Ornament beside text, not a target, so its own small size; it sits in
          the bin's 44px column so the locked rows line up with the rest. */}
      <View style={styles.lockBox}>
        <Icon name="lock-outline" size={18} color={t.text.muted} />
      </View>
    </View>
  );
}

/** The new-label row, owning its own name and colour. */
function AddLabelRow({
  busy,
  ready,
  onAdd,
}: {
  busy: boolean;
  /** False until the label list has loaded; uniqueness cannot be judged yet. */
  ready: boolean;
  onAdd: (name: string, color: string) => Promise<boolean>;
}) {
  const t = useTheme();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(LABEL_COLORS[0]);

  async function submit() {
    if (await onAdd(name, color)) setName('');
  }

  return (
    <>
      <TextField
        value={name}
        onChangeText={setName}
        placeholder="New label name"
        maxLength={LABEL_NAME_MAX}
      />
      {/* The + ends the colour row, where the flow finishes: name, colour, add. */}
      <Row style={styles.addRow}>
        <Row style={[styles.wrap, styles.grow]}>
          {LABEL_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              accessibilityRole="button"
              accessibilityLabel={`Label colour ${c}`}
            >
              <View
                style={[
                  styles.swatch,
                  styles.swatchPick,
                  { backgroundColor: c, borderColor: color === c ? t.text.primary : 'transparent' },
                ]}
              />
            </Pressable>
          ))}
        </Row>
        <IconAction
          icon="add"
          label="Add label"
          accent
          disabled={busy || !name.trim() || !ready}
          onPress={submit}
        />
      </Row>
    </>
  );
}

/**
 * Renaming one label in place. Mounted only while its row is being renamed, so
 * the lifecycle is the reset, and the draft re-renders nothing but this row.
 */
function LabelNameEditor({
  label,
  busy,
  ready,
  onSave,
  onCancel,
}: {
  label: Label;
  busy: boolean;
  ready: boolean;
  /** Resolves once the rename lands; false if refused, and the field stays open. */
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(label.name);

  return (
    <Row style={styles.between}>
      <View style={[styles.swatch, { backgroundColor: label.color }]} />
      <View style={styles.grow}>
        <TextField
          value={draft}
          onChangeText={setDraft}
          label={`New name for label ${label.name}`}
          maxLength={LABEL_NAME_MAX}
          autoFocus
        />
      </View>
      <IconAction
        icon="check"
        label={`Save name for label ${label.name}`}
        accent
        disabled={busy || !draft.trim() || !ready}
        onPress={() => void onSave(draft)}
      />
      <IconAction icon="close" label="Cancel rename" disabled={busy} onPress={onCancel} />
    </Row>
  );
}

const styles = StyleSheet.create({
  /** Actions hold their width so a long name truncates instead of evicting them. */
  noShrink: { flexShrink: 0 },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1, gap: space.xs },
  wrap: { flexWrap: 'wrap' },
  /** A tight gap: IconAction is a laid-out 44pt box, not slop. */
  addRow: { alignItems: 'center', gap: space.xs },
  /** The height of a row with icon actions, so locked rows space the same. */
  locked: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  lockBox: { width: 44, alignItems: 'center' },
  swatch: { width: 18, height: 18, borderRadius: radius.pill },
  swatchPick: { width: 28, height: 28, borderWidth: 2 },
});
