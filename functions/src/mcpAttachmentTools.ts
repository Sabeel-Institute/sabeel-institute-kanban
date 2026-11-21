import { createHash, randomBytes } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { HttpsError, onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { z } from 'zod';
import {
  ATTACHMENT_MAX_BYTES, ATTACHMENT_NAME_MAX, attachmentStoragePath, canAccessBoard,
  normalizeContentType, sanitizeAttachmentName, sessionAccess, type AttachmentDoc, type BoardDoc,
} from '@sabeel/shared';
import { applyFinalizeAttachment, readyAttachmentUrl } from './attachments';
import { MCP_UPLOAD_TIMEOUT_SECONDS, MCP_UPLOAD_TTL_MS, uploadReservation, type UploadReservation } from './attachmentUploads';
import { docId, word, writeResult, type McpActor, type WriteTools } from './mcpWrite';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const attachmentInputs = z.object({
  name: word.max(ATTACHMENT_NAME_MAX),
  size_bytes: z.number().int().min(0).max(ATTACHMENT_MAX_BYTES),
  content_type: word.max(255).optional(),
}).strict().array().min(1).max(10).describe('Files to attach. Returns an upload URL and token for each file; send the raw bytes with PUT.');

export type AttachmentInputs = z.infer<typeof attachmentInputs>;

async function prepareAttachments(base: string, me: McpActor, cardId: string, files: AttachmentInputs) {
  const db = getFirestore();
  const card = db.doc(`cards/${cardId}`);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(card);
    if (!current.exists) throw new Error('The card is gone.');
    const board = await tx.get(db.doc(`boards/${current.data()!.boardId}`));
    if (!board.exists || !canAccessBoard(me, board.data() as BoardDoc)) throw new Error('You cannot attach files to this card.');
    const now = Date.now();
    return files.map((file) => {
      const ref = card.collection('attachments');
      const target = ref.doc(`mcp_${ref.doc().id}`);
      const token = randomBytes(32).toString('base64url');
      const name = sanitizeAttachmentName(file.name);
      const expiresAt = now + MCP_UPLOAD_TTL_MS;
      const pending: AttachmentDoc = {
        name, contentType: normalizeContentType(file.content_type), uploadedBy: me.uid, uploadedAt: now, status: 'uploading',
      };
      const reservation: UploadReservation = {
        cardId, uploadedBy: me.uid, tokenHash: hash(token), expiresAt, size: file.size_bytes,
      };
      tx.create(target, pending);
      tx.create(uploadReservation(target.id), reservation);
      return { id: target.id, name, status: 'pending', upload_url: `${base}/mcp/attachments/${cardId}/${target.id}`,
        method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, expires_at: new Date(expiresAt).toISOString() };
    });
  });
}

export async function withAttachments<T extends { id: string }>(base: string, me: McpActor, card: T, files: AttachmentInputs | undefined) {
  if (!files?.length) return card;
  try {
    return { ...card, attachments: await prepareAttachments(base, me, card.id, files) };
  } catch {
    return { ...card, attachment_error: 'The card is saved. Use prepare_attachments to retry preparing files.' };
  }
}

async function uploadActor(uid: string) {
  const user = await getAuth().getUser(uid);
  if (user.disabled) throw new HttpsError('permission-denied', 'The uploader no longer has access to this card.');
  return { uid, ...sessionAccess(user.customClaims ?? {}, {}) };
}

async function checkUploadAccess(tx: Transaction, boardId: string, actor: Awaited<ReturnType<typeof uploadActor>>) {
  const board = await tx.get(getFirestore().doc(`boards/${boardId}`));
  if (!board.exists || !canAccessBoard(actor, board.data() as BoardDoc)) {
    throw new HttpsError('permission-denied', 'The uploader no longer has access to this card.');
  }
}

async function receiveAttachment(cardId: string, attachmentId: string, authorization: string, bytes: Buffer) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
  if (!token) return { status: 401, body: { error: 'Send the Authorization header returned with the upload URL.' } };
  const db = getFirestore();
  const cardRef = db.doc(`cards/${cardId}`);
  const attachmentRef = cardRef.collection('attachments').doc(attachmentId);
  const reservationRef = uploadReservation(attachmentId);
  const file = getStorage().bucket().file(attachmentStoragePath(cardId, attachmentId));
  const tokenHash = hash(token);

  // Check the reservation before looking up the uploader or hashing the file.
  function valid(reservation: UploadReservation | undefined): reservation is UploadReservation {
    return !!reservation && reservation.cardId === cardId && reservation.tokenHash === tokenHash &&
      !reservation.cancelled && reservation.expiresAt > Date.now();
  }
  const initial = (await reservationRef.get()).data() as UploadReservation | undefined;
  if (!valid(initial)) {
    return { status: 403, body: { error: 'This upload token is invalid, expired or cancelled. Prepare a new upload.' } };
  }
  if (bytes.length !== initial.size) {
    return { status: 400, body: { error: `Send exactly ${initial.size} raw bytes.` } };
  }

  let writing = false;
  try {
    const actor = await uploadActor(initial.uploadedBy);
    const digest = hash(bytes);
    const reserved = await db.runTransaction(async (tx) => {
      const [reservation, attachment, card] = await Promise.all([
        tx.get(reservationRef), tx.get(attachmentRef), tx.get(cardRef),
      ]);
      const saved = reservation.data() as UploadReservation | undefined;
      if (!attachment.exists || !card.exists) throw new HttpsError('not-found', 'The card or upload was removed.');
      if (!valid(saved) || saved.uploadedBy !== actor.uid) {
        throw new HttpsError('permission-denied', 'This upload is expired or cancelled. Prepare a new upload.');
      }
      await checkUploadAccess(tx, card.get('boardId') as string, actor);
      if (saved.digest && saved.digest !== digest) {
        throw new HttpsError('already-exists', 'This upload is reserved for different bytes. Prepare a new upload for a different file.');
      }
      // Pin the bytes before writing them. The reservation also outlives a
      // deleted card or attachment so the sweeper can find any late object.
      if (!saved.digest) tx.update(reservationRef, { digest });
      return attachment.data() as AttachmentDoc;
    });

    if (reserved.status === 'ready') {
      return { status: 200, body: { id: attachmentId, status: 'ready', ok: true, sizeBytes: reserved.sizeBytes, contentType: reserved.contentType } };
    }
    writing = true;
    try {
      await file.save(bytes, {
        resumable: false,
        timeout: MCP_UPLOAD_TIMEOUT_SECONDS * 1000,
        contentType: reserved.contentType,
        metadata: { metadata: { mcpSha256: digest } },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if (Number((error as { code?: number }).code) !== 412) throw error;
      const [metadata] = await file.getMetadata();
      if (metadata.metadata?.mcpSha256 !== digest) {
        throw new HttpsError('already-exists', 'Different bytes were already stored. Prepare a new upload.');
      }
    }
    const currentActor = await uploadActor(actor.uid);
    const result = await applyFinalizeAttachment(
      cardId, attachmentId, actor.uid, async (tx, boardId) => {
        const current = (await tx.get(reservationRef)).data() as UploadReservation | undefined;
        if (!current || current.cancelled || current.digest !== digest ||
          current.expiresAt + MCP_UPLOAD_TIMEOUT_SECONDS * 1000 <= Date.now()) {
          throw new HttpsError('not-found', 'The upload was cancelled.');
        }
        await checkUploadAccess(tx, boardId, currentActor);
      },
    );
    return { status: 200, body: { ...result, id: attachmentId, status: 'ready' } };
  } catch (error) {
    if (writing) {
      // Clean up immediately if possible. The reservation lets the sweep retry
      // even if the process dies before this check.
      const [attachment, reservation] = await Promise.all([attachmentRef.get(), reservationRef.get()]);
      if (!attachment.exists || (reservation.get('cancelled') === true && attachment.get('status') !== 'ready')) {
        await file.delete({ ignoreNotFound: true });
      }
    }
    const code = (error as { code?: unknown }).code;
    if (code === 'already-exists') return { status: 409, body: { error: (error as Error).message } };
    if (code === 'permission-denied') return { status: 403, body: { error: (error as Error).message } };
    if (code === 'auth/user-not-found') return { status: 403, body: { error: 'The uploader no longer has access to this card.' } };
    if (code === 'not-found' || Number(code) === 404) {
      return { status: 409, body: { error: 'The card or upload was removed. Prepare a new upload if the card still exists.' } };
    }
    throw error;
  }
}

// Keep buffered transfers on their own worker so a slow upload cannot
// occupy a slot used for queries and card edits.
export const mcpAttachmentUpload = onRequest({
  invoker: 'public', cors: true, memory: '256MiB', concurrency: 4, maxInstances: 3, timeoutSeconds: MCP_UPLOAD_TIMEOUT_SECONDS,
}, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const match = /^\/mcp\/attachments\/([A-Za-z0-9_-]{1,128})\/(mcp_[A-Za-z0-9]{20})$/.exec(req.path);
  if (req.method !== 'PUT' || !match) {
    res.status(404).json({ error: 'Upload not found.' });
    return;
  }
  const bytes = req.rawBody ?? Buffer.alloc(0);
  if (bytes.length > ATTACHMENT_MAX_BYTES) {
    res.status(413).json({ error: 'This file exceeds the attachment size limit.' });
    return;
  }
  try {
    const result = await receiveAttachment(match[1], match[2], req.get('authorization') ?? '', bytes);
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error('MCP attachment upload failed', { cardId: match[1], attachmentId: match[2], error: String(error) });
    res.status(500).json({ error: 'The upload could not finish. Retry the same upload URL.' });
  }
});

export function registerAttachmentTools({ server, run, me }: WriteTools, base: string) {
  server.registerTool('prepare_attachments', {
    description: 'Prepare uploads for an existing card or retry preparation. PUT each file’s raw bytes to its upload_url with the supplied headers.',
    inputSchema: { card_id: docId, attachments: attachmentInputs },
  }, (f) => run(async () => writeResult({ card_id: f.card_id, attachments: await prepareAttachments(base, me, f.card_id, f.attachments) })));

  server.registerTool('get_attachment_url', {
    description: 'Get a temporary download URL for a ready attachment. Find its id with query_cards include.attachments.',
    inputSchema: { card_id: docId, attachment_id: docId },
  }, (f) => run(async (fs: Firestore) => {
    // A rules-checked read of this subcollection authorizes signing its URL.
    const snap = await getDoc(doc(fs, 'cards', f.card_id, 'attachments', f.attachment_id));
    if (!snap.exists()) throw new Error('No such attachment.');
    return writeResult(await readyAttachmentUrl(f.card_id, f.attachment_id));
  }));
}
