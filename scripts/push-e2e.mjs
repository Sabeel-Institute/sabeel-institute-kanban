/**
 * EVERY KIND OF NOTIFICATION, TAPPED ON THE WEB, OPENS ITS SUBJECT.
 *
 *   bash scripts/e2e.sh scripts/push-e2e.mjs
 *
 * The real service worker (`app/public/firebase-messaging-sw.js`), in Chromium:
 * for each event the notification functions send (`NOTIFY_EVENTS`), a push in
 * FCM's own JSON shape is DELIVERED to the worker (DevTools'
 * `ServiceWorker.deliverPushMessage`, which runs the worker's real `push`
 * handler), the banner it draws is read back with its data, and a
 * `notificationclick` is dispatched on THAT notification inside the worker. The
 * app must then land on the notification's subject, and the inbox entry the
 * push names must be marked read. A real person's click is the one step this
 * does not make: no browser lets a script click its notification tray.
 *
 * Both ends of a click are covered: with the app open (the worker posts the
 * open tab where to go) and with no tab open, where the worker opens a new one
 * at `subjectUrl` — computed by the worker's own function and loaded here, since
 * a script may not open a window from a click it dispatched itself.
 *
 * It also holds the web to having no minimum-version floor: with the floor
 * raised past this build, the web app still runs (`useMinVersion`).
 *
 * Full Chromium, not the headless shell: the shell refuses notification
 * permission, so the worker could draw nothing.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { NOTIFY_EVENTS, notificationText } from '@sabeel/shared';
import { PORTS, PROJECT } from './lib/emulators.mjs';
import { settle, tryAgainTally } from './lib/signin.mjs';
import { agreeToRules } from './lib/rules.mjs';

const tally = tryAgainTally();
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORTS.web}/`;
const ORIGIN = new URL(BASE).origin;
const ROOT = resolve(import.meta.dirname, '..');
process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}
const visible = (locator, timeout = 20000) =>
  locator.first().waitFor({ timeout }).then(() => true, () => false);
async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value || Date.now() > end) return value;
    await new Promise((r) => setTimeout(r, 300));
  }
}

const grant = (email) =>
  new Promise((res, rej) => {
    const c = spawn('node', [resolve(ROOT, 'scripts/grant-admin.mjs'), email], { env: { ...process.env }, stdio: 'pipe' });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`grant-admin ${code}`))));
  });

const browser = await chromium.launch({ channel: 'chromium' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.grantPermissions(['notifications'], { origin: ORIGIN });
const page = await context.newPage();

// ---- an admin, signed in --------------------------------------------------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('Dev sign-in (emulator only)').waitFor({ timeout: 20000 });
await page.getByRole('button', { name: 'faisal', exact: true }).click();
tally.note('faisal', await settle(page, page.getByText('Waiting for approval')));
await grant('faisal@oursabeel.com');
await agreeToRules(page);

// ---- the seed: a card per kind, an inbox entry per push, a pending colleague
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const uid = (await db.collection('users').get()).docs.find((d) => d.data().email === 'faisal@oursabeel.com').id;
const now = Date.now();
const BOARD = 'push_board';
const BOARD_NAME = 'Notification taps';
await db.doc(`boards/${BOARD}`).set({
  name: BOARD_NAME, description: '', archived: false,
  columns: [{ id: 'todo', name: 'To Do' }], columnIds: ['todo'],
  memberUids: [uid], boardOwnerUids: [uid],
  memberProfiles: { [uid]: { displayName: 'Faisal', email: 'faisal@oursabeel.com' } },
  activeCardCount: NOTIFY_EVENTS.length, createdAt: now, createdBy: uid,
});
const PENDING = { uid: 'push_pending', email: 'pending-push@oursabeel.com', name: 'Pending Colleague' };
await db.doc(`users/${PENDING.uid}`).set({
  displayName: PENDING.name, email: PENDING.email, status: 'pending', role: 'member',
  notifyPrefs: {}, mutedBoardIds: [], favoriteBoardIds: [], recentBoardIds: [], unreadNotifCount: 0, createdAt: now,
});

/** What the server sends for one event (functions/src/notifications.ts), and where its tap must land. */
const cases = [];
for (const [i, { event }] of NOTIFY_EVENTS.entries()) {
  const forCard = event !== 'newUserPending';
  const cardId = `push_${event}`;
  const cardTitle = `Tapped from ${event}`;
  if (forCard) {
    await db.doc(`cards/${cardId}`).set({
      boardId: BOARD, title: cardTitle, description: '', columnId: 'todo', rank: `a${i}`,
      priority: 'none', assigneeUids: [uid], subscriberUids: [], labelIds: [], archived: false,
      commentCount: 0, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid,
    });
  }
  const notif = db.collection(`users/${uid}/notifications`).doc();
  await notif.set({
    type: event, boardId: forCard ? BOARD : '', ...(forCard ? { cardId } : {}),
    actorUid: 'push_actor', text: 'seeded', read: false, at: now,
  });
  cases.push({
    event,
    notifRef: notif,
    payload: {
      notification: { title: 'Sabeel Kanban', body: notificationText({ event, actorName: 'Sara', cardTitle }) },
      data: { type: event, boardId: forCard ? BOARD : '', ...(forCard ? { cardId } : {}), notifId: notif.id },
    },
    // A card opens on its own screen, proven by a control only that screen has
    // and by its title; the pending colleague is on People alone.
    landed: forCard
      ? async (p) => (await visible(p.getByRole('button', { name: 'Share card' })))
        && visible(p.getByText(cardTitle, { exact: true }), 5000)
      : async (p) => visible(p.getByText(PENDING.email, { exact: true })),
  });
}
await db.doc(`users/${uid}`).update({ unreadNotifCount: cases.length * 2 });

// ---- the worker -----------------------------------------------------------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
});
const worker = context.serviceWorkers().find((w) => w.url().endsWith('/firebase-messaging-sw.js'))
  ?? (await context.waitForEvent('serviceworker'));
const cdp = await context.newCDPSession(page);
const registrations = new Map();
cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations: list }) => {
  for (const r of list) if (!r.isDeleted) registrations.set(r.scopeURL, r.registrationId);
});
await cdp.send('ServiceWorker.enable');
const registrationId = await until(() => registrations.get(`${ORIGIN}/`), 10000);
check('the worker is registered at the origin root', Boolean(registrationId));

/** The banners the worker is showing, with their data. */
const shown = () =>
  worker.evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, data: n.data })));

/** Back to the boards list, so every tap has to navigate to be seen to work. */
async function home(p) {
  await p.goto(BASE, { waitUntil: 'networkidle' });
  return visible(p.getByText(BOARD_NAME, { exact: true }), 30000);
}

for (const c of cases) {
  console.log(`\n${c.event}`);
  // -- the app open: the worker draws the push, the tap is posted to the tab --
  check(`${c.event}: the app is on its boards before the tap`, await home(page));
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: ORIGIN, registrationId, data: JSON.stringify(c.payload) });
  const banner = await until(async () => (await shown()).find((n) => n.data?.notifId === c.payload.data.notifId));
  check(`${c.event}: the push is shown, with its words and its routing data`,
    Boolean(banner) && banner.body === c.payload.notification.body
      && JSON.stringify(banner.data) === JSON.stringify(c.payload.data),
    JSON.stringify(banner));
  await worker.evaluate(async (notifId) => {
    const n = (await self.registration.getNotifications()).find((x) => x.data?.notifId === notifId);
    // eslint-disable-next-line no-undef -- runs in the worker, where it is a global
    self.dispatchEvent(new NotificationEvent('notificationclick', { notification: n }));
  }, c.payload.data.notifId);
  check(`${c.event}: tapping it opens its subject in the open tab`, await c.landed(page));
  check(`${c.event}: the tapped notification is closed`,
    await until(async () => !(await shown()).some((n) => n.data?.notifId === c.payload.data.notifId)));
  check(`${c.event}: its inbox entry is marked read`,
    await until(async () => (await c.notifRef.get()).data()?.read === true));

  // -- no tab open: the worker's own address for it, in a tab of its own ------
  await c.notifRef.update({ read: false });
  // eslint-disable-next-line no-undef -- the worker's own function, run in the worker
  const url = await worker.evaluate((data) => subjectUrl(data), c.payload.data);
  const fresh = await context.newPage();
  await fresh.goto(new URL(url, BASE).href, { waitUntil: 'networkidle' });
  check(`${c.event}: the address the worker opens lands on the subject (${url})`, await c.landed(fresh));
  check(`${c.event}: and its routing data leaves the address bar`,
    !new URL(fresh.url()).searchParams.has('notifId'), fresh.url());
  check(`${c.event}: and it is marked read from there too`,
    await until(async () => (await c.notifRef.get()).data()?.read === true));
  await fresh.close();
}

// ---- the web has no minimum-version floor ----------------------------------
console.log('\nminimum version');
await db.doc('config/app').set({ minVersionCode: 999999999 });
check('with the floor raised past this build, the web app still runs',
  (await home(page)) && !(await page.getByText('Update needed').count()));
await db.doc('config/app').delete();

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`  ${tally.summary()}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log(`FAILED: ${f.name}`);
  process.exit(1);
}
