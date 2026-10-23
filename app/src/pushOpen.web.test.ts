import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The page's end of a tapped web notification (`pushOpen.web.ts`).
 *
 * The service worker either opens a new tab at the root with the push's
 * routing data as the query, or posts an open tab `{ type: 'push-open', data }`
 * (firebase-messaging-sw.test.ts holds that side). Both must come out as the
 * same `PushData` a phone tap gives `usePushOpens`, and neither may fire twice.
 */
type MessageListener = (event: { data: unknown }) => void;

async function load(search: string) {
  vi.resetModules();
  const replaceState = vi.fn();
  let onMessage: MessageListener | undefined;
  vi.stubGlobal('window', {
    location: { search, pathname: '/', hash: '' },
    history: { state: { at: 1 }, replaceState },
  });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      addEventListener: (type: string, fn: MessageListener) => {
        if (type === 'message') onMessage = fn;
      },
    },
  });
  const mod = await import('./pushOpen.web');
  return { ...mod, replaceState, post: (data: unknown) => onMessage!({ data }) };
}

afterEach(() => vi.unstubAllGlobals());

describe('a tab opened by a tapped notification', () => {
  it('takes the push off the launch URL once, and strips it so a reload does not open it again', async () => {
    const m = await load('?type=mention&boardId=b1&cardId=c1&notifId=n1');
    expect(m.takeInitialPush()).toEqual({ type: 'mention', boardId: 'b1', cardId: 'c1', notifId: 'n1' });
    expect(m.takeInitialPush()).toBeNull();
    expect(m.replaceState).toHaveBeenCalledWith({ at: 1 }, '', '/');
  });

  it('drops an empty field rather than routing by it (newUserPending sends no board)', async () => {
    const m = await load('?type=newUserPending&boardId=&notifId=n2');
    expect(m.takeInitialPush()).toEqual({ type: 'newUserPending', notifId: 'n2' });
  });

  it('leaves an ordinary launch alone', async () => {
    const m = await load('?utm=x');
    expect(m.takeInitialPush()).toBeNull();
    expect(m.replaceState).not.toHaveBeenCalled();
  });
});

describe('a tab already open when the notification is tapped', () => {
  it('hands each tap to the subscriber, and holds one that came before anyone subscribed', async () => {
    const m = await load('');
    m.post({ type: 'push-open', data: { type: 'assigned', boardId: 'b1', cardId: 'c1', notifId: 'n1' } });
    const seen: unknown[] = [];
    const unsubscribe = m.subscribePushOpens((d) => seen.push(d));
    m.post({ type: 'push-open', data: { type: 'dueSoon', boardId: 'b2', cardId: 'c2', notifId: 'n2', extra: 3 } });
    expect(seen).toEqual([
      { type: 'assigned', boardId: 'b1', cardId: 'c1', notifId: 'n1' },
      { type: 'dueSoon', boardId: 'b2', cardId: 'c2', notifId: 'n2' },
    ]);
    unsubscribe();
    m.post({ type: 'push-open', data: { type: 'mention', boardId: 'b3', cardId: 'c3', notifId: 'n3' } });
    expect(seen).toHaveLength(2);
  });

  it('ignores any other message from the worker', async () => {
    const m = await load('');
    const seen: unknown[] = [];
    m.subscribePushOpens((d) => seen.push(d));
    m.post({ type: 'something-else', data: { type: 'mention' } });
    m.post(null);
    m.post({ type: 'push-open', data: 'not an object' });
    expect(seen).toEqual([]);
  });
});
