/**
 * A list you narrow by typing, then pick from.
 *
 * The same shape the card screen's assignee and subtask pickers are built from
 * — a field, a list, and rows that say what picking them does. It is a component
 * here because the Filters sheet needs it three times over (boards, labels,
 * people) and three copies of a filter-and-pick loop is how three slightly
 * different behaviours get written by accident. Those two older pickers are NOT
 * on it: each carries behaviour this does not have (creating a label from the
 * field, excluding a card's own subtree), so migrating them is its own change
 * rather than a claim to make here.
 *
 * `PickerList`, never a hand-rolled `ScrollView`, wherever this scrolls at all:
 * a capped scroller under a FOCUSED `TextField` eats the tap on the row being
 * picked — the row does not even light up — and `PickerList` exists because that
 * was found three separate times. See its own note in `ui.tsx`, and `bounded`
 * below for when it should not scroll at all.
 */
import { Fragment, useMemo, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Body, Hint, PickerList, TextField } from './ui';
import { radius, space, useTheme } from '../theme';

export interface NarrowItem {
  id: string;
  name: string;
  /** A second line — an email, say. Also matched by the narrowing field. */
  detail?: string;
}

export function NarrowList({
  items,
  onPick,
  selectedIds,
  placeholder,
  actionVerb,
  empty,
  bounded = true,
}: {
  items: readonly NarrowItem[];
  onPick: (id: string) => void;
  /** Ids already chosen. Drawn as selected and STILL tappable, to un-choose. */
  selectedIds?: readonly string[];
  /** The field's label and placeholder, e.g. `Filter boards`. */
  placeholder: string;
  /**
   * Prefixes each row's accessible name, e.g. `Filter by`.
   *
   * Required rather than defaulted, because a bare name is what collides: a
   * label called "Archived" would otherwise answer to the same name as the
   * Archived chip behind the sheet, leaving two controls with one name for a
   * screen reader and for every test.
   */
  actionVerb: string;
  /** Shown when there is nothing to offer at all. */
  empty: string;
  /**
   * Whether the rows cap their own height and scroll INSIDE that cap.
   *
   * `false` wherever this list already sits in a bounded scroller — the Filters
   * sheet, whose body is exactly that. Two same-axis scrollers nested is a trap
   * on iOS: the inner one takes the pan and does NOT chain, so a drag over the
   * rows stops dead at the end of the inner list while the rest of the sheet
   * sits below, reachable only by starting the drag somewhere else. Web chains
   * and Android has `nestedScrollEnabled`, so a green web sweep says nothing
   * about it. One scroller, and the sheet scrolls as one list; a long list is
   * what the narrowing field above is for.
   *
   * Dropping `PickerList` here does NOT drop what it protects: the tap a focused
   * `TextField` makes a scroller eat is governed by `keyboardShouldPersistTaps`,
   * and the scroller that remains — `Sheet`'s body — sets it to `'handled'`
   * already, for that exact reason and at length. Passing `false` anywhere the
   * remaining scroller does not is how the bug comes back.
   *
   * `true` for a list on a plain screen, where nothing else is scrolling and the
   * cap is what stops a long list pushing the page down.
   */
  bounded?: boolean;
}) {
  const t = useTheme();
  // The draft belongs HERE, not to the screen: it changes on every keystroke,
  // and a screen holding it re-renders every list it draws per character.
  const [filter, setFilter] = useState('');

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.detail ?? '').toLowerCase().includes(q),
    );
  }, [items, filter]);

  if (items.length === 0) return <Hint>{empty}</Hint>;

  const Rows = bounded ? PickerList : Fragment;

  return (
    <>
      <TextField
        value={filter}
        onChangeText={setFilter}
        placeholder={placeholder}
        label={placeholder}
      />
      {matches.length === 0 ? <Hint>Nothing matches.</Hint> : null}
      <Rows>
        {matches.map((i) => {
          const selected = selectedIds?.includes(i.id) ?? false;
          return (
            <Pressable
              key={i.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              // The detail too: two labels can share a name, and only their
              // boards tell them apart, to a screen reader as on screen.
              accessibilityLabel={`${actionVerb} ${i.name}${i.detail ? `, ${i.detail}` : ''}`}
              onPress={() => onPick(i.id)}
              style={({ pressed }) => [
                styles.option,
                {
                  // Three distinct fills, so pressing a row that is already
                  // chosen still shows it was pressed — the same order
                  // `SheetOption` uses.
                  backgroundColor: selected
                    ? t.bg.accentSoft
                    : pressed
                      ? t.bg.inset
                      : t.bg.surface,
                  borderColor: selected ? t.accent.base : t.border.subtle,
                },
              ]}
            >
              <Body>{i.name}</Body>
              {i.detail ? <Hint>{i.detail}</Hint> : null}
            </Pressable>
          );
        })}
      </Rows>
    </>
  );
}

const styles = StyleSheet.create({
  option: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    padding: space.md,
    marginBottom: space.xs,
    gap: space.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
});
