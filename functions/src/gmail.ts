import { GoogleAuth } from 'google-auth-library';

/**
 * Sending mail as a Workspace user, with no password and no key.
 *
 * Domain-wide delegation, keyless: the function's own credentials ask IAM to
 * sign a JWT as the `report-mailer` service account, that JWT names the
 * Workspace user (`sub`) and the one scope delegation grants it
 * (`gmail.send`), Google's token endpoint trades it for that user's access
 * token, and Gmail sends the message as them. Nothing secret is stored
 * anywhere: the right to sign is the IAM grant
 * `roles/iam.serviceAccountTokenCreator` on `report-mailer` (docs/DEPLOY.md),
 * and the right to act as the user is the Admin console's delegation entry for
 * that service account's client id.
 *
 * Plain HTTPS calls and no mail library: three requests, each small. Every
 * address comes in as an argument (`GOOGLE_ENDPOINTS` by default), which is
 * what lets `gmail.test.ts` stand a local fake in for all three Google
 * services and run this code path whole, as `apns.test.ts` does for Apple.
 */

interface GoogleEndpoints {
  /** IAM Credentials, origin only. */
  iam: string;
  /** The OAuth token endpoint, the full URL. */
  token: string;
  /** Gmail, origin only. */
  gmail: string;
}

const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  iam: 'https://iamcredentials.googleapis.com',
  token: 'https://oauth2.googleapis.com/token',
  gmail: 'https://gmail.googleapis.com',
};

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

interface Delegation {
  /** The service account that signs: `report-mailer@<project>.iam.gserviceaccount.com`. */
  serviceAccount: string;
  /** The Workspace user it sends as. */
  user: string;
}

interface SendDeps {
  endpoints?: GoogleEndpoints;
  /** The function's own access token, for the IAM call. Application Default Credentials unless a test says otherwise. */
  accessToken?: () => Promise<string>;
  now?: () => number;
}

/** Long enough for a slow answer, short enough that a hung one cannot hold the callable. */
const REQUEST_TIMEOUT_MS = 15_000;

let adc: GoogleAuth | null = null;
async function defaultAccessToken(): Promise<string> {
  adc ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const token = await adc.getAccessToken();
  if (!token) throw new Error('no access token from the function credentials');
  return token;
}

/**
 * POST and read JSON, or throw a sentence naming the step and Google's own
 * words. The error's message is stored on the report (`mail.error`), so it
 * says which of the three steps failed.
 */
async function postJson<T>(step: string, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, method: 'POST', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    throw new Error(`${step}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
      detail =
        body.error_description ??
        (typeof body.error === 'string' ? body.error : body.error?.message) ??
        detail;
    } catch {
      // not JSON; the raw text says what there is to say
    }
    throw new Error(`${step}: HTTP ${res.status} ${detail}`.trim());
  }
  return JSON.parse(text) as T;
}

/**
 * Send one RFC 5322 message as `delegation.user`. Resolves to Gmail's message
 * id; throws, with the failing step named, when any of the three calls fails.
 */
export async function sendAsWorkspaceUser(
  raw: string,
  delegation: Delegation,
  { endpoints = GOOGLE_ENDPOINTS, accessToken = defaultAccessToken, now = Date.now }: SendDeps = {},
): Promise<{ messageId: string }> {
  const iat = Math.floor(now() / 1000);
  const claims = {
    iss: delegation.serviceAccount,
    sub: delegation.user,
    scope: GMAIL_SEND_SCOPE,
    aud: endpoints.token,
    iat,
    exp: iat + 3600,
  };

  const own = await accessToken();
  const signed = await postJson<{ signedJwt?: string }>(
    'signing the delegation token',
    `${endpoints.iam}/v1/projects/-/serviceAccounts/${encodeURIComponent(delegation.serviceAccount)}:signJwt`,
    {
      headers: { authorization: `Bearer ${own}`, 'content-type': 'application/json' },
      body: JSON.stringify({ payload: JSON.stringify(claims) }),
    },
  );
  if (!signed.signedJwt) throw new Error('signing the delegation token: no signedJwt in the answer');

  const token = await postJson<{ access_token?: string }>('exchanging the delegation token', endpoints.token, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signed.signedJwt,
    }).toString(),
  });
  if (!token.access_token) throw new Error('exchanging the delegation token: no access_token in the answer');

  const sent = await postJson<{ id?: string }>(
    'sending through Gmail',
    `${endpoints.gmail}/gmail/v1/users/me/messages/send`,
    {
      headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
    },
  );
  if (!sent.id) throw new Error('sending through Gmail: no message id in the answer');
  return { messageId: sent.id };
}
