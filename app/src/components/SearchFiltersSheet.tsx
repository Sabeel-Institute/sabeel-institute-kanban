/**
 * Search's filter menu: four sections, one open at a time.
 *
 * An ACCORDION rather than four independent collapsibles, and the geometry is
 * what decides it. `Sheet` bounds itself to 80% of the viewport; on a 320x568
 * phone that is ~454pt, and once padding, the title, the gaps and the footer
 * button are taken out the body is about 342pt. The four section HEADERS spend
 * 200 of that before anything is open, so one expanded section — a field, its
 * rows and a hint — already asks the sheet to scroll, and a second would double
 * what has to be scrolled past to reach the sections below it. One at a time is
 * what keeps the sheet a page rather than a stack of pages.
 *
 * The rows inside a section therefore do NOT scroll themselves
 * (`bounded={false}`): the sheet body is already a bounded scroller, and two
 * same-axis scrollers nested is a trap on iOS, where the inner one takes the pan
 * and does not chain — see `NarrowList`.
 *
 * Every section is CLOSED on open, and its state is in its own header rather
 * than behind it — `Board: Fundraising 2026`, `Labels (2)` — the shape the
 * boards screen's archived section already uses. Four headers that said only
 * `Board`, `Labels`, `Priority` would show nothing about what is filtering and
 * turn every filter into two taps to find out.
 *
 * Picks apply IMMEDIATELY and the sheet stays open, because multi-select
 * otherwise means reopening it once per value. That is also why the footer says
 * `Done` and not `Cancel`: there is nothing left to cancel.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  NO_PEOPLE_MATCH,
  PEOPLE_FILTER_LABEL,
  PRIORITIES,
  priorityLabel,
  type Priority,
} from '@sabeel/shared';
import { Sheet } from './Sheet';
import { NarrowList, narrowPeople, type NarrowItem } from './NarrowList';
import { Button, FilterChip, Hint, Row } from './ui';
import { space, useTheme } from '../theme';

/** The "no board" / "anyone" row. A real id can never be empty. */
const ANY = '';
/** People narrow as every person picker does; "Anyone" stays first until something is typed. */
const NARROW_PEOPLE = narrowPeople([ANY]);

type Section = 'priority' | 'board' | 'labels' | 'assignee';

export interface SearchFiltersSheetProps {
  visible: boolean;
  onClose: () => void;
  priorities: readonly Priority[];
  onTogglePriority: (p: Priority) => void;
  boards: readonly NarrowItem[];
  boardId: string | undefined;
  onPickBoard: (id: string | undefined) => void;
  labels: readonly NarrowItem[];
  labelIds: readonly string[];
  onToggleLabel: (id: string) => void;
  people: readonly NarrowItem[];
  assigneeUid: string | undefined;
  onPickAssignee: (uid: string | undefined) => void;
  /** Only rendered when something is actually narrowing. */
  onClearAll: (() => void) | null;
}

export function SearchFiltersSheet(props: SearchFiltersSheetProps) {
  return (
    <Sheet
      visible={props.visible}
      title="Filters"
      onClose={props.onClose}
      closeLabel="Done"
    >
      {/* Unmount-scoped: `Sheet` renders nothing while closed, so which section
          is open and every narrowing field reset themselves by mounting fresh.
          Holding that state above would need clearing by hand on every close. */}
      <Sections {...props} />
    </Sheet>
  );
}

function Sections({
  priorities,
  onTogglePriority,
  boards,
  boardId,
  onPickBoard,
  labels,
  labelIds,
  onToggleLabel,
  people,
  assigneeUid,
  onPickAssignee,
  onClearAll,
}: SearchFiltersSheetProps) {
  const [open, setOpen] = useState<Section | null>(null);
  const toggle = (s: Section) => setOpen((cur) => (cur === s ? null : s));

  const boardName = boards.find((b) => b.id === boardId)?.name;
  const personName = people.find((p) => p.id === assigneeUid)?.name;

  return (
    <>
      <Section
        title="Priority"
        summary={priorities.length > 0 ? ` (${priorities.length})` : undefined}
        open={open === 'priority'}
        onToggle={() => toggle('priority')}
      >
        {/* Bounded at five, so this needs no picker and no narrowing field —
            the whole set fits in one wrapped row. */}
        <Row style={styles.chips}>
          {PRIORITIES.map((p) => (
            <FilterChip
              key={p}
              label={priorityLabel(p)}
              // Distinct from the active-filter chip of the same word sitting
              // behind the sheet — otherwise two controls answer to one name.
              name={`${priorityLabel(p)} priority`}
              active={priorities.includes(p)}
              onPress={() => onTogglePriority(p)}
            />
          ))}
        </Row>
        <Hint>None means cards with no priority set — a filter, not the absence of one.</Hint>
      </Section>

      <Section
        title="Board"
        summary={boardName ? `: ${boardName}` : undefined}
        open={open === 'board'}
        onToggle={() => toggle('board')}
      >
        {/* The `Anything` row is prepended only when there is something to
            narrow FROM. Prepended unconditionally it made `empty` unreachable —
            a list of one row saying "All boards", where the sentence explaining
            why there is nothing to pick would have been the useful thing. */}
        <NarrowList
          items={boards.length > 0 ? [{ id: ANY, name: 'All boards' }, ...boards] : []}
          selectedIds={[boardId ?? ANY]}
          onPick={(id) => onPickBoard(id === ANY ? undefined : id)}
          placeholder="Filter boards"
          actionVerb="Filter to"
          empty="You are not on any board yet."
          bounded={false}
        />
        {/* Archived BOARDS are a different thing from archived CARDS, and the
            chip outside this sheet is about the latter. Say so rather than let
            the two be conflated by a missing name. */}
        <Hint>Archived boards are not listed; their cards are not searched.</Hint>
      </Section>

      <Section
        title="Labels"
        summary={labelIds.length > 0 ? ` (${labelIds.length})` : undefined}
        open={open === 'labels'}
        onToggle={() => toggle('labels')}
      >
        <NarrowList
          items={labels}
          selectedIds={labelIds}
          onPick={onToggleLabel}
          placeholder="Filter labels"
          actionVerb="Filter by"
          empty="No labels have been created yet."
          bounded={false}
        />
        <Hint>A card matches any of the labels you pick.</Hint>
      </Section>

      <Section
        title="Assigned to"
        summary={personName ? `: ${personName}` : undefined}
        open={open === 'assignee'}
        onToggle={() => toggle('assignee')}
      >
        <NarrowList
          items={people.length > 0 ? [{ id: ANY, name: 'Anyone' }, ...people] : []}
          selectedIds={[assigneeUid ?? ANY]}
          onPick={(uid) => onPickAssignee(uid === ANY ? undefined : uid)}
          placeholder={PEOPLE_FILTER_LABEL}
          narrow={NARROW_PEOPLE}
          noMatch={NO_PEOPLE_MATCH}
          actionVerb="Filter to"
          empty="Nobody is on a board with you."
          bounded={false}
        />
      </Section>

      {/* The screen's own clear control is BEHIND this modal, so without one
          here the sheet is a place you can filter from but not un-filter from.

          `Clear all`, NOT `Clear all filters` — which is the word on the screen's
          own control, and that one is still in the tree while this modal is up.
          Two controls answering to one name is the exact collision `FilterChip`
          gained its `name` prop to avoid: a screen reader reads one name twice,
          and `getByRole('button', { name: 'Clear all filters' })` becomes
          ambiguous rather than failing honestly. Inside a sheet titled `Filters`
          the shorter word says the same thing. */}
      {onClearAll ? (
        <Button label="Clear all" variant="secondary" onPress={onClearAll} />
      ) : null}
    </>
  );
}

/**
 * One collapsible section.
 *
 * A `Button` plus a conditional render, not a new `Collapsible` primitive: this
 * is the same two-part shape the boards screen uses for its archived list, and
 * the state belongs in the label anyway.
 */
function Section({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  /**
   * Appended verbatim, so the header says what the section is doing without
   * being opened — ` (2)` or `: Fundraising 2026`. Carrying its own separator
   * keeps the two shapes from needing a rule about which one to insert.
   */
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <>
      <Button
        label={`${title}${summary ?? ''}`}
        variant="secondary"
        expanded={open}
        onPress={onToggle}
      />
      {/* Indented behind a rule, so an open section's content reads as being
          INSIDE it. Without that the sheet is a stack of identical pills — four
          disclosures and a Done that dismisses — with nothing saying which of
          them the field and list below belong to. */}
      {open ? (
        <View style={[styles.body, { borderLeftColor: t.border.subtle }]}>{children}</View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexWrap: 'wrap', gap: space.xs },
  body: {
    gap: space.sm,
    paddingBottom: space.sm,
    paddingLeft: space.sm,
    marginLeft: space.sm,
    borderLeftWidth: 2,
  },
});
