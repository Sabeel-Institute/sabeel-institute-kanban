import { useEffect, useRef, useState } from 'react';
import { Button, Hint, Row } from './ui';
import { getTheme, radius, space } from '../theme';

/**
 * All-day date picker — WEB (native sibling: DateField.tsx).
 *
 * A real `<input type="date">`: it gives the browser's own calendar, keyboard
 * entry, locale-correct display and accessibility for free. Preset buttons
 * ("Today", "Next week") were a poor substitute — they cover three guesses and
 * nothing else, so any other date meant no date at all.
 *
 * The value is a `YYYY-MM-DD` string throughout, which is exactly what the input
 * expects and what cards store, so nothing converts and no timezone can drift.
 *
 * TYPING writes once, not per keystroke. The input reports a whole date after
 * every part typed: typing a year passes through 0002, 0020 and 0202, and each
 * one was handed on and written, history included, while a refused one put the
 * old value back under the typist's fingers. So the field holds what is typed,
 * and hands a date on only when it is whole and plausible (`plausibleDay`)
 * and typing has paused, or when the field is left or Enter is pressed. It
 * shows the typed date until the value catches up.
 */
const SETTLE_MS = 700;

/** A real day with a year a person would mean: 1900 to 2199. */
function plausibleDay(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2199) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function DateField({
  value,
  onChange,
  label,
  emptyLabel = 'No due date',
}: {
  value?: string;
  onChange: (next: string | undefined) => void;
  label?: string;
  /** What it says with no date: a card's due date by default. */
  emptyLabel?: string;
}) {
  const t = getTheme();
  // What is typed and not yet the value; null while the field shows the value.
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (draft !== null && draft === (value ?? '')) setDraft(null);
  }, [value, draft]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function settle(next: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (next === (value ?? '')) {
      setDraft(null);
      return;
    }
    // Emptied by the keyboard: cleared, as the Clear button does.
    if (next === '') onChange(undefined);
    else if (plausibleDay(next)) onChange(next);
  }

  return (
    <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
      <input
        type="date"
        value={draft ?? value ?? ''}
        aria-label={label ?? 'Due date'}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = plausibleDay(next) ? setTimeout(() => settle(next), SETTLE_MS) : null;
        }}
        onBlur={(e) => settle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') settle((e.target as HTMLInputElement).value);
        }}
        style={{
          background: t.bg.inset,
          color: t.text.primary,
          border: `1px solid ${t.border.subtle}`,
          borderRadius: radius.sm,
          padding: space.md,
          minHeight: 44,
          fontSize: 15,
          // Without this the browser renders its calendar glyph dark-on-dark.
          colorScheme: 'light',
        }}
      />
      {value ? (
        <Button
          label="Clear"
          variant="secondary"
          onPress={() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
            setDraft(null);
            onChange(undefined);
          }}
        />
      ) : (
        <Hint>{emptyLabel}</Hint>
      )}
    </Row>
  );
}
