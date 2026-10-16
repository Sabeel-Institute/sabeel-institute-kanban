/**
 * The signed-in session: who you are, and what you may do.
 *
 * The subtle part is claim freshness. Custom claims live in the ID token, and a
 * token is only refreshed when it expires (up to an hour) or on an explicit
 * force-refresh. So when an admin approves someone, that person keeps a token
 * saying `pending` and stays locked out — which reads as "the admin approved me
 * and nothing happened".
 *
 * The fix: setUserAccess stamps `claimsUpdatedAt` on the user doc, this module
 * watches its own doc, and force-refreshes the token whenever that stamp moves.
 * Approval un-gates the app within a second, with no sign-out.
 *
 * This file is exempt from the useLiveQuery lint rule (see eslint.config.mjs):
 * it owns the auth lifecycle and does its own reset, and useLiveQuery is a hook
 * that cannot be used from a module-level auth listener.
 */
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut, type User } from 'firebase/auth';
import { googleSignOut } from './auth/google';
import { lookUpAccount } from './auth/accountLookup';
import { freshConnection } from './freshConnection';
import { registerPush, unregisterPush } from './notify';
import { doc, onSnapshot, type DocumentSnapshot } from 'firebase/firestore';
import { clearLiveResultCache } from './liveQuery';
import { resetAllViewStores } from './viewState';
import { clearStatsCache } from './stats';
import {
  canAdministerUsers,
  canCreateBoards,
  canUseApp,
  canViewStats,
  hasAcceptedRules,
  sessionAccess,
} from '@sabeel/shared';
import type { Role, UserStatus } from '@sabeel/shared';
import { auth, db } from './firebase';
import { IS_DEV } from './env';

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string | null;
  role: Role;
  status: UserStatus;
  /**
   * Whether this account has accepted the institute's rules at the current
   * version. Until it has, an active account sees the rules screen and nothing
   * else (App.tsx). From the user document, which only the acceptRules
   * callable writes, so it moves live — the same snapshot that un-gates an
   * approval un-gates an acceptance, on every device the account is open on.
   */
  rulesAccepted: boolean;
}

export type Session =
  | { state: 'loading' }
  | { state: 'signed-out' }
  /**
   * Signed in, but the user doc has not arrived yet. `slow` once it has been
   * missing for PROVISIONING_PATIENCE_MS on an account Auth says exists: never
   * a refusal, the screen says "still setting up" and offers Try again
   * (`retryProvisioning`, a fresh connection), and the listener and Auth
   * keep being asked meanwhile.
   */
  | { state: 'provisioning'; uid: string; slow: boolean }
  /**
   * The server REFUSED the account: the auth-create trigger deleted it (a
   * non-org address), which Auth itself confirms (`lookUpAccount`). Only that
   * answer leads here — never a profile that is merely late, which is
   * `provisioning` with `slow`.
   */
  | { state: 'not-provisioned'; uid: string }
  | { state: 'signed-in'; user: SessionUser };

type Listener = (s: Session) => void;

let current: Session = { state: 'loading' };
const listeners = new Set<Listener>();

function emit(next: Session) {
  current = next;
  listeners.forEach((l) => l(next));
}

let unsubUserDoc: (() => void) | null = null;
let lastClaimsStamp: number | null = null;
let provisioningTimer: ReturnType<typeof setTimeout> | null = null;
/** Which uid this device has already registered a push token for. */
let pushRegisteredFor: string | null = null;
/** When the current wait for a profile began; it starts over on Try again. */
let waitStartedAt = 0;
/** An Auth lookup in flight, so two cannot overlap. */
let looking = false;

/**
 * The wait for a new account's profile, which the auth-create trigger writes.
 *
 * Until 2026-10-16 a timeout meant "refused": ten seconds without the user doc
 * showed **Wrong account**. Two things made that wrong for genuine accounts. A
 * cold start of the trigger can take longer than that in production. And the
 * listener can miss the profile altogether: measured against the Firestore
 * emulator (21 of 48 cold first sign-ins, 2026-10-16), when the trigger writes
 * the doc while the client's listen for it is still being registered, the
 * listener answers "does not exist" and never hears of the write. Listening
 * again, a direct read from the server, a token refresh and a plain page
 * reload all kept the stale answer, which sticks to the listen target the
 * web's persistent cache keeps; a new target, from an emptied cache, hears
 * the server.
 *
 * So time alone refuses nobody. Auth is asked whether the account still
 * exists (`lookUpAccount`), first after FIRST_LOOK_MS and then every
 * LOOK_EVERY_MS: the trigger deletes an account it refuses, and only Auth
 * saying so is **Wrong account**. Past PROVISIONING_PATIENCE_MS the screen
 * says "still setting up" with Try again, a fresh connection
 * (`freshConnection`: on the web the cache emptied and the page reloaded). The
 * same design as the sibling time tracker's.
 */
const FIRST_LOOK_MS = 3_000;
const LOOK_EVERY_MS = 5_000;
export const PROVISIONING_PATIENCE_MS = 15_000;

function stopWatchingUserDoc() {
  unsubUserDoc?.();
  unsubUserDoc = null;
  lastClaimsStamp = null;
  if (provisioningTimer) {
    clearTimeout(provisioningTimer);
    provisioningTimer = null;
  }
}

/** Still waiting for this account's profile, keeping whether it is already slow. */
function emitProvisioning(uid: string) {
  const slow = current.state === 'provisioning' && current.uid === uid && current.slow;
  emit({ state: 'provisioning', uid, slow });
}

/** The next look at Auth, unless one is already due or under way. */
function armProvisioningLook(uid: string, delay = LOOK_EVERY_MS) {
  if (provisioningTimer || looking) return;
  provisioningTimer = setTimeout(() => {
    provisioningTimer = null;
    void lookAtAccount(uid);
  }, delay);
}

/** Begin (or begin again) the wait for this account's profile. */
function startProvisioningWait(uid: string) {
  waitStartedAt = Date.now();
  emit({ state: 'provisioning', uid, slow: false });
  armProvisioningLook(uid, FIRST_LOOK_MS);
}

/**
 * One look: does the account still exist? Deleted is the refusal; otherwise
 * keep waiting, saying "still setting up" once the wait has run past
 * PROVISIONING_PATIENCE_MS. An answer Auth could not give is never a refusal.
 */
async function lookAtAccount(uid: string): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || fbUser.uid !== uid || current.state !== 'provisioning' || current.uid !== uid) return;
  looking = true;
  let account: Awaited<ReturnType<typeof lookUpAccount>>;
  try {
    account = await withTimeout(lookUpAccount(fbUser), 8000, 'account lookup').catch(() => 'unknown' as const);
  } finally {
    looking = false;
  }
  // Settled while asking: the profile arrived, or the person signed out.
  if (current.state !== 'provisioning' || current.uid !== uid) return;
  if (account === 'deleted') {
    stopWatchingUserDoc();
    emit({ state: 'not-provisioned', uid });
    return;
  }
  if (!current.slow && Date.now() - waitStartedAt >= PROVISIONING_PATIENCE_MS) {
    emit({ state: 'provisioning', uid, slow: true });
  }
  armProvisioningLook(uid);
}

/**
 * Try again, from "Still setting up your account": the wait over again, on a
 * fresh connection to the database (`freshConnection`: the cache emptied and
 * the page reloaded on the web, the connection closed and reopened on a
 * phone), so whatever held the profile back does not carry over.
 */
export async function retryProvisioning(): Promise<void> {
  const fbUser = auth.currentUser;
  if (!fbUser || current.state !== 'provisioning') return;
  stopWatchingUserDoc();
  startProvisioningWait(fbUser.uid);
  await freshConnection();
  if (auth.currentUser !== fbUser) return;
  watchUserDoc(fbUser);
}

/**
 * Read role/status from the TOKEN, not the user doc. The doc is a mirror for
 * display; rules trust the token, so the UI must agree with the token or people
 * will see buttons that always fail.
 */
/** Reject rather than hang forever — see readClaims. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function readClaims(
  fbUser: User,
  forceRefresh: boolean,
): Promise<{ role: Role; status: UserStatus }> {
  let token;
  try {
    // A forced refresh is a network round trip, and a network call with no
    // timeout is a hang waiting to happen. Neither a failure NOR a hang may
    // strand the user on the "Setting up your account…" spinner, so bound it and
    // fall back to the cached token — they keep their previous access level
    // until the next snapshot retries, which is far better than an app that
    // never renders.
    token = await withTimeout(
      fbUser.getIdTokenResult(forceRefresh),
      forceRefresh ? 8000 : 4000,
      'token refresh',
    );
  } catch (e) {
    console.warn('token refresh failed, falling back to cached claims', e);
    try {
      token = await withTimeout(fbUser.getIdTokenResult(false), 4000, 'cached token');
    } catch {
      return { role: 'member', status: 'pending' };
    }
  }
  // As the SESSION allows, the rule the rules and the callables apply
  // (sessionAccess): a password sign-in is a member, and for any address but
  // the one, has no access at all.
  return sessionAccess(
    { role: token.claims.role, status: token.claims.status },
    { signInProvider: token.signInProvider, email: fbUser.email },
  );
}

async function handleUserSnapshot(fbUser: User, snap: DocumentSnapshot): Promise<void> {
  // Dev-only breadcrumb. When the gate misbehaves the first question is always
  // "did the snapshot arrive, and from cache or the server?" — those two
  // booleans separate "never arrived", "stale cache" and "the server really says
  // no". They are what identified the emulator project-id mismatch on
  // 2026-07-19 (docs/INHERITED-STACK.md lesson 8) after two runs of guessing.
  if (IS_DEV) {
    console.warn(
      `[session] snapshot exists=${snap.exists()} fromCache=${snap.metadata.fromCache} uid=${fbUser.uid}`,
    );
  }
  if (!snap.exists()) {
    // The auth-create trigger has not finished yet, or it rejected the account
    // and is about to delete it — or the listener missed the write. The looks
    // at Auth tell a refusal from a wait; Try again cures a missed write.
    emitProvisioning(fbUser.uid);
    armProvisioningLook(fbUser.uid, FIRST_LOOK_MS);
    return;
  }

  // The doc arrived, so provisioning succeeded — stand the timer down.
  if (provisioningTimer) {
    clearTimeout(provisioningTimer);
    provisioningTimer = null;
  }

  const data = snap.data() ?? {};
  const stamp: number | null =
    typeof data.claimsUpdatedAt?.toMillis === 'function'
      ? data.claimsUpdatedAt.toMillis()
      : null;

  // Force a token refresh when the server says the claims moved. The FIRST
  // sighting always refreshes too: the trigger sets claims after sign-in, so the
  // token in hand predates them and would still say "no claims at all".
  const claimsChanged = lastClaimsStamp === null || stamp !== lastClaimsStamp;
  lastClaimsStamp = stamp;

  const claims = await readClaims(fbUser, claimsChanged);

  emit({
    state: 'signed-in',
    user: {
      uid: fbUser.uid,
      email: (data.email as string) ?? fbUser.email ?? '',
      displayName: (data.displayName as string) ?? fbUser.displayName ?? '',
      photoUrl: (data.photoUrl as string | null) ?? null,
      role: claims.role,
      status: claims.status,
      rulesAccepted: hasAcceptedRules(data),
    },
  });

  // Register this device for push once, on the first signed-in snapshot. The
  // user doc emits repeatedly (claims refresh, profile edits, prefs changes) and
  // re-registering on each would rewrite the same token document for no reason.
  //
  // This never prompts — it only claims a token for a device that is already
  // permitted. Asking here is what broke web push: a snapshot callback is not a
  // user gesture, so the request was refused silently. Android would have
  // allowed it, which is worse rather than better — it put the system dialog on
  // whatever screen sign-in happened to land on, and Android only offers that
  // dialog twice. The ask lives behind a press on both surfaces now: the nudge
  // card on Boards, or the notifications screen. See enablePush in either
  // notify.web.ts or notify.ts.
  //
  // Deliberately not awaited: notifications are best-effort, and nobody should
  // wait on FCM to reach their boards. registerPush never throws.
  if (pushRegisteredFor !== fbUser.uid) {
    pushRegisteredFor = fbUser.uid;
    void registerPush(fbUser.uid);
  }
}

function watchUserDoc(fbUser: User) {
  stopWatchingUserDoc();

  unsubUserDoc = onSnapshot(
    doc(db, 'users', fbUser.uid),
    (snap) => {
      // Deliberately NOT an async function passed straight to onSnapshot: an
      // unhandled rejection there would silently strand the app in
      // `provisioning` with no error surfaced anywhere.
      void handleUserSnapshot(fbUser, snap).catch((e) => {
        console.warn('user snapshot handler failed', e);
        emitProvisioning(fbUser.uid);
        armProvisioningLook(fbUser.uid, FIRST_LOOK_MS);
      });
    },
    (e) => {
      // A signed-in user can always read their own doc, so this is unexpected.
      // Try again subscribes afresh, so a dead listener is not the end of it.
      console.warn('user doc listener', e.code ?? e.message);
      emitProvisioning(fbUser.uid);
      armProvisioningLook(fbUser.uid, FIRST_LOOK_MS);
    },
  );
}

/**
 * Whose data the live-result cache currently holds.
 *
 * Sign-out is not the only way the current user changes: the SDK can swap one
 * signed-in user for another without an intervening null, and the cache is keyed
 * by query shape (boardId, cardId) rather than by person — so the incoming user
 * could be shown a frame of the outgoing one's board. Today's UI cannot reach
 * that (signing in is only offered while signed out, and the native flow signs
 * out of Google first), which makes this cheap insurance against a future entry
 * point rather than a live bug. Structural beats argued.
 */
let cachedFor: string | null = null;

onAuthStateChanged(auth, (fbUser) => {
  if (!fbUser) {
    stopWatchingUserDoc();
    // Drop any cached live-query results so a shared device does not flash the
    // previous user's board to whoever signs in next.
    clearLiveResultCache();
    resetAllViewStores();
    clearStatsCache();
    cachedFor = null;
    emit({ state: 'signed-out' });
    return;
  }
  if (cachedFor !== null && cachedFor !== fbUser.uid) {
    stopWatchingUserDoc();
    clearLiveResultCache();
    resetAllViewStores();
    clearStatsCache();
  }
  cachedFor = fbUser.uid;
  watchUserDoc(fbUser);
  startProvisioningWait(fbUser.uid);
});

/** The session now, without subscribing: for non-React readers and for tests. */
export function sessionNow(): Session {
  return current;
}

export function useSession(): Session {
  const [s, setS] = useState<Session>(current);
  useEffect(() => {
    listeners.add(setS);
    setS(current);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export async function signOut(): Promise<void> {
  stopWatchingUserDoc();
  // Before dropping the session: unregistering needs to know WHO to unregister,
  // and pushes target the device rather than the session — so a shared phone
  // would otherwise keep receiving the previous account's notifications.
  const uid = current.state === 'signed-in' ? current.user.uid : null;
  pushRegisteredFor = null;
  if (uid) await unregisterPush(uid).catch(() => undefined);
  // Sign out of Google too, not just Firebase. On native, Google remembers the
  // account and the next sign-in silently reuses it — so without this there is
  // no way to switch users, and "Sign out" only appears to work. No-op on web.
  await googleSignOut().catch(() => undefined);
  await fbSignOut(auth);
}

/**
 * Capability helpers, delegating to the shared logic the server enforces.
 *
 * ORG-WIDE questions only. `manageBoards` used to live here and answered three
 * different ones at once; board authority is per-board now and cannot be
 * answered without a board, so it is `canManageBoard(user, board)` from
 * @sabeel/shared, called at the point of use. A helper here that took no board
 * would be a button that always fails.
 */
export const sessionCan = {
  useApp: (u: SessionUser) => canUseApp(u),
  createBoards: (u: SessionUser) => canCreateBoards(u),
  viewStats: (u: SessionUser) => canViewStats(u),
  administerUsers: (u: SessionUser) => canAdministerUsers(u),
};
