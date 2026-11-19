import './setup';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * A person's display name as it is now, for storing with what they did: a
 * comment, a line of a card's or a board's history. Read on the server when
 * it happens, so it names an admin who is not on the board, and still names
 * someone after they leave it, where a reader's lookup among the board's
 * members finds nobody ("Someone"). No client writes it, so none can forge it.
 * Undefined for a uid with no name on record (the system's, an unknown actor),
 * so readers fall back as they always have.
 */
export async function storedName(uid: string | undefined): Promise<string | undefined> {
  if (!uid) return undefined;
  const name = (await getFirestore().doc(`users/${uid}`).get()).data()?.displayName;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}
