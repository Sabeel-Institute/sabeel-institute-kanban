import { collection, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { Role, UserStatus } from '@sabeel/shared';
import { db, functions } from './firebase';
import { useLiveQuery } from './liveQuery';

export interface AdminUserRow {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  status: UserStatus;
}

/**
 * Every account, for the admin screen. Rules allow this list to admins only, so
 * for anyone else the listener errors and the screen shows empty plus a banner
 * rather than silently rendering nothing.
 *
 * `enabled` is how a screen says it has no business asking. Board settings is
 * the case: it now opens for every member of a board, and subscribing there
 * unconditionally meant a plain member got a red "Live data error" banner the
 * moment they looked at the member list — an error about a query nothing on
 * their screen needed. `useLiveQuery` treats a null query as "do not subscribe",
 * so nothing is published either way.
 */
export function useAllUsers(enabled = true) {
  return useLiveQuery<AdminUserRow[]>(
    () => (enabled ? query(collection(db, 'users'), orderBy('displayName')) : null),
    [enabled],
    'users',
    (docs) =>
      docs.map((d) => ({
        uid: d.id,
        displayName: (d.data.displayName as string) ?? '(no name)',
        email: (d.data.email as string) ?? '',
        role: (d.data.role as Role) ?? 'member',
        status: (d.data.status as UserStatus) ?? 'pending',
      })),
  );
}

const call = httpsCallable<
  { uid: string; role: Role; status: UserStatus },
  { ok: boolean }
>(functions, 'setUserAccess');

/**
 * The only way to change access. Clients cannot write users/* at all, so this
 * callable is the single path — and the server re-checks everything the UI
 * checked, since a disabled button is an affordance, not a security control.
 */
export async function setUserAccess(
  uid: string,
  role: Role,
  status: UserStatus,
): Promise<void> {
  await call({ uid, role, status });
}
