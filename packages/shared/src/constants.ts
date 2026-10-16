/**
 * Cross-surface constants. Anything both the app and functions must agree on
 * lives here — never duplicated on either side.
 */
import type { Priority } from './types';

/**
 * The only domain permitted to sign in.
 *
 * This constant is the authority for the SERVER-SIDE check, and as of 2026-07-19
 * it is the ONLY thing enforcing the domain: the OAuth consent screen is
 * External (Internal needs a Cloud organization, which the project does not
 * belong to). The client `hd` hint is a convenience, never a boundary.
 * See docs/PRODUCT_BRIEF.md, "Domain restriction is a server-side check".
 */
export const ALLOWED_EMAIL_DOMAIN = 'oursabeel.com';

/**
 * The single timezone concept in the app. Due dates are all-day `YYYY-MM-DD`
 * strings, so this only decides what "today" means for overdue highlighting and
 * due-soon reminders. Deliberately NOT the per-entry work-local timezone
 * machinery the sibling time-tracker needed.
 */
// Houston. This was 'America/New_York' — an hour out, and wrong in a way nothing
// surfaced: due dates are all-day strings, so the only symptoms were a card
// turning overdue an hour early and the "due soon" reminder arriving at 07:00
// local instead of 08:00. Neither looks like a bug, which is why it survived.
//
// The sibling time-tracker has no equivalent constant to keep in step — it
// buckets per entry in the timezone where the work happened (entry.timeZone),
// deliberately. So there is nothing to sync; there is only this one value, and
// it must match where the team actually is.
export const ORG_TIMEZONE = 'America/Chicago';

/** Columns every new board starts with. All renameable and removable. */
export const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'] as const;

/** Recent boards kept on the user doc, so the list syncs between phone and web. */
export const MAX_RECENT_BOARDS = 10;

/**
 * Field-length caps. These MUST match the sizes hard-coded in `firestore.rules`
 * (rules cannot import TypeScript). The rules remain the enforcement; the client
 * uses these to cap inputs so a normal action never fails with a raw
 * `permission-denied`. `BOARD_NAME_MAX` lives in `boards.ts` next to
 * `validateBoardName`.
 */
export const CARD_TITLE_MAX = 200;
export const COMMENT_BODY_MAX = 5000;
/** Generous, but bounded — a card is re-downloaded on every board-list snapshot. */
export const CARD_DESCRIPTION_MAX = 20000;

/**
 * The length the RULES will measure, which is not the length someone typed.
 *
 * `firestore.rules` caps the STORED string; the old client `maxLength` capped
 * typed characters. With markdown those diverge — `**bold**` is four characters
 * more than "bold" — so every counter, gate and pre-check goes through this one
 * function rather than each guessing.
 *
 * There is a documented past failure here: a programmatically-built value
 * exceeded the cap and the only symptom was a bare `permission-denied`. The
 * rule is that the UI refuses BEFORE the write, and the writers assert as a
 * last resort.
 */
export function storedLength(markdown: string): number {
  return markdown.length;
}
/** Also mirrored in `storage.rules`; a drift-guard test asserts the two agree. */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
/** The name ends up in a Content-Disposition header, so it is bounded twice. */
export const ATTACHMENT_NAME_MAX = 255;

/**
 * How long an attachment's signed URL stays valid.
 *
 * Minted per tap and never cached: an attachment is opened immediately, so there
 * is no refresh machinery to build. An hour rather than minutes because a PDF
 * left open in a browser viewer keeps issuing range requests — and an expired
 * GCS signed URL answers **HTTP 400 `ExpiredToken`**, not 403, so the viewer
 * simply goes blank with nothing the reader can act on.
 */
export const ATTACHMENT_URL_TTL_MS = 60 * 60 * 1000;

/**
 * How long an attachment may sit in `status: 'uploading'` before the sweeper
 * treats it as abandoned and deletes the document with its bytes.
 *
 * Generous on purpose: the failure this cleans up is a closed tab or a killed
 * app mid-upload, and deleting someone's slow-but-live upload would be worse
 * than paying for a stray object for another day.
 */
export const ATTACHMENT_UPLOAD_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * The project id the emulators run under. Everything server-side —
 * `firebase emulators:exec --project`, the Functions runtime, the Admin SDK in
 * scripts and tests — uses this id.
 *
 * THE CLIENT MUST USE IT TOO. The Firestore emulator partitions data by project
 * id, so a client configured with a different id talks to a *different database
 * inside the same emulator*. The symptom is brutal to diagnose: writes succeed,
 * the trigger logs success, and the client's listener returns a server snapshot
 * (fromCache=false) saying the document does not exist — because in its
 * namespace, it doesn't. Cost an hour on 2026-07-19.
 *
 * It lives here rather than in the app because functions need it too, to decide
 * whether they may take the emulator branch of the signed-URL seam.
 */
export const EMULATOR_PROJECT_ID = 'demo-sabeel-kanban';

/**
 * The phone apps' id: the Android package and the iOS bundle id, one value.
 *
 * Apple's push service is addressed by it — the `apns-topic` of every iPhone
 * notification, refused unless it is the bundle the device token was issued
 * to — so the server needs it as much as the builds do. `app/app.json` must say
 * the same; functions/test/unit/apns.test.ts holds the two together.
 */
export const APP_ID = 'com.sabeelinstitute.kanban';

/**
 * Cloud Storage buckets, stated explicitly on every surface.
 *
 * Neither side can be trusted to work one out for itself. The Admin SDK throws
 * "Bucket name not specified" when the functions emulator supplies nothing, and
 * `FIREBASE_CONFIG.storageBucket` has been seen to carry a legacy
 * `<project>.appspot.com` name for projects on the modern default-bucket naming
 * — a bucket that does not exist here.
 *
 * The client needs the emulator name overridden too, not just the project id.
 * Leaving the real bucket in an emulator build uploads to a bucket the server
 * never looks in, and the only symptom is `finalizeAttachment` reporting no file
 * found for an upload that plainly succeeded.
 */
export const STORAGE_BUCKET = 'sabeel-institute-kanban.firebasestorage.app';
export const EMULATOR_STORAGE_BUCKET = `${EMULATOR_PROJECT_ID}.firebasestorage.app`;

/**
 * The **WEB** OAuth client id, from `google-services.json` (`client_type: 3`).
 * Public, not a secret — see CLAUDE.md, "Client-side non-secrets".
 *
 * Two surfaces must agree on this exact string or sign-in breaks in ways that do
 * not name it:
 *  - the app passes it to `GoogleSignin.configure({ webClientId })`, and passing
 *    the *Android* id instead is the classic source of `DEVELOPER_ERROR`;
 *  - `accountExists` verifies the resulting ID token's **audience** against it,
 *    which is what stops a token minted for some other app being replayed here.
 *
 * So it lives here rather than in the app, for the same reason
 * `EMULATOR_PROJECT_ID` does: functions need it too, and the app and functions
 * must never each hold their own copy of a value they have to agree on.
 */
/**
 * The public pages, served as static files outside the app bundle.
 *
 * ABSOLUTE, because the native apps open them too — Apple 5.1.1(i) requires the
 * privacy policy to be reachable *inside* the app, not only from store metadata.
 * A relative path would resolve against nothing on a phone.
 *
 * `PRIVACY_URL` is linked from the app. `GET_APP_URL` deliberately is NOT: it
 * carries the "sign in on the website first" instruction, and an app pointing at
 * that is the second of the two triggers that would put these apps back inside
 * the stores' account-creation rule. See docs/STORE-RELEASE.md.
 */
const WEB_APP_ORIGIN = 'https://sabeel-institute-kanban.web.app';
export const PRIVACY_URL = `${WEB_APP_ORIGIN}/privacy`;
export const SUPPORT_URL = `${WEB_APP_ORIGIN}/support`;
export const GET_APP_URL = `${WEB_APP_ORIGIN}/get-app`;

export const GOOGLE_WEB_CLIENT_ID =
  '826656438175-if1oi85tn29orcmkaenlsg9r7eca9nha.apps.googleusercontent.com';

/**
 * Every collection holding data worth noticing the loss of — the inventory the
 * `healthCheck` canary counts (functions/src/health.ts).
 *
 * `root` collections are counted with `db.collection(name)`; `group` ones live
 * under a parent (`cards/{id}/comments`, `users/{uid}/notifications`) and can only
 * be counted across the whole database with `db.collectionGroup(name)`. Getting
 * this wrong does not error — a `collection('comments')` query simply counts the
 * non-existent top-level path and returns 0 forever, which is a canary that
 * reports perfect health while seeing nothing.
 *
 * `pushTokens` is deliberately absent: device tokens rotate constantly, and every
 * device re-registers its token on next launch, so a drop is neither alarming nor
 * permanent — counting it would only add noise to the signal.
 */
export const COLLECTIONS = {
  users: 'root',
  boards: 'root',
  cards: 'root',
  labels: 'root',
  comments: 'group',
  activity: 'group',
  attachments: 'group',
  notifications: 'group',
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

/**
 * Every priority, weakest first — the order they are offered in.
 *
 * `'none'` is one of the five VALUES, not the absence of one: a card always
 * carries a priority, and "None" is a thing you can filter to. Listed here
 * rather than in each screen because the card editor and the search filter must
 * offer the same set in the same order, and two literals drift.
 */
export const PRIORITIES: readonly Priority[] = [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
];

/** A priority as a person reads it: `urgent` → `Urgent`. */
export function priorityLabel(priority: Priority): string {
  return priority[0].toUpperCase() + priority.slice(1);
}
