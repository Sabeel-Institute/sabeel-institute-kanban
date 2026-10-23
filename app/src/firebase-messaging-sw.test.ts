import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { NOTIFY_EVENTS } from '@sabeel/shared';

/**
 * The service worker, run in a fake worker scope.
 *
 * `public/firebase-messaging-sw.js` is a classic script outside the bundle, so
 * nothing else executes it: it was the one piece of the notification path with
 * no test at all, and the piece that had a duplicate banner in it for a month
 * without anyone knowing (see the comment at the top of the file). No suite can
 * receive a real push, so this is the gate — it dispatches the events a browser
 * would and asserts what the worker draws and where a click goes.
 * (`scripts/push-e2e.mjs` then delivers a real push of every kind to it in
 * Chromium and follows each tap to its screen.)
 *
 * Every push shows a notification: that is the decision of 2026-09-17, and the
 * first test is the one that goes red if a visibility check ever creeps back.
 */
const source = readFileSync(resolve(__dirname, '../public/firebase-messaging-sw.js'), 'utf8');

type Listener = (event: unknown) => void;

interface Scope {
  listeners: Map<string, Listener>;
  showNotification: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
  openWindow: ReturnType<typeof vi.fn>;
  skipWaiting: ReturnType<typeof vi.fn>;
}

/** Load the worker into a scope with the globals it uses, and nothing else. */
function worker(windows: Array<{ url: string; focus: ReturnType<typeof vi.fn>; visibilityState?: string; focused?: boolean }> = []): Scope {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(() => Promise.resolve());
  const matchAll = vi.fn(() => Promise.resolve(windows));
  const openWindow = vi.fn(() => Promise.resolve(null));
  const skipWaiting = vi.fn(() => Promise.resolve());
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: { showNotification },
    location: { origin: 'https://kanban.example' },
    skipWaiting,
  };
  runInNewContext(source, { self, clients: { matchAll, openWindow } });
  return { listeners, showNotification, matchAll, openWindow, skipWaiting };
}

/** A push event carrying FCM's JSON body, with `waitUntil` captured. */
function push(body: unknown) {
  const settled: Promise<unknown>[] = [];
  return {
    event: {
      data: { json: () => body },
      waitUntil: (p: Promise<unknown>) => settled.push(p),
    },
    settled,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('push', () => {
  it('shows every push, even with a tab of the app visible and focused', async () => {
    // The case the SDK's worker used to skip. A visibility check that skips
    // the banner while a window is open goes red HERE, not somewhere else.
    const w = worker([
      { url: 'https://kanban.example/', focus: vi.fn(), visibilityState: 'visible', focused: true },
    ]);
    const { event, settled } = push({
      notification: { title: 'Sabeel Kanban', body: 'Sara mentioned you on “Budget”' },
      data: { type: 'mention', boardId: 'b1', cardId: 'c1', notifId: 'n1' },
    });
    w.listeners.get('push')!(event);
    await Promise.all(settled);
    expect(w.showNotification).toHaveBeenCalledTimes(1);
    expect(w.showNotification).toHaveBeenCalledWith('Sabeel Kanban', {
      body: 'Sara mentioned you on “Budget”',
      icon: '/favicon.ico',
      tag: 'c1',
      data: { type: 'mention', boardId: 'b1', cardId: 'c1', notifId: 'n1' },
    });
    // The worker must not be allowed to die before the banner is up.
    expect(settled).toHaveLength(1);
  });

  it('collapses on the board when there is no card, and on the app when there is neither', () => {
    const w = worker();
    w.listeners.get('push')!(push({ notification: { title: 't', body: 'b' }, data: { boardId: 'b9' } }).event);
    w.listeners.get('push')!(push({ notification: { title: 't', body: 'b' } }).event);
    expect(w.showNotification.mock.calls.map((c) => (c[1] as { tag: string }).tag)).toEqual([
      'b9',
      'sabeel-kanban',
    ]);
  });

  it('falls back to the app name and an empty body rather than drawing "undefined"', () => {
    const w = worker();
    w.listeners.get('push')!(push({ data: { type: 'dueSoon' } }).event);
    expect(w.showNotification).toHaveBeenCalledWith('Sabeel Kanban', expect.objectContaining({ body: '' }));
  });

  it('ignores a push that is not FCM JSON', () => {
    const w = worker();
    const event = {
      data: { json: () => { throw new SyntaxError('not json'); } },
      waitUntil: vi.fn(),
    };
    w.listeners.get('push')!(event);
    w.listeners.get('push')!({ data: null, waitUntil: event.waitUntil });
    expect(w.showNotification).not.toHaveBeenCalled();
    expect(event.waitUntil).not.toHaveBeenCalled();
  });
});

describe('install', () => {
  it('takes over at once rather than waiting for every tab to close', () => {
    const w = worker();
    w.listeners.get('install')!({});
    expect(w.skipWaiting).toHaveBeenCalledTimes(1);
  });
});

describe('notificationclick', () => {
  type Win = { url: string; focus: ReturnType<typeof vi.fn>; postMessage: ReturnType<typeof vi.fn> };
  const win = (url: string, focus = vi.fn(() => Promise.resolve())): Win => ({ url, focus, postMessage: vi.fn() });

  function click(w: Scope, data?: Record<string, string>) {
    const settled: Promise<unknown>[] = [];
    const notification = { close: vi.fn(), data };
    w.listeners.get('notificationclick')!({
      notification,
      waitUntil: (p: Promise<unknown>) => settled.push(p),
    });
    return { notification, settled };
  }

  /** The routing data the server sends with a push of this kind (functions/src/notifications.ts). */
  const sent = (event: string): Record<string, string> =>
    event === 'newUserPending'
      ? { type: event, boardId: '', notifId: 'n1' }
      : { type: event, boardId: 'b1', cardId: 'c1', notifId: 'n1' };

  it('tells a tab of the app that is open where the notification points, and brings it forward', async () => {
    const mine = win('https://kanban.example/b/b1');
    const other = win('https://elsewhere.example/');
    const w = worker([other, mine]);
    const data = sent('mention');
    const { notification, settled } = click(w, data);
    await Promise.all(settled);
    expect(notification.close).toHaveBeenCalledTimes(1);
    expect(mine.postMessage).toHaveBeenCalledWith({ type: 'push-open', data });
    expect(mine.focus).toHaveBeenCalledTimes(1);
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(w.openWindow).not.toHaveBeenCalled();
  });

  it('still tells the tab where to go when the browser refuses to focus it', async () => {
    const mine = win('https://kanban.example/', vi.fn(() => Promise.reject(new Error('not allowed'))));
    const w = worker([mine]);
    const { settled } = click(w, sent('assigned'));
    await Promise.all(settled);
    expect(mine.postMessage).toHaveBeenCalledTimes(1);
  });

  it.each(NOTIFY_EVENTS.map((e) => e.event))(
    'opens %s in a new tab at an address carrying its routing data, when no tab is open',
    async (event) => {
      const w = worker([]);
      const data = sent(event);
      const { settled } = click(w, data);
      await Promise.all(settled);
      const [url] = w.openWindow.mock.calls[0] as unknown as [string];
      expect(url.startsWith('/?')).toBe(true);
      const query = Object.fromEntries(new URLSearchParams(url.slice(2)));
      expect(query).toEqual(data);
    },
  );

  it('opens the app itself for a notification with nothing to route by', async () => {
    const w = worker([]);
    const { settled } = click(w);
    await Promise.all(settled);
    expect(w.openWindow).toHaveBeenCalledWith('/');
  });
});
