import { getCredential, isExpired, removeCredential, loadAuthStore, type Credential } from './store.js';
import { loginAnthropic } from './anthropic-token.js';
import { loginOpenAI, refreshOpenAIToken } from './openai-oauth.js';
import { loginGemini } from './gemini-oauth.js';
import * as logger from '../util/logger.js';

export type AuthProvider = 'anthropic' | 'openai' | 'gemini';

/**
 * Login flow for a provider. Interactive — prompts user or opens browser.
 */
export async function login(provider: AuthProvider): Promise<void> {
  switch (provider) {
    case 'anthropic':
      await loginAnthropic();
      break;
    case 'openai':
      await loginOpenAI();
      break;
    case 'gemini':
      await loginGemini();
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Logout — remove stored credentials for a provider.
 */
export function logout(provider: AuthProvider): void {
  removeCredential(provider);
  logger.success(`Removed ${provider} credentials`);
}

/**
 * Get a valid API key/token for a provider.
 * Checks stored credentials, handles refresh if needed.
 * Returns undefined if no stored credentials.
 */
export async function resolveApiKey(provider: AuthProvider): Promise<string | undefined> {
  const credential = getCredential(provider);
  if (!credential) return undefined;

  // For simple tokens, just return the token
  if (credential.type === 'token') {
    if (isExpired(credential)) {
      logger.warn(`${provider} token has expired. Run \`heron login ${provider}\` to refresh.`);
      return undefined;
    }
    return credential.token;
  }

  // For OAuth credentials
  if (credential.type === 'oauth') {
    if (!isExpired(credential)) {
      return credential.accessToken;
    }

    // Try refresh
    logger.log(`${provider} token expired, attempting refresh...`);
    try {
      if (provider === 'openai') {
        const refreshed = await refreshOpenAIToken(credential);
        return refreshed.accessToken;
      }
      // Gemini refresh requires client_secret which we don't store
      // User needs to re-login
      logger.warn(`${provider} token expired. Run \`heron login ${provider}\` to refresh.`);
      return undefined;
    } catch {
      logger.warn(`Token refresh failed. Run \`heron login ${provider}\` to re-authenticate.`);
      return undefined;
    }
  }

  return undefined;
}

/**
 * Show status of all stored credentials.
 */
export function showStatus(): void {
  const store = loadAuthStore();
  const providers: AuthProvider[] = ['anthropic', 'openai', 'gemini'];

  logger.heading('Authentication Status');
  logger.log('');

  for (const provider of providers) {
    const cred = store.credentials[provider];
    if (!cred) {
      logger.log(`  ${provider}: not configured`);
      continue;
    }

    const expired = isExpired(cred);
    const type = cred.type === 'oauth' ? 'OAuth' : 'API Key/Token';
    const status = expired ? 'EXPIRED' : 'active';
    const tokenPreview = cred.type === 'token'
      ? cred.token.slice(0, 12) + '...'
      : cred.accessToken.slice(0, 12) + '...';

    logger.log(`  ${provider}: ${type} (${status}) — ${tokenPreview}`);
  }

  logger.log('');
  logger.log(`Credentials stored in: ~/.heron/auth.json`);
}

export { getCredential, isExpired } from './store.js';
