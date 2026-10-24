import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '../icons';
import { bucketFor, describeDue, todayInOrgTz, type Label, type Priority } from '@sabeel/shared';
import type { BoardMemberProfile } from '../boards';
import { AssigneeChip, Body, ColorBadge, PriorityBadge } from './ui';
import { space, type, useTheme } from '../theme';

/**
 * The at-a-glance content of a card — title, then priority + labels + due, then
 * assignee chips. The SINGLE definition of a card face: every surface (the three
 * board layouts, My Work, Search) embeds this inside its own interaction
 * container, so the face is described once and a new field is a one-line change
 * here. Purely presentational: it resolves ids against the label set and board
 * members passed in, and draws — no data loading, no interaction.
 */
export function CardFace({
  card,
  labels,
  boardMembers,
  subtaskCount,
}: {
  card: {
    title: string;
    priority: Priority;
    dueDate?: string;
    labelIds: string[];
    assigneeUids: string[];
    /**
     * Ready files, denormalised onto the card by the attachment callables.
     * Optional so every surface that builds a face keeps compiling, and because
     * cards written before attachments existed do not carry it.
     */
    attachmentCount?: number;
  };
  /**
   * How many subtasks this card has, shown as a chip so a parent card is
   * distinguishable from a leaf at a glance. Optional and computed by the caller
   * from the board's own cards (see `subtaskCounts`) — the board layouts pass it;
   * My Work and Search do not, because those are cross-board flat lists that
   * never load a card's siblings.
   */
  subtaskCount?: number;
  /** The org-wide label set. Not board-scoped — a card carries the same labels
   *  wherever it lives, which is what lets My Work and Search render chips for
   *  cards whose board they never load. */
  labels: readonly Label[];
  boardMembers: readonly BoardMemberProfile[];
}) {
  const t = useTheme();
  const today = todayInOrgTz();

  const chips = card.labelIds
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => !!l);
  const assignees = card.assigneeUids
    .map((uid) => boardMembers.find((m) => m.uid === uid))
    .filter((m): m is BoardMemberProfile => !!m);

  const overdue = bucketFor(card.dueDate, today) === 'overdue';
  const dueColor = overdue ? t.text.danger : t.text.muted;
  const subtasks = subtaskCount ?? 0;
  // Straight off the card document — denormalised by the attachment callables —
  // so badging a tile costs no extra read. A subcollection query per card would
  // be one round trip per tile on every board render.
  const files = card.attachmentCount ?? 0;
  const hasMeta =
    card.priority !== 'none' ||
    chips.length > 0 ||
    !!card.dueDate ||
    subtasks > 0 ||
    files > 0;

  return (
    <View style={styles.face}>
      <Body>{card.title}</Body>

      {hasMeta ? (
        <View style={styles.metaRow}>
          <PriorityBadge priority={card.priority} />
          {chips.map((l) => (
            <ColorBadge key={l.id} color={l.color} label={l.name} />
          ))}
          {subtasks > 0 ? (
            <View style={styles.due}>
              <Icon name="account-tree" size={13} color={t.text.muted} />
              <Text style={[type.caption, { color: t.text.muted }]}>
                {subtasks} subtask{subtasks === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
          {files > 0 ? (
            <View style={styles.due}>
              <Icon name="attach-file" size={13} color={t.text.muted} />
              <Text style={[type.caption, { color: t.text.muted }]}>
                {files} file{files === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
          {card.dueDate ? (
            <View style={styles.due}>
              <Icon name="event" size={13} color={dueColor} />
              <Text style={[type.caption, { color: dueColor }]}>
                {describeDue(card.dueDate, today)}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {assignees.length > 0 ? (
        <View style={styles.assigneeRow}>
          {assignees.map((m) => (
            <AssigneeChip key={m.uid} name={m.displayName} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  face: { gap: space.xs },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  assigneeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  due: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
