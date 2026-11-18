import { describe, it, expect } from 'vitest';
import {
  addDays,
  bucketFor,
  describeDue,
  groupByDue,
  todayInOrgTz,
} from '../src/due';

describe('addDays', () => {
  it('moves forward and backward', () => {
    expect(addDays('2026-07-19', 1)).toBe('2026-07-20');
    expect(addDays('2026-07-19', -1)).toBe('2026-07-18');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('is unaffected by the machine timezone', () => {
    // The whole reason dates are strings: a card due "the 5th" is the 5th
    // everywhere. This arithmetic must never touch local time.
    const original = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Niue']) {
        process.env.TZ = tz;
        expect(addDays('2026-07-19', 1)).toBe('2026-07-20');
      }
    } finally {
      process.env.TZ = original;
    }
  });
});

describe('todayInOrgTz', () => {
  it('returns a YYYY-MM-DD string', () => {
    expect(todayInOrgTz()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses the ORG timezone, not the viewer', () => {
    // 02:00Z is still the previous day in Houston (UTC-5 in summer).
    expect(todayInOrgTz(new Date('2026-07-19T02:00:00Z'))).toBe('2026-07-18');
  });

  it('is CENTRAL, not Eastern — the hour between them is a whole day', () => {
    // 04:30Z on 19 July is 23:30 on the 18th in Chicago but already 00:30 on the
    // 19th in New York. Pinning a real instant is what makes this test fail if
    // ORG_TIMEZONE is ever moved back; asserting the string alone would not.
    expect(todayInOrgTz(new Date('2026-07-19T04:30:00Z'))).toBe('2026-07-18');
  });
});

describe('bucketFor', () => {
  const today = '2026-07-19';

  it('classifies each case', () => {
    expect(bucketFor(undefined, today)).toBe('none');
    expect(bucketFor('2026-07-18', today)).toBe('overdue');
    expect(bucketFor('2026-07-19', today)).toBe('today');
    expect(bucketFor('2026-07-20', today)).toBe('soon');
    expect(bucketFor('2026-07-26', today)).toBe('soon');
    expect(bucketFor('2026-07-27', today)).toBe('later');
  });

  it('treats the 7-day edge inclusively', () => {
    expect(bucketFor(addDays(today, 7), today)).toBe('soon');
    expect(bucketFor(addDays(today, 8), today)).toBe('later');
  });
});

describe('groupByDue', () => {
  const today = '2026-07-19';
  const cards = [
    { title: 'later thing', dueDate: '2026-09-01' },
    { title: 'overdue b', dueDate: '2026-07-01' },
    { title: 'no date' },
    { title: 'today b', dueDate: today },
    { title: 'overdue a', dueDate: '2026-07-01' },
    { title: 'today a', dueDate: today },
  ];

  it('puts overdue first and no-date last', () => {
    expect(groupByDue(cards, today).map((g) => g.bucket)).toEqual([
      'overdue',
      'today',
      'later',
      'none',
    ]);
  });

  it('omits empty buckets', () => {
    expect(groupByDue([{ title: 'x' }], today).map((g) => g.bucket)).toEqual(['none']);
  });

  it('sorts within a bucket by date then title, so the order is deterministic', () => {
    const overdue = groupByDue(cards, today)[0];
    expect(overdue.cards.map((c) => c.title)).toEqual(['overdue a', 'overdue b']);
  });

  it('loses no cards', () => {
    const total = groupByDue(cards, today).reduce((n, g) => n + g.cards.length, 0);
    expect(total).toBe(cards.length);
  });

  it('handles an empty list', () => {
    expect(groupByDue([], today)).toEqual([]);
  });
});

describe('describeDue', () => {
  const today = '2026-07-19';

  it('uses friendly words for the near cases', () => {
    expect(describeDue(today, today)).toBe('Today');
    expect(describeDue('2026-07-20', today)).toBe('Tomorrow');
    expect(describeDue('2026-07-18', today)).toBe('Yesterday');
  });

  it('counts days otherwise', () => {
    expect(describeDue('2026-07-22', today)).toBe('In 3 days');
    expect(describeDue('2026-07-16', today)).toBe('3 days late');
  });

  it('is empty with no due date', () => {
    expect(describeDue(undefined, today)).toBe('');
  });

  it('counts correctly across a month boundary', () => {
    expect(describeDue('2026-08-01', '2026-07-31')).toBe('Tomorrow');
    expect(describeDue('2026-08-03', '2026-07-31')).toBe('In 3 days');
  });
});

describe('a finished card’s date', () => {
  it('is the date itself once past, never "late"', () => {
    expect(describeDue('2026-11-03', '2026-11-15', true)).toBe('3 Nov');
    expect(describeDue('2025-12-30', '2026-11-15', true)).toBe('30 Dec 2025');
    expect(describeDue('2026-11-14', '2026-11-15', true)).toBe('14 Nov');
  });

  it('reads as any other card’s from today on', () => {
    expect(describeDue('2026-11-15', '2026-11-15', true)).toBe('Today');
    expect(describeDue('2026-11-18', '2026-11-15', true)).toBe('In 3 days');
  });

  it('still says late for a card that is not finished', () => {
    expect(describeDue('2026-11-03', '2026-11-15')).toBe('12 days late');
  });
});

describe('groupByDue with finished cards', () => {
  const today = '2026-11-15';
  const cards = [
    { title: 'late', dueDate: '2026-11-01' },
    { title: 'done late', dueDate: '2026-11-01' },
    { title: 'done soon', dueDate: '2026-11-17' },
  ];
  const isDone = (c: { title: string }) => c.title.startsWith('done');

  it('files a finished card under Finished, last, whatever its date', () => {
    const groups = groupByDue(cards, today, isDone);
    expect(groups.map((g) => [g.label, g.cards.map((c) => c.title)])).toEqual([
      ['Overdue', ['late']],
      ['Finished', ['done late', 'done soon']],
    ]);
  });

  it('has no Finished group without a finished card', () => {
    expect(groupByDue(cards, today).map((g) => g.bucket)).toEqual(['overdue', 'soon']);
  });
});
