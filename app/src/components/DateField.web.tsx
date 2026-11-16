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
 */
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

  return (
    <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
      <input
        type="date"
        value={value ?? ''}
        aria-label={label ?? 'Due date'}
        onChange={(e) => onChange(e.target.value || undefined)}
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
        <Button label="Clear" variant="secondary" onPress={() => onChange(undefined)} />
      ) : (
        <Hint>{emptyLabel}</Hint>
      )}
    </Row>
  );
}
