import { collection, doc, orderBy, query, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import {
  attachmentStoragePath,
  normalizeContentType,
  sanitizeAttachmentName,
} from '@sabeel/shared';
import { db, functions, storage } from './firebase';
import { EMULATOR_HOST, USE_EMULATORS } from './env';
import { useLiveQuery } from './liveQuery';
import type { Untimed } from './slowWrites';
import type { SessionUser } from './session';

export interface Attachment {
  id: string;
  name: string;
  contentType: string;
  uploadedBy: string;
  uploadedAt: number;
  status: 'uploading' | 'ready';
  /** Server-read at finalize, so absent while the upload is in flight. */
  sizeBytes?: number;
}

/** What a picker hands back, on either platform. */
export interface PickedFile {
  blob: Blob;
  name: string;
  contentType: string;
}

// A subcollection UNDER the card, like comments, so attachments travel with it
// when it moves between boards. This is the single place these paths are built.
const attachmentsRef = (cardId: string) => collection(db, 'cards', cardId, 'attachments');

export function useAttachments(cardId: string) {
  return useLiveQuery<Attachment[]>(
    () => query(attachmentsRef(cardId), orderBy('uploadedAt')),
    [cardId],
    'attachments',
    (docs) =>
      docs.map((d) => ({
        id: d.id,
        name: (d.data.name as string) ?? 'file',
        contentType: (d.data.contentType as string) ?? 'application/octet-stream',
        uploadedBy: (d.data.uploadedBy as string) ?? '',
        uploadedAt: (d.data.uploadedAt as number) ?? 0,
        status: d.data.status === 'ready' ? 'ready' : 'uploading',
        sizeBytes: d.data.sizeBytes as number | undefined,
      })),
  );
}

const call =
  <I, O>(name: string) =>
  (input: I) =>
    httpsCallable<I, O>(functions, name)(input).then((r) => r.data);

type Ids = { cardId: string; attachmentId: string };

const finalize = call<Ids, { ok: true; sizeBytes: number }>('finalizeAttachment');
const remove = call<Ids, { ok: true; removed: boolean }>('deleteAttachment');
const mintUrl = call<Ids, { url: string; expiresAt: number; name: string; contentType: string }>(
  'getAttachmentUrl',
);

/**
 * Remove an attachment. A callable, never a client delete.
 *
 * `storage.rules` denies clients deleting objects, so a client `deleteDoc` would
 * remove the record and leave the bytes unreferenced, unreadable and billable
 * forever — and a delete trigger could not name who did it, which the activity
 * log needs.
 */
export async function removeAttachment(cardId: string, attachmentId: string): Promise<void> {
  await remove({ cardId, attachmentId });
}

/**
 * The functions emulator mints its object URLs against ITS OWN view of the
 * host, which is `127.0.0.1`. On an Android emulator that address is the DEVICE,
 * not the machine running the emulator suite, so opening a file died with
 * "Failed to connect to /127.0.0.1:9199" — a failure that reads as a broken
 * feature and is purely an addressing artefact.
 *
 * Only ever applied in emulator mode. A production URL is signed, and its
 * signature covers the host, so rewriting one would break it — which is exactly
 * why this is gated rather than unconditional.
 */
function reachableFromThisDevice(url: string): string {
  return USE_EMULATORS ? url.replace('127.0.0.1', EMULATOR_HOST) : url;
}

/** A fresh short-lived signed URL. Minted per open; never cached. */
export async function attachmentUrl(cardId: string, attachmentId: string): Promise<string> {
  return reachableFromThisDevice((await mintUrl({ cardId, attachmentId })).url);
}

function sendBytes(
  cardId: string,
  attachmentId: string,
  picked: PickedFile,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const task = uploadBytesResumable(
    ref(storage, attachmentStoragePath(cardId, attachmentId)),
    picked.blob,
    { contentType: picked.contentType },
  );
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      // Clamp to 1. React Native re-sends a chunk on a network hiccup, so
      // `bytesTransferred` can climb past `totalBytes` and the raw ratio reads
      // over 100% (~140% seen). The upload is fine; only the number lies. Web
      // never shows it, so this passes review and surfaces on a phone.
      (s) => onProgress(s.totalBytes ? Math.min(1, s.bytesTransferred / s.totalBytes) : 0),
      reject,
      () => resolve(),
    );
  });
}

/**
 * Put a file on a card: record, then bytes, then confirmation.
 *
 * The DOCUMENT goes first because creating it is what authorizes the upload —
 * Cloud Storage rules cannot read Firestore, so board membership can only be
 * proven by a rules-checked Firestore write. It also decides which way a failure
 * falls: this ordering leaves a visible, removable row, where uploading first
 * would leave invisible billable bytes.
 *
 * Every call mints a NEW id, including a retry. Objects are write-once, so
 * re-uploading to a path that already has bytes is refused, and an ordinary
 * retry would surface as an alarming permission error.
 */
export async function uploadAttachment(params: {
  cardId: string;
  picked: PickedFile;
  user: SessionUser;
  /** Fires before anything is awaited, so the caller can show the row at once. */
  onStart: (attachmentId: string) => void;
  onProgress: (attachmentId: string, fraction: number) => void;
  /**
   * Keeps the byte transfer out of the slow-write measurement — see
   * slowWrites.ts. REQUIRED rather than defaulted to identity: this has exactly
   * one call site, and an optional one is a thing to forget there.
   */
  untimed: Untimed;
}): Promise<void> {
  const { cardId, picked, user, onStart, onProgress, untimed } = params;
  const target = doc(attachmentsRef(cardId));
  const attachmentId = target.id;
  onStart(attachmentId);

  // Sanitise HERE as well as at finalize, for two reasons.
  //
  // The rules cap `name` at ATTACHMENT_NAME_MAX and a picker can hand back a
  // longer one, so an ordinary attachment would fail with a raw
  // `permission-denied` — exactly what the shared caps exist to prevent (see
  // the docblock on constants.ts). And the server sanitises anyway, so without
  // this the row would silently RENAME itself the moment the upload finished.

  // NOTE: `setDoc` resolves on SERVER ack, so offline this never returns and the
  // upload never starts. That is the right ordering — an unauthorized upload
  // should fail fast while online — but it means the caller must render the
  // pre-bytes state as "waiting", not as a spinner that is about to finish.
  // Both fields normalised with the SAME shared helpers the server uses at
  // finalize. The name for the reasons above; the content type because the row
  // picks its icon from it, so an unnormalised value shows one glyph during the
  // upload and a different one the instant the server rewrites it.
  const name = sanitizeAttachmentName(picked.name);
  await setDoc(target, {
    name,
    contentType: normalizeContentType(picked.contentType),
    uploadedBy: user.uid,
    uploadedAt: Date.now(),
    status: 'uploading',
  });

  try {
    // The transfer is UNTIMED and the two round trips either side are not: how
    // long 10MB takes is a fact about the connection, while `setDoc` and
    // `finalize` should be quick whatever the file weighs. Only the second kind
    // is worth an alert.
    await untimed(() =>
      sendBytes(cardId, attachmentId, picked, (f) => onProgress(attachmentId, f)),
    );
    await finalize({ cardId, attachmentId });
  } catch (e) {
    // Roll back through the callable — see removeAttachment for why a client
    // cannot clean up after itself here.
    await remove({ cardId, attachmentId }).catch(() => undefined);
    throw e;
  }
}
