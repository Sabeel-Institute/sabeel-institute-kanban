/**
 * The filter every person picker uses: adding someone to a board, assigning a
 * card, Search's "Assigned to". One field with one label, narrowing by one
 * matcher (`matchPeople` in @sabeel/shared, which the @mention list uses too),
 * so typing the same letters finds the same people in the same order in all
 * of them.
 *
 * The draft lives in the component that owns the field — the hook is called
 * there — never in a screen: it changes on every keystroke.
 */
import { useMemo, useState } from 'react';
import { matchPeople, NO_PEOPLE_MATCH, PEOPLE_FILTER_LABEL, type PersonLike } from '@sabeel/shared';
import { Hint, TextField } from './ui';

export function usePeopleFilter<T extends PersonLike>(
  people: readonly T[],
  opts: { first?: (person: T) => boolean } = {},
) {
  const [filter, setFilter] = useState('');
  const { first } = opts;
  const matches = useMemo(() => matchPeople(filter, people, { first }), [filter, people, first]);
  return { filter, setFilter, matches };
}

export function PeopleFilterField({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  return (
    <TextField
      value={value}
      onChangeText={onChange}
      placeholder={PEOPLE_FILTER_LABEL}
      label={PEOPLE_FILTER_LABEL}
    />
  );
}

/** Said when the filter leaves nobody, in every picker alike. */
export function NoPeopleMatch() {
  return <Hint>{NO_PEOPLE_MATCH}</Hint>;
}
