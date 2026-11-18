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
 * shows the typed date until the write settles (`onChange`'s promise), then
 * the value: the date as written, or as it was when a write is refused. A
 * date waiting on the pause is written if the field goes away first, and one
 * that is not a plausible date is taken back when the field is left.
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
  /**
   * Write the date. Return the write, so the field shows the date until it
   * settles; anything else counts as settled at once. Typed loosely because
   * callers are checked against the native sibling's props.
   */
  onChange: (next: string | undefined) => unknown;
  label?: string;
  /** What it says with no date: a card's due date by default. */
  emptyLabel?: string;
}) {
  const t = getTheme();
  // What is typed and not yet the value; null while the field shows the value.
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A plausible date waiting on the pause, written if the field goes away
  // first: a date picked and then Back pressed within the pause was lost.
  const waiting = useRef<string | null>(null);
  const write = useRef(onChange);
  write.current = onChange;
  const stored = useRef(value);
  stored.current = value;

  useEffect(() => {
    if (draft !== null && draft === (value ?? '')) setDraft(null);
  }, [value, draft]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const date = waiting.current;
      if (date !== null && date !== (stored.current ?? '')) void Promise.resolve(write.current(date));
    },
    [],
  );

  function stopWaiting() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    waiting.current = null;
  }

  /** Write `next`, showing it until the write settles, then the value. */
  function hand(next: string | undefined) {
    // Only the draft handed is dropped: one typed while this write was out is
    // the person's next date, not something to put the old value back over.
    const handed = next ?? '';
    void Promise.resolve(onChange(next)).finally(() =>
      setDraft((d) => (d === handed ? null : d)),
    );
  }

  function settle(next: string) {
    stopWaiting();
    if (next === (value ?? '')) setDraft(null);
    // Emptied by the keyboard: cleared, as the Clear button does.
    else if (next === '') hand(undefined);
    else if (plausibleDay(next)) hand(next);
    // Not a date anyone means (a year still being typed, or out of range):
    // taken back, rather than left showing what was never written.
    else setDraft(null);
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
          stopWaiting();
          // Emptied by the browser's own clear (Chrome's picker, Android's
          // dialog), not mid-typing: `badInput` is what tells the two apart,
          // since a half-typed date also reads as ''. Saved at once, as the
          // Clear button does; it once waited for the field to be left, and
          // leaving the screen first lost it.
          if (next === '' && !e.target.validity.badInput) {
            settle('');
            return;
          }
          if (plausibleDay(next)) {
            waiting.current = next;
            timer.current = setTimeout(() => settle(next), SETTLE_MS);
          }
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
            stopWaiting();
            setDraft(null);
            void Promise.resolve(onChange(undefined));
          }}
        />
      ) : (
        <Hint>{emptyLabel}</Hint>
      )}
    </Row>
  );
}
