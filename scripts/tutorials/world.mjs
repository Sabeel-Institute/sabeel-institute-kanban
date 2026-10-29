/**
 * THE GUIDE WORLD the help films are recorded in: three boards of ordinary
 * institute work, four people, labels, comments and a year of Stats —
 * written straight to the emulators with the Admin SDK, so it is the same to
 * the byte every time and takes seconds, not the minutes the UI seed takes.
 *
 *   node scripts/tutorials/world.mjs      # once, by hand, to look at it
 *
 * `record.mjs` builds it afresh before every film, so what one film changes —
 * a card archived, a person approved — is not in the next.
 *
 * The ACCOUNTS come from `scripts/dev.sh web`, whose seed signs faisal, sara
 * and omar in through the dev row: Auth keeps them, with their uids, while
 * Firestore is emptied under them. This sets their claims and rewrites their
 * profiles each time, so a film that changed a role changes nothing after it.
 * Amina is made here, with no way to sign in: she is who the People film
 * approves.
 *
 * Counters the triggers keep — a board's `activeCardCount`, a card's
 * `commentCount`, the unread counts, today's Stats — are written as zero and
 * left to the triggers, exactly as the app's own writes leave them.
 * The names are the fixtures every Sabeel suite uses; none is a real person.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { RULES_VERSION, addDays, initialRanks, todayInOrgTz } from '@sabeel/shared';
import { PORTS, PROJECT } from '../lib/emulators.mjs';

process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();

/** Who is in the world, and as what. Amina is waiting to be let in. */
const PEOPLE = {
  faisal: { name: 'Faisal', role: 'admin', status: 'active' },
  sara: { name: 'Sara', role: 'organizer', status: 'active' },
  omar: { name: 'Omar', role: 'member', status: 'active' },
  amina: { name: 'Amina', role: 'member', status: 'pending' },
};

const email = (who) => `${who}@oursabeel.com`;

/**
 * The boards, by fixed id so a film can open one by link (`/b/<id>`). Each
 * column is [id, name, cards]; each card is [id, title, extra fields].
 */
const BOARDS = [
  {
    id: 'fundraising',
    name: 'Fundraising 2026',
    createdBy: 'faisal',
    owners: ['faisal', 'sara'],
    members: ['faisal', 'sara', 'omar'],
    columns: [
      ['todo', 'To Do', [
        ['venue', 'Book the venue', { assignees: ['omar'], due: -2, priority: 'urgent', labels: ['events'] }],
        ['caterer', 'Confirm the caterer', { assignees: ['omar'], due: 0, priority: 'high', labels: ['events'] }],
        ['letter', 'Draft the donor letter', {
          assignees: ['omar', 'sara'], due: 3, priority: 'medium', labels: ['donors'],
          description:
            "A one-page letter for this year's donors.\n\n" +
            '- Thank them for **last year**\n- Share the target and what it pays for\n- Invite them to the dinner\n\n' +
            "Last year's letter is in the [shared drive](https://example.org/donor-letter).",
          comments: [
            ['sara', "I've started an outline. @omar, could you add the figures from last year?", ['omar']],
            ['faisal', "Looks good. Let's keep it to one page.", []],
          ],
        }],
        ['programmes', 'Order the printed programmes', { due: 10, priority: 'low', labels: ['events'] }],
        ['thanks', 'Write the thank-you cards', {}],
        ['raffle', 'Raffle prizes from last year', { archived: true }],
      ]],
      ['doing', 'In Progress', [
        ['programme', 'Design the programme', { assignees: ['sara'], due: 12, priority: 'low', labels: ['events'], parent: 'letter' }],
        ['pledges', 'Chase outstanding pledges', { assignees: ['faisal'], due: 5, priority: 'high', labels: ['donors'] }],
      ]],
      ['waiting', 'Waiting', [
        ['sound', 'Quote for the sound system', { assignees: ['omar'], due: 6, priority: 'medium' }],
      ]],
      ['done', 'Done', [
        ['target', 'Set the fundraising target', { assignees: ['faisal'] }],
        ['date', 'Pick the date', {}],
      ]],
    ],
  },
  {
    id: 'weekend-school',
    name: 'Weekend School',
    createdBy: 'sara',
    owners: ['sara'],
    // Faisal is not on it: he is who the members film adds.
    members: ['sara', 'omar'],
    columns: [
      ['todo', 'To Do', [
        ['timetable', 'Plan the spring term timetable', { assignees: ['sara'], due: 7, priority: 'high' }],
        ['textbooks', 'Order new textbooks', { assignees: ['omar'], due: 4, priority: 'medium', labels: ['supplies'] }],
        ['volunteers', 'Recruit two more volunteers', { labels: ['volunteers'] }],
      ]],
      ['doing', 'In Progress', [
        ['handbook', 'Update the parent handbook', { assignees: ['omar'], due: 2, priority: 'medium' }],
      ]],
      ['done', 'Done', [
        ['welcome', 'Send the welcome email', { assignees: ['sara'] }],
      ]],
    ],
  },
  {
    id: 'website',
    name: 'Website Refresh',
    createdBy: 'faisal',
    owners: ['faisal'],
    members: ['faisal', 'omar'],
    columns: [
      ['todo', 'To Do', [
        ['about', 'Write the new About page', { assignees: ['omar'], due: 6, priority: 'medium' }],
        ['photos', 'Collect photos from the open day', { labels: ['events'] }],
      ]],
      ['doing', 'In Progress', [
        ['theme', 'Choose a new theme', { assignees: ['faisal'], priority: 'low' }],
      ]],
      ['done', 'Done', []],
    ],
  },
];

/** The org-wide labels, from the fixed swatch set every Sabeel app offers. */
const LABELS = [
  ['events', 'Events', '#C2611F'],
  ['donors', 'Donors', '#83114F'],
  ['supplies', 'Supplies', '#3E6B8A'],
  ['volunteers', 'Volunteers', '#4E7A43'],
];

/** The card id a film opens by link: `/c/<id>`. */
export const cardId = (boardId, key) => `${boardId}-${key}`;

/** Every account the world needs, by name → uid. Made once; Auth keeps them across worlds. */
async function accounts() {
  const uids = {};
  for (const [who, p] of Object.entries(PEOPLE)) {
    let user = await auth.getUserByEmail(email(who)).catch(() => null);
    if (!user) {
      if (who !== 'amina') {
        throw new Error(`${email(who)} has no account: start the stack with scripts/dev.sh web, whose seed signs it in`);
      }
      user = await auth.createUser({ email: email(who), displayName: p.name, emailVerified: true });
    }
    uids[who] = user.uid;
  }
  return uids;
}

/** Firestore emptied: every document, every collection. Auth is left alone. */
async function emptyFirestore() {
  const url = `http://127.0.0.1:${PORTS.firestore}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const r = await fetch(url, { method: 'DELETE' });
  if (!r.ok) throw new Error(`could not empty Firestore: ${r.status}`);
}

/** The year of Stats an admin's film reads: quiet weekends, busier weekdays, the same every time. */
async function writeStats(uids) {
  const today = todayInOrgTz();
  const actorsFor = (n) => [uids.faisal, uids.sara, uids.omar].slice(0, n);
  const months = new Map();
  const boardMonths = new Map(BOARDS.map((b) => [b.id, new Map()]));
  for (let i = 365; i >= 1; i--) {
    const day = addDays(today, -i);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const busy = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
    if ((dow === 0 || dow === 6) && busy < 0.8) continue;
    const created = Math.round(busy * 6);
    const archived = Math.round(busy * 3);
    const comments = Math.round(busy * 9);
    const actors = actorsFor(1 + Math.floor(busy * 3));
    const month = day.slice(0, 7);
    const dd = day.slice(8, 10);
    if (!months.has(month)) months.set(month, {});
    months.get(month)[dd] = { cardsCreated: created, cardsArchived: archived, comments, filesAdded: busy > 0.75 ? 1 : 0, filesRemoved: 0, actors };
    // Split exactly, the remainder to the first board, as the triggers' two scopes are.
    const shares = [0.5, 0.3, 0.2];
    let left = { created, archived, comments };
    BOARDS.forEach((b, idx) => {
      const last = idx === BOARDS.length - 1;
      const take = (total, rest) => (last ? rest : Math.min(rest, Math.floor(total * shares[idx])));
      const part = { created: take(created, left.created), archived: take(archived, left.archived), comments: take(comments, left.comments) };
      left = { created: left.created - part.created, archived: left.archived - part.archived, comments: left.comments - part.comments };
      const bm = boardMonths.get(b.id);
      if (!bm.has(month)) bm.set(month, {});
      bm.get(month)[dd] = { cardsCreated: part.created, cardsArchived: part.archived, comments: part.comments, actors: idx === 0 ? actors : [] };
    });
  }
  const batch = db.batch();
  for (const [month, days] of months) batch.set(db.doc(`stats/_all/months/${month}`), { scope: '_all', month, days });
  for (const [boardId, bm] of boardMonths) {
    for (const [month, days] of bm) batch.set(db.doc(`stats/${boardId}/months/${month}`), { scope: boardId, month, days });
  }
  batch.set(db.doc('stats/_all'), { bytesStored: 18_400_000, filesStored: 23 });
  await batch.commit();
}

/** A fresh guide world. Returns who is who, for the films. */
export async function buildWorld() {
  const uids = await accounts();
  await emptyFirestore();
  // Claims first: a profile written before them would show the old role to a
  // session that refreshes in between.
  for (const [who, p] of Object.entries(PEOPLE)) {
    await auth.setCustomUserClaims(uids[who], { role: p.role, status: p.status });
    await auth.updateUser(uids[who], { displayName: p.name, disabled: false });
  }
  const t0 = Date.now() - 14 * 86400000;
  for (const [who, p] of Object.entries(PEOPLE)) {
    await db.doc(`users/${uids[who]}`).set({
      displayName: p.name,
      email: email(who),
      status: p.status,
      role: p.role,
      notifyPrefs: {},
      mutedBoardIds: [],
      favoriteBoardIds: [],
      recentBoardIds: [],
      unreadNotifCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      ...(p.status === 'active' ? { rulesVersion: RULES_VERSION, rulesAcceptedAt: FieldValue.serverTimestamp() } : {}),
    });
  }
  await writeStats(uids);
  for (const [id, name, color] of LABELS) {
    await db.doc(`labels/${id}`).set({ name, color, createdAt: t0, createdBy: uids.faisal });
  }
  const today = todayInOrgTz();
  for (const b of BOARDS) {
    const profiles = Object.fromEntries(b.members.map((m) => [uids[m], { displayName: PEOPLE[m].name, email: email(m) }]));
    await db.doc(`boards/${b.id}`).set({
      name: b.name,
      description: '',
      archived: false,
      columns: b.columns.map(([id, name]) => ({ id, name })),
      columnIds: b.columns.map(([id]) => id),
      memberUids: b.members.map((m) => uids[m]),
      memberProfiles: profiles,
      boardOwnerUids: b.owners.map((m) => uids[m]),
      activeCardCount: 0,
      createdAt: t0,
      createdBy: uids[b.createdBy],
    });
    for (const [columnId, , cards] of b.columns) {
      const ranks = initialRanks(cards.length);
      for (const [i, [key, title, x]] of cards.entries()) {
        const by = uids[b.createdBy];
        const at = t0 + i * 60000;
        await db.doc(`cards/${cardId(b.id, key)}`).set({
          boardId: b.id,
          title,
          description: x.description ?? '',
          columnId,
          rank: ranks[i],
          assigneeUids: (x.assignees ?? []).map((m) => uids[m]),
          ...(x.due === undefined ? {} : { dueDate: addDays(today, x.due) }),
          priority: x.priority ?? 'none',
          labelIds: x.labels ?? [],
          archived: x.archived ?? false,
          ...(x.archived ? { archivedAt: at } : {}),
          commentCount: 0,
          ...(x.parent ? { parentId: cardId(b.id, x.parent) } : {}),
          createdAt: at,
          createdBy: by,
          updatedAt: at,
          updatedBy: by,
          lastActivityAt: at,
        });
        for (const [j, [author, body, mentions]] of (x.comments ?? []).entries()) {
          await db.collection(`cards/${cardId(b.id, key)}/comments`).doc(`c${j + 1}`).set({
            authorUid: uids[author],
            body,
            mentionUids: mentions.map((m) => uids[m]),
            createdAt: Date.now() - (3 - j) * 3600000,
          });
        }
      }
    }
  }
  // The triggers' share — counts, activity, alerts — lands within seconds.
  await new Promise((r) => setTimeout(r, 6000));
  return uids;
}

/** A person's access set from outside the app, as an admin's tap would: claims, profile, and the stamp that refreshes a live session. */
export async function setAccess(uid, { role, status, rulesAccepted }) {
  await auth.setCustomUserClaims(uid, { role, status });
  await db.doc(`users/${uid}`).update({
    role,
    status,
    claimsUpdatedAt: FieldValue.serverTimestamp(),
    ...(rulesAccepted === false ? { rulesVersion: FieldValue.delete(), rulesAcceptedAt: FieldValue.delete() } : {}),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const uids = await buildWorld();
  console.log(`guide world built: ${Object.keys(uids).join(', ')}`);
  process.exit(0);
}
