import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFY_PREFS,
  NOTIFY_EVENTS,
  notificationText,
  shouldNotify,
} from '../src/notify';

describe('the default event set', () => {
  it('ships every event ON', () => {
    // Card events reach only people who chose the card or its column, and a run
    // of changes is one notice, so no event needs to start off to stay quiet.
    expect(NOTIFY_EVENTS.every((e) => e.defaultOn)).toBe(true);
  });

  it('stays small — every addition is a tax on attention', () => {
    // Seven since 2026-11-02, when the two comment events became one and the
    // move event became `cardChanged` beside `columnArrival`. Raising it has to
    // be a decision rather than a side effect.
    expect(NOTIFY_EVENTS.length).toBeLessThanOrEqual(7);
  });

  it('defaults are derived from the list, so a new event cannot ship without one', () => {
    expect(Object.keys(DEFAULT_NOTIFY_PREFS).sort()).toEqual(
      NOTIFY_EVENTS.map((e) => e.event).sort(),
    );
  });
});

describe('notificationText', () => {
  it('words a comment the same however you came to follow the card', () => {
    expect(notificationText({ event: 'comment', actorName: 'Sara', cardTitle: 'Fix signup' })).toBe(
      'Sara commented on \u201cFix signup\u201d',
    );
  });

  it('has a line for every event', () => {
    for (const { event } of NOTIFY_EVENTS) {
      expect(notificationText({ event, actorName: 'Sara', cardTitle: 'Fix signup' })).toBeTruthy();
    }
  });
});

describe('shouldNotify', () => {
  const base = {
    event: 'mention' as const,
    recipientUid: 'u1',
    actorUid: 'u2',
    status: 'active',
  };

  it('notifies by default', () => {
    expect(shouldNotify(base)).toBe(true);
  });

  it('NEVER notifies you about your own action', () => {
    // A system that pages you about what you just did looks broken.
    expect(shouldNotify({ ...base, actorUid: 'u1' })).toBe(false);
  });

  it('self-check wins even when the preference is on', () => {
    expect(
      shouldNotify({ ...base, actorUid: 'u1', prefs: { mention: true } }),
    ).toBe(false);
  });

  it('respects an explicit opt-out', () => {
    expect(shouldNotify({ ...base, prefs: { mention: false } })).toBe(false);
  });

  it('falls back to the default when the preference was never set', () => {
    // Treating undefined as "off" would mean nobody is notified until they
    // visit the settings screen.
    expect(shouldNotify({ ...base, prefs: {} })).toBe(true);
  });

  it('ignores a preference for an event that no longer exists', () => {
    // Accounts still carry keys from before 2026-11-02 (`myCardMoved` and the
    // two comment events); they decide nothing.
    const prefs = { myCardMoved: false, commentOnMyCard: false } as Record<string, boolean>;
    expect(shouldNotify({ ...base, event: 'comment', prefs })).toBe(true);
  });

  it('respects a muted board', () => {
    expect(
      shouldNotify({ ...base, boardId: 'b1', mutedBoardIds: ['b1'] }),
    ).toBe(false);
  });

  it('ignores mutes for other boards', () => {
    expect(
      shouldNotify({ ...base, boardId: 'b2', mutedBoardIds: ['b1'] }),
    ).toBe(true);
  });

  it('does not notify inactive accounts', () => {
    for (const status of ['pending', 'rejected', 'disabled']) {
      expect(shouldNotify({ ...base, status })).toBe(false);
    }
  });
});

describe('notificationText', () => {
  it('names the actor and the card', () => {
    expect(
      notificationText({ event: 'mention', actorName: 'Sara', cardTitle: 'Fix signup' }),
    ).toBe('Sara mentioned you on “Fix signup”');
  });

  it('degrades gracefully without a card title', () => {
    expect(notificationText({ event: 'assigned', actorName: 'Sara' })).toBe(
      'Sara assigned you a card',
    );
  });

  it('covers every event type', () => {
    for (const spec of NOTIFY_EVENTS) {
      const text = notificationText({
        event: spec.event,
        actorName: 'Sara',
        cardTitle: 'X',
      });
      expect(text.length).toBeGreaterThan(0);
      // It lands on a lock screen: keep it to a glance.
      expect(text.length).toBeLessThan(90);
    }
  });
});
