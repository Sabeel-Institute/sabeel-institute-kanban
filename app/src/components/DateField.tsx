import { useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, Hint, Row } from './ui';
import { space } from '../theme';

/**
 * All-day date picker — NATIVE (web sibling: DateField.web.tsx).
 *
 * Uses the platform's own calendar via @react-native-community/datetimepicker,
 * the same component the sibling time-tracker app uses.
 *
 * The picker uses local calendar dates, so both conversions use local fields.
 * A UTC instant can land on the next or previous day on the device.
 */
function toDate(dayKey?: string): Date {
  if (!dayKey) return new Date();
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date();
  date.setFullYear(y, m - 1, d);
  date.setHours(12, 0, 0, 0);
  return date;
}

function toDayKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function DateField({
  value,
  onChange,
  label,
  emptyLabel = 'No due date',
  clearLabel,
}: {
  value?: string;
  /** Write the date; what it returns is not used here (the web sibling waits on it). */
  onChange: (next: string | undefined) => unknown;
  label?: string;
  /** What it says with no date: a card's due date by default. */
  emptyLabel?: string;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Row style={styles.row}>
      <Button
        label={value ?? 'Pick a date'}
        accessibilityLabel={label ? `${label}, ${value ?? 'pick a date'}` : undefined}
        variant="secondary"
        onPress={() => setOpen(true)}
      />
      {value ? (
        <Button
          label="Clear"
          accessibilityLabel={clearLabel}
          variant="secondary"
          onPress={() => onChange(undefined)}
        />
      ) : (
        <Hint>{emptyLabel}</Hint>
      )}

      {open ? (
        <DateTimePicker
          value={toDate(value)}
          mode="date"
          accessibilityLabel={label ?? 'Due date'}
          onChange={(event, picked) => {
            setOpen(false);
            if (event.type === 'set' && picked) onChange(toDayKey(picked));
          }}
        />
      ) : null}
    </Row>
  );
}

const styles = { row: { flexWrap: 'wrap' as const, gap: space.sm } };
