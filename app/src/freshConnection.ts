// Native side of the fresh-connection seam (web sibling: freshConnection.web.ts).
import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from './firebase';

/**
 * A fresh connection to the database, for Try again on "Still setting up your
 * account": the connection closed and opened again, so whatever held the
 * profile back does not carry over. A phone app cannot reload itself without a
 * library it does not carry, and closing the connection is the next best. The
 * same seam as the sibling time tracker's.
 */
export async function freshConnection(): Promise<void> {
  await disableNetwork(db).catch(() => undefined);
  await enableNetwork(db).catch(() => undefined);
}
