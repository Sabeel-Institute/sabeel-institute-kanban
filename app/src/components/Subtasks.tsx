import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CARD_TITLE_MAX, childrenOf, linkableUnder, type BoardColumn } from '@sabeel/shared';
import type { Card } from '../cards';
import { noticeAction } from '../confirm';
import { Body, Button, Hint, IconAction, PickerList, Row, TextField } from './ui';
import { radius, space, useTheme } from './../theme';

/**
 * The subtasks of a card: links to other cards on the same board.
 *
 * The link lives on the CHILD (`parentId`), so this list is derived from the
 * board's cards rather than stored — it cannot disagree with reality. The board's
 * cards are already loaded by the card screen for its move-rank maths, so this
 * whole section costs no extra query and no index.
 *
 * Shaped after AssigneePicker: what IS linked shows as a short list, and adding
 * more hides behind a capped, scrolling picker so the section stays the same size
 * whether the board holds five cards or five hundred. Unlike that picker this one
 * needs a FILTER, because a board has far more cards than it has members and
 * scrolling to find one by eye stops working almost immediately.
 *
 * Archived subtasks simply drop out: the card list this reads excludes them, the
 * same way the board does.
 */
/**
 * The "new subtask" field, owning its draft.
 *
 * Small field, disproportionate cost: with the link picker open, `matches.map`
 * renders every linkable card on the board uncapped, and while this draft lived
 * in `Subtasks` each character re-rendered all of them along with every subtask
 * row above.
 */
function AddSubtaskRow({
  busy,
  onCreate,
  refusal,
}: {
  busy: boolean;
  /** Called with a trimmed, non-empty title. */
  onCreate: (title: string) => void;
  /** Why no subtask may be added here now, or null (`subtaskAddRefusal`). */
  refusal?: string | null;
}) {
  const [title, setTitle] = useState('');

  function create() {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Refused before anything is written, the title kept for when it can go.
    if (refusal) {
      void noticeAction('Not added', refusal);
      return;
    }
    setTitle('');
    onCreate(trimmed);
  }

  return (
    <>
      <View style={styles.grow}>
        <TextField
          value={title}
          onChangeText={setTitle}
          placeholder="New subtask"
          onSubmit={create}
          label="New subtask title"
          maxLength={CARD_TITLE_MAX}
        />
      </View>
      <IconAction
        icon="add"
        label="Add subtask"
        accent
        onPress={create}
        disabled={busy || !title.trim()}
      />
    </>
  );
}

export function Subtasks({
  parentId,
  boardCards,
  columns,
  busy,
  onOpen,
  onCreate,
  onLink,
  onUnlink,
  addRefusal,
  linkRefusal,
}: {
  parentId: string;
  /** Every live card on this board, rank-ordered. */
  boardCards: readonly Card[];
  columns: readonly BoardColumn[];
  busy?: boolean;
  onOpen: (cardId: string) => void;
  onCreate: (title: string) => void;
  onLink: (cardId: string) => void;
  onUnlink: (cardId: string) => void;
  /**
   * Why no subtask may be added, or null; and why a given card may not be
   * linked. A finished or archived parent takes no new open work (#111).
   */
  addRefusal?: string | null;
  linkRefusal?: (card: Card) => string | null;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  /**
   * The picker's filter, and it STAYS here — it drives `matches` below, so the
   * list this component renders depends on it. Not every text field can move
   * into a child; the ones that can are the ones nothing else reads.
   */
  const [filter, setFilter] = useState('');

  const children = useMemo(() => childrenOf(boardCards, parentId), [boardCards, parentId]);

  // Everything that could legally be linked — self, already-parented cards and
  // ancestors are excluded by the shared guard, so the picker cannot create a
  // cycle or silently steal a subtask from another card.
  const linkable = useMemo(() => linkableUnder(boardCards, parentId), [boardCards, parentId]);
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? linkable.filter((c) => c.title.toLowerCase().includes(q)) : linkable;
  }, [linkable, filter]);

  const columnName = (columnId: string) =>
    columns.find((col) => col.id === columnId)?.name ?? '';

  return (
    <View style={styles.wrap}>
      {children.length === 0 ? <Hint>No subtasks yet.</Hint> : null}

      {children.map((child) => (
        <Row key={child.id} style={styles.between}>
          {/* The whole row opens the subtask — it is a shortcut to that card,
              which is the entire point of the feature. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open subtask ${child.title}`}
            onPress={() => onOpen(child.id)}
            style={({ pressed }) => [styles.grow, pressed && { opacity: 0.6 }]}
          >
            <Body>{child.title}</Body>
            {/* Where it stands, so the list answers "is this done?" without
                opening each one. */}
            <Hint>{columnName(child.columnId)}</Hint>
          </Pressable>
          <IconAction
            icon="link-off"
            label={`Unlink subtask ${child.title}`}
            onPress={() => onUnlink(child.id)}
            disabled={busy}
          />
        </Row>
      ))}

      {/* One row for both ways of adding: type a title and press +, or press the
          link icon to attach a card that already exists. Both are ordinary
          actions with settled icons, so neither gets a labelled button — a
          full-width one costs a row of the card every time you open it. */}
      <Row style={styles.addRow}>
        <AddSubtaskRow busy={!!busy} onCreate={onCreate} refusal={addRefusal} />
        <IconAction
          icon="add-link"
          label="Link an existing card"
          onPress={() => setPicking(true)}
          disabled={busy || linkable.length === 0}
        />
      </Row>

      {picking ? (
        <View
          style={[
            styles.picker,
            { borderColor: t.border.subtle, backgroundColor: t.bg.inset },
          ]}
        >
          <Hint>Link an existing card</Hint>
          <TextField
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter cards"
            label="Filter cards"
          />
          {matches.length === 0 ? (
            <Hint>
              {linkable.length === 0
                ? 'Every other card on this board is already a subtask somewhere.'
                : 'No cards match.'}
            </Hint>
          ) : null}
          <PickerList>
            {matches.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`Link ${c.title} as a subtask`}
                onPress={() => {
                  const refused = linkRefusal?.(c);
                  if (refused) {
                    void noticeAction('Not linked', refused);
                    return;
                  }
                  onLink(c.id);
                  setFilter('');
                  setPicking(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: pressed ? t.bg.accentSoft : t.bg.surface,
                    borderColor: t.border.subtle,
                  },
                ]}
              >
                <Body>{c.title}</Body>
                <Hint>{columnName(c.columnId)}</Hint>
              </Pressable>
            ))}
          </PickerList>
          <Button
            label="Cancel"
            variant="secondary"
            onPress={() => {
              setFilter('');
              setPicking(false);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  between: { justifyContent: 'space-between', alignItems: 'center' },
  grow: { flex: 1, gap: space.xs },
  // space.sm, not xs: at 24px ink two adjacent glyphs 4px apart read as one
  // control. The 44px boxes never overlapped; this is about legibility.
  addRow: { alignItems: 'center', gap: space.sm },
  picker: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.sm,
    gap: space.sm,
  },
  /** Roughly four rows, then it scrolls. */
  option: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.xs,
    gap: space.xs,
  },
});
