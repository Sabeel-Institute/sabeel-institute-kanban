// Web side of the fresh-connection seam (native sibling: freshConnection.ts).
import { clearIndexedDbPersistence, terminate, waitForPendingWrites } from 'firebase/firestore';
import { db } from './firebase';

/** How long unsent writes get to reach the server before the cache is left alone. */
const PENDING_WRITES_MS = 5_000;

/**
 * On the web, Try again starts the database over: the browser's Firestore
 * cache cleared, then the page reloaded.
 *
 * Measured 2026-10-16 against the Firestore emulator: when the profile is
 * written while the page's listen for it is still being registered, the
 * listener answers "does not exist" and never hears the write, and the
 * answer sticks to the LISTEN TARGET, which this app's persistent cache keeps
 * across reloads with its resume token. Listening again, a direct read from
 * the server, a token refresh and a plain reload all re-used it and stayed
 * stale (4 of 4 reloads); a new target, which only an empty cache gives,
 * hears the server.
 *
 * Only once nothing is waiting to be sent: the cache is also where unsent
 * writes wait, so if some cannot reach the server within PENDING_WRITES_MS
 * the cache is kept and the page only reloads. Clearing also refuses while
 * another tab of the app holds the cache open; then too the page only
 * reloads. Never resolves, so the button stays busy until the page goes.
 */
export async function freshConnection(): Promise<void> {
  const settled = await Promise.race([
    waitForPendingWrites(db).then(() => true, () => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PENDING_WRITES_MS)),
  ]);
  if (settled) {
    await terminate(db).catch(() => undefined);
    await clearIndexedDbPersistence(db).catch(() => undefined);
  }
  window.location.reload();
  return new Promise<void>(() => undefined);
}
