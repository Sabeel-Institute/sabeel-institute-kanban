import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocked with a factory for the reason slowWrites.test.ts gives: the real
// module imports @sentry/react-native, which this node environment cannot load.
vi.mock('./sentry', () => ({ captureError: vi.fn() }));

import { captureError } from './sentry';
import { SLOW_READ_MS, startReadTimer } from './slowReads';

const reported = vi.mocked(captureError);

function onlyReport(): { message: string; context: Record<string, unknown> } | null {
  if (reported.mock.calls.length === 0) return null;
  expect(reported).toHaveBeenCalledTimes(1);
  const [error, context, level] = reported.mock.calls[0];
  expect(level).toBe('warning');
  return { message: (error as Error).message, context: context as Record<string, unknown> };
}

describe('startReadTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reported.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays quiet when the server answers in time', () => {
    const t = startReadTimer('users');
    vi.advanceTimersByTime(SLOW_READ_MS - 1);
    t.snapshot(false);
    expect(onlyReport()).toBeNull();
  });

  it('times to the server answer, not to a cached first snapshot', () => {
    // The People list: the cached row at once, the server eight seconds later.
    const t = startReadTimer('users');
    vi.advanceTimersByTime(10);
    t.snapshot(true);
    vi.advanceTimersByTime(8000);
    t.snapshot(false);
    const r = onlyReport();
    expect(r?.message).toBe('Slow read: users took 8010ms');
    expect(r?.context).toMatchObject({
      source: 'slowRead',
      label: 'users',
      ms: 8010,
      outcome: 'answered',
      cacheShownFirst: true,
    });
  });

  it('reports a slow read the person gave up on', () => {
    const t = startReadTimer('users');
    vi.advanceTimersByTime(SLOW_READ_MS + 500);
    t.ended();
    const r = onlyReport();
    expect(r?.message).toBe(`Slow read: users abandoned after ${SLOW_READ_MS + 500}ms`);
    expect(r?.context).toMatchObject({ outcome: 'abandoned', cacheShownFirst: false });
  });

  it('stays quiet for a fast read that simply ended', () => {
    const t = startReadTimer('users');
    vi.advanceTimersByTime(100);
    t.ended();
    expect(onlyReport()).toBeNull();
  });

  it('does not charge time spent in the background', () => {
    const t = startReadTimer('users');
    t.backgrounded();
    vi.advanceTimersByTime(60_000);
    t.snapshot(false);
    t.ended();
    expect(onlyReport()).toBeNull();
  });

  it('leaves a failed listen to the error report', () => {
    const t = startReadTimer('users');
    vi.advanceTimersByTime(SLOW_READ_MS * 2);
    t.failed();
    t.ended();
    expect(onlyReport()).toBeNull();
  });

  it('reports once, however the subscription ends after the answer', () => {
    const t = startReadTimer('users');
    vi.advanceTimersByTime(SLOW_READ_MS);
    t.snapshot(false);
    t.snapshot(false);
    t.ended();
    expect(reported).toHaveBeenCalledTimes(1);
  });

  it('counts the other reads still waiting, and only those', () => {
    const slow = startReadTimer('users');
    const other = startReadTimer('boards');
    const finished = startReadTimer('labels');
    finished.snapshot(false);
    vi.advanceTimersByTime(SLOW_READ_MS);
    slow.snapshot(false);
    expect(onlyReport()?.context.alsoWaiting).toBe(1);
    other.ended();
  });
});
