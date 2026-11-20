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
import { adminDb, functionsOrigin, idTokenFor, makeUser, shutdown, waitFor } from './emulatorClient';

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
    expect(names).toEqual(['add_card', 'comment', 'query_activity', 'query_alerts', 'query_boards', 'query_cards']);
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
    expect(boards[0].members).toEqual(expect.arrayContaining([{ name: 'Otto', handle: 'mcpother' }]));

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
