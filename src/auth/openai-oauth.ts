import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { saveCredential, type OAuthCredential } from './store.js';
import * as logger from '../util/logger.js';

const OPENAI_AUTH_URL = 'https://auth.openai.com/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_CLIENT_ID = 'app_live_clikey_1';
const REDIRECT_PORT = 8796;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

/**
 * OpenAI OAuth PKCE flow.
 * Opens a browser for the user to log in, then captures the token via local redirect.
 */
export async function loginOpenAI(): Promise<OAuthCredential> {
  logger.heading('OpenAI OAuth Login');
  logger.log('');
  logger.log('Opening browser for OpenAI login...');
  logger.log('If it doesn\'t open automatically, visit the URL shown below.');
  logger.log('');

  // PKCE: generate code verifier and challenge
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(16).toString('hex');

  const authUrl = new URL(OPENAI_AUTH_URL);
  authUrl.searchParams.set('client_id', OPENAI_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', 'openai.public');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  logger.log(`  ${authUrl.toString()}`);
  logger.log('');

  // Open browser
  const { exec } = await import('node:child_process');
  const openCmd = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${authUrl.toString()}"`);

  // Wait for callback
  const code = await waitForCallback(state);

  // Exchange code for token
  logger.log('Exchanging code for access token...');
  const tokenResponse = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: OPENAI_CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const credential: OAuthCredential = {
    type: 'oauth',
    provider: 'openai',
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined,
    clientId: OPENAI_CLIENT_ID,
  };

  saveCredential('openai', credential);
  logger.success('OpenAI credentials saved to ~/.heron/auth.json');
  return credential;
}

export async function refreshOpenAIToken(credential: OAuthCredential): Promise<OAuthCredential> {
  if (!credential.refreshToken) {
    throw new Error('No refresh token available. Run `heron login openai` again.');
  }

  const tokenResponse = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credential.clientId ?? OPENAI_CLIENT_ID,
      refresh_token: credential.refreshToken,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error('Token refresh failed. Run `heron login openai` again.');
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const updated: OAuthCredential = {
    ...credential,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? credential.refreshToken,
    expiresAt: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined,
  };

  saveCredential('openai', updated);
  return updated;
}

function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication failed</h1><p>You can close this tab.</p>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Invalid state</h1><p>Please try again.</p>');
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>No code received</h1><p>Please try again.</p>');
        server.close();
        reject(new Error('No authorization code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Success!</h1><p>You can close this tab and return to the terminal.</p>');
      server.close();
      resolve(code);
    });

    server.listen(REDIRECT_PORT, () => {
      logger.log(`Waiting for OAuth callback on port ${REDIRECT_PORT}...`);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth login timed out (2 minutes). Try again.'));
    }, 120_000);
  });
}
