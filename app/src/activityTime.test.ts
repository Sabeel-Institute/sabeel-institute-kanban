import { describe, expect, it } from 'vitest';
import { when, whenWithin } from './activityTime';

// 2026-10-29 03:00 UTC is still the 28th in Houston.
const NIGHT = Date.UTC(2026, 9, 29, 3, 0);
const NOW = Date.UTC(2026, 9, 31, 12, 0);

describe('when', () => {
  it('is relative for the first day', () => {
    expect(when(NOW - 20_000, NOW)).toBe('just now');
    expect(when(NOW - 5 * 60000, NOW)).toBe('5m ago');
    expect(when(NOW - 3 * 3600000, NOW)).toBe('3h ago');
  });

  it('then gives the day in the org timezone, not UTC', () => {
    expect(when(NIGHT, NOW)).toBe('2026-10-28');
  });
});

describe('whenWithin', () => {
  it('names both days when the window crosses midnight', () => {
    expect(whenWithin(Date.UTC(2026, 7, 12, 17), Date.UTC(2026, 7, 13, 17), NOW)).toBe(
      'between 2026-08-12 and 2026-08-13',
    );
  });

  it('names one day when the window sits inside it', () => {
    expect(whenWithin(Date.UTC(2026, 7, 12, 14), Date.UTC(2026, 7, 12, 22), NOW)).toBe('2026-08-12');
  });

  it('reads like an exact time once the window is an hour or less', () => {
    expect(whenWithin(NOW - 3 * 3600000 - 60000, NOW - 3 * 3600000, NOW)).toBe('3h ago');
  });
});
