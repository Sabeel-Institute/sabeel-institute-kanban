import { ORG_TIMEZONE } from './constants';

/**
 * All-day date helpers.
 *
 * Due dates are `YYYY-MM-DD` strings, never timestamps: a card due "the 5th"
 * must read as the 5th for everyone, and storing an instant guarantees it
 * eventually reads as the 4th for somebody. Comparison and sorting are therefore
 * plain lexicographic string operations.
 *
 * `ORG_TIMEZONE` is consulted in exactly one place — deciding what "today" is —
 * and nowhere else in the app.
 */

/** Today as YYYY-MM-DD in the org's timezone. */
export function todayInOrgTz(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is precisely the shape we store.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Shift a day key by whole days. Pure string/UTC arithmetic — no local time. */
export function addDays(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * `finished` is never a date's bucket (`bucketFor` does not return it): it is
 * where `groupByDue` puts a finished card, which is due nowhere.
 */
export type DueBucket = 'overdue' | 'today' | 'soon' | 'later' | 'none' | 'finished';

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  soon: 'Next 7 days',
  later: 'Later',
  none: 'No due date',
  finished: 'Finished',
};

/** Order the buckets appear in. Overdue first — it is the thing to act on. */
export const DUE_BUCKET_ORDER: DueBucket[] = [
  'overdue',
  'today',
  'soon',
  'later',
  'none',
  'finished',
];

export function bucketFor(dueDate: string | undefined, today: string): DueBucket {
  if (!dueDate) return 'none';
  if (dueDate < today) return 'overdue';
  if (dueDate === today) return 'today';
  return dueDate <= addDays(today, 7) ? 'soon' : 'later';
}

/**
 * Group assigned cards for the My Work screen: by urgency, then due date, then
 * title — so the list is deterministic and the top of it is always what needs
 * attention.
 */
export function groupByDue<T extends { dueDate?: string; title: string }>(
  cards: readonly T[],
  today: string,
  /**
   * Whether a card is finished (`isFinished` on its own board). A finished card
   * is never Overdue or due: it goes under Finished, last, whatever its date.
   */
  isDone: (card: T) => boolean = () => false,
): { bucket: DueBucket; label: string; cards: T[] }[] {
  const groups = new Map<DueBucket, T[]>();
  for (const c of cards) {
    const b = isDone(c) ? 'finished' : bucketFor(c.dueDate, today);
    const list = groups.get(b) ?? [];
    list.push(c);
    groups.set(b, list);
  }

  return DUE_BUCKET_ORDER.filter((b) => (groups.get(b)?.length ?? 0) > 0).map((b) => ({
    bucket: b,
    label: DUE_BUCKET_LABELS[b],
    cards: groups.get(b)!.sort((x, y) => {
      if (x.dueDate !== y.dueDate) return (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999');
      return x.title.localeCompare(y.title);
    }),
  }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day key as "3 Nov", with the year when it is not this year's. */
export function shortDay(dayKey: string, today: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const day = `${d} ${MONTHS[m - 1]}`;
  return y === Number(today.slice(0, 4)) ? day : `${day} ${y}`;
}

/**
 * Friendly relative wording for a due date, e.g. "3 days late", "Tomorrow".
 *
 * A FINISHED card (`isFinished`) is never late: past its date it shows the
 * date itself, "3 Nov", where any other card would say how late it is.
 */
export function describeDue(dueDate: string | undefined, today: string, finished = false): string {
  if (!dueDate) return '';
  if (finished && dueDate < today) return shortDay(dueDate, today);
  if (dueDate === today) return 'Today';
  if (dueDate === addDays(today, 1)) return 'Tomorrow';
  if (dueDate === addDays(today, -1)) return 'Yesterday';

  const [y1, m1, d1] = today.split('-').map(Number);
  const [y2, m2, d2] = dueDate.split('-').map(Number);
  const diff = Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000,
  );
  return diff < 0 ? `${-diff} days late` : `In ${diff} days`;
}
