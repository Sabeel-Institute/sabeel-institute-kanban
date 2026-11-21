import { getFirestore } from 'firebase-admin/firestore';

export const MCP_UPLOAD_TTL_MS = 15 * 60 * 1000;
export const MCP_UPLOAD_TIMEOUT_SECONDS = 60;
export const MCP_UPLOAD_COLLECTION = 'mcpAttachmentReservations';

export function isMcpAttachmentId(id: string): boolean {
  return /^mcp_[A-Za-z0-9]{20}$/.test(id);
}

/** Server-only, and kept independently of the card so it can find late bytes. */
export interface UploadReservation {
  cardId: string;
  uploadedBy: string;
  tokenHash: string;
  expiresAt: number;
  size: number;
  digest?: string;
  cancelled?: boolean;
}

export function uploadReservation(id: string) {
  return getFirestore().collection(MCP_UPLOAD_COLLECTION).doc(id);
}
