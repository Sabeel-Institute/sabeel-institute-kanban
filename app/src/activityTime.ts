import { todayInOrgTz } from '@sabeel/shared';

/**
 * When a history entry happened, as the card and board histories show it:
 * relative while it is recent, then the day it happened in the org's timezone.
 */
export function when(ms: number, now: number = Date.now()): string {
  const mins = Math.floor((now - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return todayInOrgTz(new Date(ms));
}

/**
 * When a change recovered from backups happened: after `since`, by `at`. Two
 * backups a day apart usually straddle midnight, so this is most often a pair
 * of days, and it says so rather than picking one.
 */
export function whenWithin(since: number, at: number, now: number = Date.now()): string {
  const first = todayInOrgTz(new Date(since));
  const last = todayInOrgTz(new Date(at));
  if (at - since <= 60 * 60000) return when(at, now);
  return first === last ? first : `between ${first} and ${last}`;
}
