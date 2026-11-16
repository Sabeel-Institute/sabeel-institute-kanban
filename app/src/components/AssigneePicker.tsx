import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BoardMemberProfile } from '../boards';
import { Body, Button, Hint, IconAction, PickerList, Row, TextField } from './ui';
import { radius, space, useTheme } from '../theme';

/**
 * Who can still be assigned: board members who are not already on the card.
 *
 * Exported because the control that OPENS the picker lives on the section
 * heading, in the parent — and the parent must not re-derive this. Counting
 * (`members.length > assigned.length`) looks equivalent and is not: an assignee
 * who has been removed from the board is still in `assignedUids` but no longer
 * in `members`, so the arithmetic reports "nobody left" while a real member is
 * still assignable, and the picker can never be opened again.
 */
export function assignableCandidates(
  members: readonly BoardMemberProfile[],
  assignedUids: readonly string[],
): readonly BoardMemberProfile[] {
  return members.filter((m) => !assignedUids.includes(m.uid));
}

/**
 * Assignees on a card.
 *
 * Shows who IS assigned as a short list, and hides everyone else behind a
 * compact, scrollable picker. The first version listed every board member with
 * an Assign/Unassign button, which meant the section grew with the board and
 * pushed the rest of the card off the screen — on a board of twenty people the
 * card detail became mostly a directory.
 *
 * The picker is capped in height and scrolls internally, so the section stays
 * the same size whether the board has three members or thirty.
 */
export function AssigneePicker({
  members,
  assignedUids,
  onToggle,
  busy,
  emptyHint,
  picking,
  onPickingChange,
}: {
  members: readonly BoardMemberProfile[];
  assignedUids: readonly string[];
  onToggle: (uid: string, assign: boolean) => void;
  busy?: boolean;
  /** Shown when the board has nobody else to assign — explains what to do. */
  emptyHint?: string;
  /**
   * Whether the picker is open. CONTROLLED by the parent because the control
   * that opens it lives on the section heading, outside this component — see
   * `Heading`'s `action` slot. Keeping the state here would mean the trigger
   * could not reach it.
   */
  picking: boolean;
  onPickingChange: (next: boolean) => void;
}) {
  const t = useTheme();

  const assigned = useMemo(
    () => members.filter((m) => assignedUids.includes(m.uid)),
    [members, assignedUids],
  );
  const available = useMemo(
    () => assignableCandidates(members, assignedUids),
    [members, assignedUids],
  );

  // Assigning the LAST candidate empties the picker while it is still open.
  // Without this the section is left in a state with no picker and no way to
  // reopen it (the heading's trigger hides while `picking`), and unassigning
  // someone later would make the picker reappear unbidden.
  useEffect(() => {
    if (picking && available.length === 0) onPickingChange(false);
  }, [picking, available.length, onPickingChange]);

  // An assignee who is no longer a board member (removed while assigned) would
  // otherwise vanish from the UI while remaining on the card. Surface them so
  // they can be removed.
  /**
   * Narrow the list by typing, the same way the subtask picker does
   * (`components/Subtasks.tsx`) rather than a second idiom for the same job.
   * With the whole organisation on a board this is a type instead of a scroll.
   */
  const [filter, setFilter] = useState('');
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return available;
    return available.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [available, filter]);

  const orphaned = assignedUids.filter((uid) => !members.some((m) => m.uid === uid));

  return (
    <View style={styles.wrap}>
      {assigned.length === 0 && orphaned.length === 0 ? (
        <Hint>Nobody is assigned.</Hint>
      ) : null}

      {assigned.map((m) => (
        <Row key={m.uid} style={styles.between}>
          <View style={styles.grow}>
            <Body>{m.displayName}</Body>
            <Hint>{m.email}</Hint>
          </View>
          <IconAction
            icon="person-remove"
            label={`Unassign ${m.displayName}`}
            disabled={busy}
            onPress={() => onToggle(m.uid, false)}
          />
        </Row>
      ))}

      {orphaned.map((uid) => (
        <Row key={uid} style={styles.between}>
          <View style={styles.grow}>
            <Body>Someone no longer on this board</Body>
            <Hint>Assigned before they were removed</Hint>
          </View>
          <IconAction
            icon="person-remove"
            label="Unassign this person"
            disabled={busy}
            onPress={() => onToggle(uid, false)}
          />
        </Row>
      ))}

      {available.length === 0 ? (
        <Hint>
          {emptyHint ??
            'Everyone on this board is already assigned. Add more people in Board settings → People.'}
        </Hint>
      ) : picking ? (
        <View
          style={[
            styles.picker,
            { borderColor: t.border.subtle, backgroundColor: t.bg.inset },
          ]}
        >
          <Hint>Assign someone</Hint>
          <TextField
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter people"
            label="Filter people"
          />
          {matches.length === 0 ? <Hint>No one matches.</Hint> : null}
          <PickerList>
            {matches.map((m) => (
              <Pressable
                key={m.uid}
                accessibilityRole="button"
                accessibilityLabel={`Assign ${m.displayName}`}
                onPress={() => {
                  onToggle(m.uid, true);
                  // Stay open: assigning two or three people in a row is the
                  // common case, and reopening each time is friction.
                }}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: pressed ? t.bg.accentSoft : t.bg.surface,
                    borderColor: t.border.subtle,
                  },
                ]}
              >
                <Body>{m.displayName}</Body>
                <Hint>{m.email}</Hint>
              </Pressable>
            ))}
          </PickerList>
          <Button
            label="Done"
            variant="secondary"
            onPress={() => {
              setFilter('');
              onPickingChange(false);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1, gap: space.xs },
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
