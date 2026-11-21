/**
 * The hosted MCP server (#135), end to end on the emulators: MCP's sign-in
 * (metadata, registration, approval with a real ID token, the PKCE exchange,
 * refresh) and the tools, acting as the person under the rules.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { adminDb, callFunction, functionsOrigin, idTokenFor, makeUser, shutdown, waitFor } from './emulatorClient';

const ME = 'mcp_me';
const OTHER = 'mcp_other';
const base = () => `${functionsOrigin()}/mcp`;
const REDIRECT = 'http://127.0.0.1:33418/callback';

async function form(path: string, body: Record<string, string>) {
  const r = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return { status: r.status, body: (await r.json()) as Record<string, string> };
}

async function json(path: string, body: unknown) {
  const r = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json()) as Record<string, string> };
}

/** Register, sign in as `uid`, exchange the code: the access and refresh tokens. */
async function signIn(uid: string) {
  const reg = await json('/oauth/register', { redirect_uris: [REDIRECT], client_name: 'Test agent' });
  expect(reg.status).toBe(201);
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const page = await fetch(
    `${base()}/oauth/authorize?${new URLSearchParams({
      client_id: reg.body.client_id,
      redirect_uri: REDIRECT,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's1',
    })}`,
  );
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain('Sign in with Google');
  expect(html).toContain('Copy for my agent');
  // The page's own script must at least parse: a syntax slip there breaks
  // every sign-in, and nothing else here runs it.
  // Our own page, so plain string search, not an HTML parser by regex: the
  // one inline script sits between the last '<script>' and its '</script>'.
  const open = html.lastIndexOf('<script>');
  const close = html.indexOf('</script>', open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  expect(() => new Function(html.slice(open + '<script>'.length, close))).not.toThrow();
  const approved = await json('/oauth/approve', {
    client_id: reg.body.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    state: 's1',
    idToken: await idTokenFor(uid),
  });
  expect(approved.status).toBe(200);
  // A callback on the agent's own machine: the page offers the line to copy.
  expect(approved.body.loopback).toBe(true);
  const back = new URL(approved.body.redirect);
  expect(back.searchParams.get('state')).toBe('s1');
  const code = back.searchParams.get('code')!;
  const wrong = await form('/oauth/token', {
    grant_type: 'authorization_code', code, code_verifier: 'not-it', client_id: reg.body.client_id, redirect_uri: REDIRECT,
  });
  expect(wrong.status).toBe(400);
  // That attempt spent the code: a code is good once.
  const again = await json('/oauth/approve', {
    client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: challenge, state: 's1', idToken: await idTokenFor(uid),
  });
  const code2 = new URL(again.body.redirect).searchParams.get('code')!;
  const tok = await form('/oauth/token', {
    grant_type: 'authorization_code', code: code2, code_verifier: verifier, client_id: reg.body.client_id, redirect_uri: REDIRECT,
  });
  expect(tok.status).toBe(200);
  expect(reg.body.client_id.startsWith('c1.')).toBe(true);
  return { access_token: tok.body.access_token, refresh_token: tok.body.refresh_token, clientId: reg.body.client_id };
}

async function connect(accessToken: string) {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base()), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } }),
  );
  return client;
}

/** A tool's JSON answer; a refusal or error text fails with that text, not a JSON parse error. */
const parsed = (r: unknown) => {
  const t = (r as { content: { text: string }[] }).content[0].text;
  try {
    return JSON.parse(t);
  } catch {
    throw new Error(`Not JSON: ${t}`);
  }
};

beforeAll(async () => {
  await makeUser({ uid: ME, email: 'mcpme@oursabeel.com', role: 'member', status: 'active', displayName: 'Mona' });
  await makeUser({ uid: OTHER, email: 'mcpother@oursabeel.com', role: 'member', status: 'active', displayName: 'Otto' });
  const board = (id: string, name: string, members: string[]) =>
    adminDb().doc(`boards/${id}`).set({
      name, description: '', archived: false,
      columns: [{ id: 'todo', name: 'To Do' }, { id: 'done', name: 'Done' }], columnIds: ['todo', 'done'],
      memberUids: members, boardOwnerUids: [members[0]],
      memberProfiles: Object.fromEntries(members.map((u) => [u, { displayName: u === ME ? 'Mona' : 'Otto', email: u === ME ? 'mcpme@oursabeel.com' : 'mcpother@oursabeel.com' }])),
      createdAt: 1, createdBy: members[0], updatedAt: 1, updatedBy: members[0],
    });
  await board('mcp_b1', 'Agent Board', [ME, OTHER]);
  await board('mcp_b2', 'Not Mine', [OTHER]);
});

afterAll(async () => {
  await shutdown();
});

describe('stores nothing it does not need', () => {
  it('a registration writes nothing; codes and tokens carry the date their TTL deletes them', async () => {
    const before = (await adminDb().collection('mcpClients').get()).size;
    await signIn(ME);
    expect((await adminDb().collection('mcpClients').get()).size).toBe(before);
    expect(before).toBe(0);
    const tokens = (await adminDb().collection('mcpTokens').get()).docs.map((d) => d.data());
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => t.expireAt instanceof Timestamp && t.expireAt.toMillis() === t.expiresAt)).toBe(true);
  });
});

const seedCard = (id: string, over: Record<string, unknown>) =>
  adminDb().doc(`cards/${id}`).set({
    boardId: 'mcp_b1', title: id, description: '', columnId: 'todo', rank: 'V', assigneeUids: [], subscriberUids: [],
    priority: 'none', labelIds: [], archived: false, commentCount: 0, attachmentCount: 0,
    createdAt: Date.parse('2026-11-02T18:00:00Z'), createdBy: OTHER, updatedAt: Date.parse('2026-11-02T18:00:00Z'), updatedBy: OTHER,
    ...over,
  });

describe('composable queries: every question in at most two calls', () => {
  it('answers each recipe the server teaches, as the person, under the rules', async () => {
    await adminDb().doc('labels/mcp_venue').set({ name: 'Venue', color: 'sage', createdAt: 1 });
    await seedCard('mcp_late', { title: 'Pay the hall deposit', assigneeUids: [ME], priority: 'high', dueDate: '2020-01-01' });
    await seedCard('mcp_theirs', { title: 'Book the speakers', assigneeUids: [OTHER], labelIds: ['mcp_venue'], priority: 'low', dueDate: '2099-06-01' });
    await seedCard('mcp_sub', { title: 'Confirm the speakers', parentId: 'mcp_theirs', assigneeUids: [OTHER] });
    await seedCard('mcp_free', { title: 'Find a caterer', columnId: 'done' });
    await seedCard('mcp_gone', { title: 'Old speakers quote', archived: true });
    await adminDb().collection(`users/${ME}/notifications`).add({
      type: 'mention', boardId: 'mcp_b1', cardId: 'mcp_theirs', actorUid: OTHER, text: 'Otto mentioned you on “Book the speakers”', read: false, at: Date.now(),
    });
    await adminDb().collection(`users/${ME}/notifications`).add({
      type: 'comment', boardId: 'mcp_b1', cardId: 'mcp_theirs', actorUid: OTHER, text: 'Old news', read: true, at: Date.now() - 1000,
    });

    const client = await connect((await signIn(ME)).access_token);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_card', 'clone_board', 'comment', 'copy_cards', 'create_board', 'get_attachment_url',
      'list_addable_people', 'move_cards', 'prepare_attachments', 'query_activity', 'query_alerts',
      'query_boards', 'query_cards', 'set_board_archived', 'set_cards_archived', 'update_board', 'update_card',
    ]);
    expect(client.getInstructions()).toContain('Mona (@mcpme)');
    const call = async (name: string, args: Record<string, unknown>) => parsed(await client.callTool({ name, arguments: args }));
    const titles = async (args: Record<string, unknown>) => (await call('query_cards', args)).cards.map((c: { title: string }) => c.title);

    // Waiting on me: my cards, then my unread alerts.
    const mine = await call('query_cards', { person: 'me', finished: 'exclude', sort: 'due' });
    expect(mine.cards.map((c: { title: string }) => c.title)).toEqual(['Pay the hall deposit']);
    expect(mine.cards[0]).toMatchObject({ due_state: 'overdue', board: 'Agent Board', column: 'To Do', url: 'https://sabeel-institute-kanban.web.app/c/mcp_late' });
    const alerts = await call('query_alerts', {});
    const texts = alerts.alerts.map((a: { text: string }) => a.text);
    expect(texts).toContain('Otto mentioned you on “Book the speakers”');
    expect(texts).not.toContain('Old news');

    // Filters, by name, in one call each.
    expect(await titles({ board: 'agent', labels: 'venue' })).toEqual(['Book the speakers']);
    expect(await titles({ priorities: ['urgent', 'high'] })).toEqual(['Pay the hall deposit']);
    expect(await titles({ person: 'mcpother', sort: 'created' })).toEqual(expect.arrayContaining(['Book the speakers', 'Confirm the speakers']));
    expect(await titles({ person: 'none' })).toEqual(['Find a caterer']);
    expect(await titles({ text: 'speakers', archived: true })).toEqual(['Old speakers quote']);
    expect(await titles({ parent: 'mcp_theirs' })).toEqual(['Confirm the speakers']);
    expect(await titles({ due_to: '2020-12-31' })).toEqual(['Pay the hall deposit']);
    expect(await titles({ column: 'Done' })).toEqual(['Find a caterer']);
    expect((await client.callTool({ name: 'query_cards', arguments: { person: 'nobody.here' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'query_cards', arguments: { due_from: 'next week' } })).isError).toBe(true);

    // Counts instead of rows: workload by person.
    const load = await call('query_cards', { group_by: ['person'] });
    expect(load.groups).toEqual(
      expect.arrayContaining([
        { person: 'Otto', count: 2, overdue: 0 },
        { person: 'Mona', count: 1, overdue: 1 },
        { person: 'unassigned', count: 1, overdue: 0 },
      ]),
    );

    // Depth on particular cards: subtasks and description, live and archived alike.
    const deep = await call('query_cards', { ids: ['mcp_theirs', 'mcp_gone'], include: { subtasks: true, description: true } });
    const theirs = deep.cards.find((c: { id: string }) => c.id === 'mcp_theirs');
    expect(theirs.subtasks.map((c: { title: string }) => c.title)).toEqual(['Confirm the speakers']);
    expect(deep.cards.find((c: { id: string }) => c.id === 'mcp_gone')).toMatchObject({ archived: true, description: '' });

    // Paging: a cursor walks the rest.
    const first = await call('query_cards', { limit: 2, sort: 'created' });
    expect(first.cards).toHaveLength(2);
    expect(first.next_cursor).toBeTruthy();
    const rest = await call('query_cards', { limit: 2, sort: 'created', cursor: first.next_cursor });
    expect(rest.cards.map((c: { id: string }) => c.id)).not.toContain(first.cards[0].id);

    // Status of everything: boards with counts and details.
    const boards = await call('query_boards', { include: { counts: true, members: true, columns: true } });
    expect(boards.map((b: { name: string }) => b.name)).toEqual(['Agent Board']);
    expect(boards[0]).toMatchObject({ member: true, owner: true, url: 'https://sabeel-institute-kanban.web.app/b/mcp_b1' });
    expect(boards[0].counts).toMatchObject({ open: 4, overdue: 1, unassigned: 1, by_column: { 'To Do': 3, Done: 1 } });
    expect(boards[0].members).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Otto', handle: 'mcpother' })]));

    // A board they are not on: not listed, and refused by name.
    expect((await client.callTool({ name: 'query_cards', arguments: { board: 'Not Mine' } })).isError).toBe(true);
    await client.close();
  });

  it('what happened: history, comments and the board, newest first, by type and person', async () => {
    const client = await connect((await signIn(ME)).access_token);
    const call = async (name: string, args: Record<string, unknown>) => parsed(await client.callTool({ name, arguments: args }));
    // A column is always named: the agent asks, it does not guess.
    expect((await client.callTool({ name: 'add_card', arguments: { board: 'Agent Board', title: 'No column' } })).isError).toBe(true);
    const added = await call('add_card', { board: 'Agent Board', title: 'Order the chairs', column: 'To Do' });
    expect((await adminDb().doc(`cards/${added.added}`).get()).data()).toMatchObject({ boardId: 'mcp_b1', columnId: 'todo', createdBy: ME, subscriberUids: [ME] });
    await call('comment', { card_id: added.added, text: 'Done by Friday, @mcpother' });
    const stored = (await adminDb().collection(`cards/${added.added}/comments`).get()).docs[0].data();
    expect(stored.mentionUids).toEqual([OTHER]);

    const lines = await waitFor('the card created and the comment, in the activity', async () => {
      const a = await call('query_activity', { board: 'Agent Board', person: 'me' });
      const mine = a.lines.filter((l: { card?: { id: string } }) => l.card?.id === added.added);
      return mine.some((l: { what: string }) => l.what === 'created') && mine.some((l: { what: string }) => l.what === 'comment') ? mine : undefined;
    });
    const comment = lines.find((l: { what: string }) => l.what === 'comment');
    expect(comment).toMatchObject({ by: 'Mona', text: 'Done by Friday, @mcpother', card: { title: 'Order the chairs' } });
    const onlyComments = await call('query_activity', { card: added.added, types: ['comment'] });
    expect(onlyComments.lines.map((l: { what: string }) => l.what)).toEqual(['comment']);
    // The same card read in depth carries its latest comment.
    const deep = await call('query_cards', { ids: [added.added], include: { comments: 1, history: 5 } });
    expect(deep.cards[0].comments).toEqual([expect.objectContaining({ by: 'Mona', text: 'Done by Friday, @mcpother' })]);
    expect(deep.cards[0].history.map((h: { what: string }) => h.what)).toContain('created');
    await client.close();
  });
});

describe('the MCP server', () => {
  it('an unsigned call is told where to sign in, and the metadata says how', async () => {
    const r = await fetch(base(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);
    const meta = (await (await fetch(`${base()}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(String(meta.registration_endpoint)).toMatch(/\/oauth\/register$/);
  });

  it('refuses a redirect that is neither https nor this machine', async () => {
    expect((await json('/oauth/register', { redirect_uris: ['http://evil.example/cb'] })).status).toBe(400);
  });

  it('a refresh token gives a new access token, once', async () => {
    const tokens = await signIn(ME);
    const fresh = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: tokens.clientId });
    expect(fresh.status).toBe(200);
    const replay = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: tokens.clientId });
    expect(replay.status).toBe(400);
    const client = await connect(fresh.body.access_token);
    expect(parsed(await client.callTool({ name: 'query_boards', arguments: {} }))).toHaveLength(1);
    await client.close();
  });

  it("an admin's agent sees every board, as the app shows an admin", async () => {
    await makeUser({ uid: 'mcp_admin', email: 'mcpadmin@oursabeel.com', role: 'admin', status: 'active', displayName: 'Ada' });
    const client = await connect((await signIn('mcp_admin')).access_token);
    const names = parsed(await client.callTool({ name: 'query_boards', arguments: {} })).map((b: { name: string }) => b.name);
    expect(names).toEqual(expect.arrayContaining(['Agent Board', 'Not Mine']));
    await client.close();
  });

  it('an account that is not active is not let in', async () => {
    await makeUser({ uid: 'mcp_pending', email: 'mcppending@oursabeel.com', role: 'member', status: 'pending' });
    const reg = await json('/oauth/register', { redirect_uris: [REDIRECT] });
    const r = await json('/oauth/approve', {
      client_id: reg.body.client_id, redirect_uri: REDIRECT, code_challenge: 'x', state: '', idToken: await idTokenFor('mcp_pending'),
    });
    expect(r.status).toBe(403);
  });
});

describe('Kanban write tools', () => {
  it('combines board and card edits, uses the app defaults, and transfers file bytes separately', async () => {
    const organizer = 'mcp_writer';
    await makeUser({ uid: organizer, email: 'mcpwriter@oursabeel.com', role: 'organizer', status: 'active', displayName: 'Writer' });
    const client = await connect((await signIn(organizer)).access_token);
    const call = async (name: string, args: Record<string, unknown>) => parsed(await client.callTool({ name, arguments: args }));
    const source = await call('create_board', { name: 'MCP Course' });
    const boardRef = adminDb().doc(`boards/${source.id}`);
    const changed = await call('update_board', {
      board: source.id, template: true, columns: { add: ['Review'], order: ['To Do', 'In Progress', 'Review', 'Done'] },
      lanes: { enabled: true, add: ['Teaching', 'Logistics'], order: ['Logistics', 'Teaching'], finished_column: 'Done' },
      detail_fields: { add: [{ type: 'start' }, { name: 'Classroom', type: 'text' }, { name: 'Instructor', type: 'text' }] },
      details: { 'Start date': '2026-12-01', Classroom: 'A', Instructor: 'Writer' },
      members: { add: ['Otto', 'Mona'], make_owner: ['Otto'] },
      labels: { add: [{ name: 'Course work' }] },
    });
    expect(changed.id).toBe(source.id);
    expect((await boardRef.get()).data()).toMatchObject({ memberUids: [organizer, OTHER, ME], boardOwnerUids: [organizer, OTHER], template: true, lanesOn: true });
    await call('update_board', { board: source.id, details: { Classroom: null, 'Start date': '2026-12-03' } });
    const [board] = await call('query_boards', { board: source.id, include: { details: true, lanes: true, columns: true, labels: true } });
    expect(board).toMatchObject({
      columns: ['To Do', 'In Progress', 'Review', 'Done'], lanes: ['Logistics', 'Teaching'], finished_column: 'Done',
      details: { 'Start date': '2026-12-03', Classroom: null, Instructor: 'Writer' },
      labels: expect.arrayContaining([expect.objectContaining({ name: 'Course work', scope: 'board' })]),
    });
    const invalid = await client.callTool({ name: 'update_board', arguments: { board: source.id, name: 'Should not land', details: { Missing: 'A' } } });
    expect(invalid.isError).toBe(true);
    expect((await boardRef.get()).data()?.name).toBe('MCP Course');
    expect((await client.callTool({ name: 'update_board', arguments: { board: source.id, members: { remove: ['Otto'] } } })).isError).toBe(true);
    const beforeNoop = (await boardRef.get()).get('updatedAt');
    expect((await call('update_board', { board: source.id, template: true, members: { add: ['Otto'] },
      details: { Classroom: null, 'Start date': '2026-12-03' } })).changed).toEqual([]);
    expect((await boardRef.get()).get('updatedAt')).toBe(beforeNoop);
    expect((await client.callTool({ name: 'clone_board', arguments: { board: source.id, name: 'Collision', clone_id: source.id } })).isError).toBe(true);

    const bytes = 'Course handout contents';
    const card = await call('add_card', {
      board: source.id, column: 'To Do', lane: 'Teaching', title: 'Course handout',
      description: 'Draft **handout**', labels: ['Course work'], assignees: ['Otto'],
      due_date: '2026-12-02', priority: 'high', subscribe: false,
      attachments: [{ name: 'handout.txt', content_type: 'text/plain', size_bytes: Buffer.byteLength(bytes) }],
    });
    expect(card).toMatchObject({ column: 'To Do', lane: 'Teaching' });
    const cardRef = adminDb().doc(`cards/${card.id}`);
    expect((await cardRef.get()).data()).toMatchObject({ description: 'Draft **handout**', dueDate: '2026-12-02',
      assigneeUids: [OTHER], priority: 'high', subscriberUids: [], labelIds: [board.labels.find((label: { name: string }) => label.name === 'Course work').id] });
    const [upload] = card.attachments;
    const unauthorized = await fetch(upload.upload_url, { method: 'PUT', body: bytes });
    expect(unauthorized.status, await unauthorized.text()).toBe(401);
    const early = await callFunction('finalizeAttachment', { cardId: card.id, attachmentId: upload.id }, await idTokenFor(organizer));
    expect(early.body.error?.message).toMatch(/Complete this upload with its Kanban MCP upload URL/);
    const wrongSize = await fetch(upload.upload_url, { method: upload.method, headers: upload.headers, body: 'short' });
    expect(wrongSize.status).toBe(400);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const uploaded = await fetch(upload.upload_url, { method: upload.method, headers: upload.headers, body: bytes });
      expect(await uploaded.json()).toMatchObject({ id: upload.id, status: 'ready' });
      expect(uploaded.status).toBe(200);
    }
    const different = await fetch(upload.upload_url, { method: upload.method, headers: upload.headers, body: bytes.replace('Course', 'Lesson') });
    expect(different.status).toBe(409);
    const attachment = await call('get_attachment_url', { card_id: card.id, attachment_id: upload.id });
    expect(await (await fetch(attachment.url)).text()).toBe(bytes);
    const updated = await call('update_card', { card_id: card.id, due_date: null, labels: { remove: ['Course work'] }, assignees: ['me'] });
    expect(updated.changed).toEqual(expect.arrayContaining(['due_date', 'labels', 'assignees']));
    expect((await cardRef.get()).data()).toMatchObject({ labelIds: [], assigneeUids: [organizer], attachmentCount: 1 });
    const beforeCardNoop = (await cardRef.get()).data();
    expect(beforeCardNoop?.dueDate).toBeUndefined();
    expect((await call('update_card', { card_id: card.id, due_date: null, labels: { remove: ['Course work'] }, assignees: ['me'] })).changed).toEqual([]);
    expect((await cardRef.get()).get('updatedAt')).toBe(beforeCardNoop?.updatedAt);

    const comment = await call('comment', { card_id: card.id, text: 'First draft' });
    await call('comment', { card_id: card.id, comment_id: comment.commented, text: 'Updated draft' });
    const queried = await call('query_cards', { ids: [card.id], include: { attachments: true, comments: 1 } });
    expect(queried.cards[0]).toMatchObject({ comments: [{ id: comment.commented, text: 'Updated draft' }], attachments: [{ id: upload.id }] });

    const quiet = await call('clone_board', { board: source.id, name: 'Quiet clone' });
    const followed = await call('clone_board', { board: source.id, name: 'Followed clone', subscribe: true });
    expect((await call('clone_board', { board: source.id, name: 'Repeated clone', clone_id: quiet.id })).id).toBe(quiet.id);
    expect((await client.callTool({ name: 'clone_board', arguments: { board: followed.id, name: 'Wrong source', clone_id: quiet.id } })).isError).toBe(true);
    for (const [id, subscribers] of [[quiet.id, []], [followed.id, [organizer]]] as const) {
      const clone = await adminDb().collection('cards').where('boardId', '==', id).get();
      expect(clone.docs[0].data()).toMatchObject({ subscriberUids: subscribers, attachmentCount: 0 });
    }

    const copied = await call('copy_cards', { card_ids: [card.id], board: quiet.id, column: 'To Do' });
    expect((await adminDb().doc(`cards/${copied.cards[0].id}`).get()).data()).toMatchObject({ subscriberUids: [organizer], attachmentCount: 0 });
    await call('update_card', { card_id: card.id, assignees: ['Otto'], labels: { add: ['Course work'] } });
    const move = { card_ids: [card.id], board: quiet.id, column: 'Review' };
    expect(await call('move_cards', { ...move, preview: true })).toMatchObject({
      preview: true, cards: [{ dropped_labels: ['Course work'], unassigned: [OTHER] }],
    });
    expect((await cardRef.get()).data()?.boardId).toBe(source.id);
    const other = await connect((await signIn(ME)).access_token);
    const pending = parsed(await other.callTool({ name: 'prepare_attachments', arguments: {
      card_id: card.id, attachments: [{ name: 'pending.txt', size_bytes: Buffer.byteLength(bytes) }],
    } })).attachments[0];
    await call('move_cards', move);
    const lostAccess = await fetch(pending.upload_url, { method: pending.method, headers: pending.headers, body: bytes });
    expect(lostAccess.status).toBe(403);
    expect((await cardRef.collection('attachments').doc(pending.id).get()).get('status')).toBe('uploading');
    expect((await cardRef.get()).data()).toMatchObject({ boardId: quiet.id, attachmentCount: 1 });
    await call('update_card', { card_ids: [card.id, copied.cards[0].id], assignees: ['me'] });
    expect((await cardRef.get()).data()?.assigneeUids).toEqual([organizer]);
    expect((await adminDb().doc(`cards/${copied.cards[0].id}`).get()).data()?.assigneeUids).toEqual([organizer]);
    await call('set_cards_archived', { card_ids: [card.id], archived: true });
    expect((await cardRef.get()).data()?.archived).toBe(true);
    await call('set_cards_archived', { card_ids: [card.id], archived: false });
    expect((await cardRef.get()).data()?.archived).toBe(false);

    const subtask = await call('add_card', { board: quiet.id, column: 'To Do', lane: null, title: 'Proofread it', parent_id: card.id });
    const family = [card.id, subtask.id];
    // Two same-rank neighbors are valid after concurrent app writes.
    const tied = [copied.cards[0].id, subtask.id].sort();
    await Promise.all(tied.map((id) => adminDb().doc(`cards/${id}`).update({ rank: 'V' })));
    await call('move_cards', { card_ids: [card.id], column: 'To Do', before_card_id: tied[1] });
    expect((await cardRef.get()).get('rank') < 'V').toBe(true);
    for (const id of tied) expect((await adminDb().doc(`cards/${id}`).get()).get('rank')).toBe('V');
    await call('set_cards_archived', { card_ids: family, archived: true });
    expect((await client.callTool({ name: 'set_cards_archived', arguments: { card_ids: [subtask.id], archived: false } })).isError).toBe(true);
    await call('set_cards_archived', { card_ids: family, archived: false });
    expect((await adminDb().doc(`cards/${subtask.id}`).get()).data()).toMatchObject({ parentId: card.id, archived: false });

    await call('set_board_archived', { board: followed.id, archived: true });
    expect((await adminDb().doc(`boards/${followed.id}`).get()).data()?.archived).toBe(true);
    await call('set_board_archived', { board: followed.id, archived: false });
    expect((await adminDb().doc(`boards/${followed.id}`).get()).data()?.archived).toBe(false);

    expect((await other.callTool({ name: 'update_board', arguments: { board: source.id, name: 'Unauthorised rename' } })).isError).toBe(true);
    expect((await other.callTool({ name: 'get_attachment_url', arguments: { card_id: card.id, attachment_id: upload.id } })).isError).toBe(true);

    const race = await call('add_card', { board: source.id, column: 'To Do', lane: null, title: 'Race with membership removal' });
    const organizerToken = await idTokenFor(organizer);
    const [removed] = await Promise.all([
      callFunction('removeBoardMember', { boardId: source.id, uid: OTHER }, organizerToken),
      client.callTool({ name: 'update_card', arguments: { card_id: race.id, assignees: ['Otto'] } }),
    ]);
    expect(removed.body.result).toMatchObject({ ok: true });
    expect((await boardRef.get()).get('memberUids')).not.toContain(OTHER);
    expect((await adminDb().doc(`cards/${race.id}`).get()).get('assigneeUids')).not.toContain(OTHER);
    const [empty] = (await call('prepare_attachments', { card_id: race.id, attachments: [{ name: 'blank.txt', size_bytes: 0 }] })).attachments;
    const emptyUpload = await fetch(empty.upload_url, { method: empty.method, headers: empty.headers, body: '' });
    expect(await emptyUpload.json()).toMatchObject({ id: empty.id, status: 'ready', sizeBytes: 0 });

    await other.close();
    await client.close();
  });

  it('keeps the subtask hierarchy acyclic when links are edited concurrently', async () => {
    const client = await connect((await signIn(ME)).access_token);
    const create = async (title: string, parent_id?: string) => parsed(await client.callTool({
      name: 'add_card', arguments: { board: 'Agent Board', column: 'To Do', title, ...(parent_id ? { parent_id } : {}) },
    }));
    const left = await create('Left root');
    const right = await create('Right root');
    const leftChild = await create('Left child', left.id);
    const rightChild = await create('Right child', right.id);
    const outcomes = await Promise.all([
      client.callTool({ name: 'update_card', arguments: { card_id: left.id, parent_id: rightChild.id } }),
      client.callTool({ name: 'update_card', arguments: { card_id: right.id, parent_id: leftChild.id } }),
    ]);
    expect(outcomes.filter((result) => !result.isError)).toHaveLength(1);
    const records = await Promise.all([left, right].map((card) => adminDb().doc(`cards/${card.id}`).get()));
    expect(records.filter((record) => record.get('parentId'))).toHaveLength(1);
    await client.close();
  });
});
