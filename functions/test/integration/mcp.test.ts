/**
 * The hosted MCP server (#135), end to end on the emulators: MCP's sign-in
 * (metadata, registration, approval with a real ID token, the PKCE exchange,
 * refresh) and the tools, acting as the person under the rules.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, it, beforeAll, afterAll, expect } from 'vitest';
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
  expect(await page.text()).toContain('Sign in with Google');
  const approved = await json('/oauth/approve', {
    client_id: reg.body.client_id,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    state: 's1',
    idToken: await idTokenFor(uid),
  });
  expect(approved.status).toBe(200);
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
  return { access_token: tok.body.access_token, refresh_token: tok.body.refresh_token, clientId: reg.body.client_id };
}

async function connect(accessToken: string) {
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base()), { requestInit: { headers: { Authorization: `Bearer ${accessToken}` } } }),
  );
  return client;
}

const parsed = (r: unknown) => JSON.parse(((r as { content: { text: string }[] }).content[0]).text);

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

  it('signs in as the person and works under their rules', async () => {
    const tokens = await signIn(ME);
    const client = await connect(tokens.access_token);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['add_card', 'comment', 'get_board', 'get_card', 'list_boards', 'search_cards']);

    const boards = parsed(await client.callTool({ name: 'list_boards', arguments: {} }));
    expect(boards.map((b: { name: string }) => b.name)).toEqual(['Agent Board']);

    const added = parsed(await client.callTool({ name: 'add_card', arguments: { board_id: 'mcp_b1', title: 'Order the chairs' } }));
    const card = (await adminDb().doc(`cards/${added.added}`).get()).data()!;
    expect(card).toMatchObject({ boardId: 'mcp_b1', columnId: 'todo', createdBy: ME, updatedBy: ME, subscriberUids: [ME] });

    await client.callTool({ name: 'comment', arguments: { card_id: added.added, text: 'Done by Friday, @mcpother' } });
    const full = await waitFor('the comment, named', async () => {
      const c = parsed(await client.callTool({ name: 'get_card', arguments: { card_id: added.added } }));
      return c.comments.length && c.history.length ? c : undefined;
    });
    expect(full.comments[0]).toMatchObject({ by: 'Mona', text: 'Done by Friday, @mcpother' });
    const stored = (await adminDb().collection(`cards/${added.added}/comments`).get()).docs[0].data();
    expect(stored.mentionUids).toEqual([OTHER]);

    const found = parsed(await client.callTool({ name: 'search_cards', arguments: { text: 'chairs' } }));
    expect(found.map((c: { title: string }) => c.title)).toEqual(['Order the chairs']);

    // A board they are not on: the rules refuse, as they would the app.
    const refused = await client.callTool({ name: 'get_board', arguments: { board_id: 'mcp_b2' } });
    expect(refused.isError).toBe(true);
    await client.close();
  });

  it('a refresh token gives a new access token, once', async () => {
    const tokens = await signIn(ME);
    const fresh = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: tokens.clientId });
    expect(fresh.status).toBe(200);
    const replay = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: tokens.clientId });
    expect(replay.status).toBe(400);
    const client = await connect(fresh.body.access_token);
    expect(parsed(await client.callTool({ name: 'list_boards', arguments: {} }))).toHaveLength(1);
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
