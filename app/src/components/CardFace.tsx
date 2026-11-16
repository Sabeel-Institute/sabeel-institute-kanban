import { Platform, StyleSheet, Text, View } from 'react-native';
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
  parentTitle,
  finished = false,
  unnamed = false,
}: {
  card: {
    title: string;
    /** Set on a subtask: the card it belongs to. */
    parentId?: string;
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
  /**
   * A subtask's main task, by title (see `parentTitles`), which its chip names.
   * Absent where the main task is not loaded — archived, or a cross-board list
   * — and the chip then says only "Subtask".
   */
  parentTitle?: string;
  /**
   * `isFinished` for this card on its board: in the finished column of a board
   * with lanes. A finished card is never drawn as late, on any surface, so
   * every caller passes it — the board layouts, the archive, My Work and
   * Search, each from the card's own board.
   */
  finished?: boolean;
  /**
   * The face is not inside a tile with a name of its own (the archive), so a
   * phone's screen reader reads it piece by piece and the subtask chip needs
   * its own words. Inside a named tile it must not: Android makes an
   * accessible view a stop of its own, so TalkBack would read the tile, then
   * stop on the chip again.
   */
  unnamed?: boolean;
  /** Every label, of both scopes, which is what lets My Work and Search render
   *  chips for cards whose board they never load. */
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

  const chip = { backgroundColor: t.bg.inset, borderColor: t.border.subtle };
  const overdue = !finished && bucketFor(card.dueDate, today) === 'overdue';
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
    !!card.parentId ||
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
          {/* The two subtask chips (Faisal, 2026-11-14, option C of three):
              soft grey, like an assignee, so they read as how cards relate
              rather than as one more coloured label. People had been adding
              "Main Task" and "subtask" labels by hand to see this. */}
          {subtasks > 0 ? (
            <View style={[styles.chip, chip]}>
              <Icon name="account-tree" size={13} color={t.text.secondary} />
              <Text style={[type.caption, { color: t.text.secondary }]}>
                {subtasks} subtask{subtasks === 1 ? '' : 's'}
              </Text>
            </View>
          ) : null}
          {card.parentId ? (
            <View
              style={[styles.chip, styles.chipShrink, chip]}
              // Inside a named tile the tile says it (`cardTileName`).
              {...(Platform.OS === 'web' || !unnamed
                ? {}
                : {
                    accessible: true,
                    accessibilityLabel: parentTitle !== undefined ? `Subtask of ${parentTitle}` : 'Subtask',
                  })}
            >
              <Icon name="subdirectory-arrow-right" size={13} color={t.text.secondary} />
              <Text
                style={[type.caption, styles.shrink, { color: t.text.secondary }]}
                numberOfLines={1}
              >
                {/* A browser reads the face's text, because the computer's
                    board tile is a plain element with no name of its own, so
                    "Subtask of" is there, drawn nowhere. In the SAME element
                    as the title: on its own, the title would be a second
                    element reading exactly the main task's name, which a
                    lookup by text takes for the main task's own card. */}
                {Platform.OS === 'web' && parentTitle !== undefined ? (
                  <Text style={styles.unseen}>Subtask of </Text>
                ) : null}
                {parentTitle ?? 'Subtask'}
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
                {describeDue(card.dueDate, today, finished)}
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  // A long main-task name is cut short inside its chip rather than widening
  // the row: Yoga's flexShrink defaults to 0, so the text must be allowed to give.
  chipShrink: { maxWidth: '100%' },
  shrink: { flexShrink: 1 },
  // Present for a screen reader, drawn nowhere.
  unseen: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
});
