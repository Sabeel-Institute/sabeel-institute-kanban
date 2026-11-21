import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { canCreateBoards, canManageBoard, sessionAccess, type BoardDoc } from '@sabeel/shared';

export const mcpAccessMessage = 'Kanban MCP is available to active administrators, organizers, and board owners.';

/** MCP eligibility is separate from what the account can do with each board. */
export async function mcpAccount(uid: string) {
  const user = await getAuth().getUser(uid).catch((error: unknown) => {
    if ((error as { code?: string }).code === 'auth/user-not-found') return null;
    throw error;
  });
  const access = sessionAccess(user?.customClaims ?? {}, {});
  if (!user || user.disabled || access.status !== 'active') {
    return { ok: false as const, message: 'This account is not active in Kanban.' };
  }
  if (!canCreateBoards(access)) {
    const boards = await getFirestore().collection('boards').where('boardOwnerUids', 'array-contains', uid).get();
    // An ownership entry alone confers nothing. The person must still be on the board.
    if (!boards.docs.some((board) => canManageBoard({ uid, ...access }, board.data() as BoardDoc))) {
      return { ok: false as const, message: mcpAccessMessage };
    }
  }
  return { ok: true as const, user, access };
}
