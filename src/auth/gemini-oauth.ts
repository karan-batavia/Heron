import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { saveCredential, type OAuthCredential } from './store.js';
import { promptForInput } from './anthropic-token.js';
import * as logger from '../util/logger.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_PORT = 8797;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;
const SCOPES = [
  'https://www.googleapis.com/auth/generative-language',
  'https://www.googleapis.com/auth/cloud-platform',
].join(' ');

/**
 * Google Gemini OAuth flow.
 * User needs a Google Cloud project with Generative Language API enabled
 * and an OAuth client ID for desktop app.
 */
export async function loginGemini(): Promise<OAuthCredential> {
  logger.heading('Google Gemini OAuth Login');
  logger.log('');
  logger.log('You have two options:');
  logger.log('');
  logger.log('  Option 1: API Key (simpler)');
  logger.log('    Get one at https://aistudio.google.com/apikey');
  logger.log('');
  logger.log('  Option 2: OAuth (Google account login)');
  logger.log('    Requires a Google Cloud OAuth Client ID.');
  logger.log('    See: https://ai.google.dev/gemini-api/docs/oauth');
  logger.log('');

  const choice = await promptForInput('Use [k]ey or [o]auth? (k/o): ');

  if (choice.toLowerCase() === 'o') {
    return loginGeminiOAuth();
  }

  return loginGeminiApiKey();
}

async function loginGeminiApiKey(): Promise<OAuthCredential> {
  const key = await promptForInput('Paste your Gemini API key: ');

  // Store as token credential but typed as OAuthCredential for uniformity
  const credential: OAuthCredential = {
    type: 'oauth',
    provider: 'gemini',
    accessToken: key,
  };

  saveCredential('gemini', credential);
  logger.success('Gemini API key saved to ~/.heron/auth.json');
  return credential;
}

async function loginGeminiOAuth(): Promise<OAuthCredential> {
  const clientId = await promptForInput('Google OAuth Client ID: ');
  const clientSecret = await promptForInput('Google OAuth Client Secret: ');

  const state = randomBytes(16).toString('hex');

  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  logger.log('');
  logger.log('Opening browser for Google login...');
  logger.log(`  ${authUrl.toString()}`);
  logger.log('');

  const { exec } = await import('node:child_process');
  const openCmd = process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${authUrl.toString()}"`);

  const code = await waitForGoogleCallback(state);

  logger.log('Exchanging code for access token...');
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const credential: OAuthCredential = {
    type: 'oauth',
    provider: 'gemini',
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined,
    clientId,
  };

  saveCredential('gemini', credential);
  logger.success('Gemini OAuth credentials saved to ~/.heron/auth.json');
  return credential;
}

export async function refreshGeminiToken(
  credential: OAuthCredential,
  clientSecret: string,
): Promise<OAuthCredential> {
  if (!credential.refreshToken || !credential.clientId) {
    throw new Error('No refresh token available. Run `heron login gemini` again.');
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: credential.clientId,
      client_secret: clientSecret,
      refresh_token: credential.refreshToken,
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error('Google token refresh failed. Run `heron login gemini` again.');
  }

  const tokenData = await tokenResponse.json() as {
    access_token: string;
    expires_in?: number;
  };

  const updated: OAuthCredential = {
    ...credential,
    accessToken: tokenData.access_token,
    expiresAt: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : undefined,
  };

  saveCredential('gemini', updated);
  return updated;
}

function waitForGoogleCallback(expectedState: string): Promise<string> {
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
        reject(new Error(`Google OAuth error: ${error}`));
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>Invalid state</h1>');
        server.close();
        reject(new Error('OAuth state mismatch'));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>No code received</h1>');
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
      logger.log(`Waiting for Google OAuth callback on port ${REDIRECT_PORT}...`);
    });

    setTimeout(() => {
      server.close();
      reject(new Error('Google OAuth login timed out (2 minutes). Try again.'));
    }, 120_000);
  });
}
