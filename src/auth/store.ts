import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HERON_DIR = join(homedir(), '.heron');
const AUTH_FILE = join(HERON_DIR, 'auth.json');

export interface TokenCredential {
  type: 'token';
  provider: string;
  token: string;
  expiresAt?: number; // unix ms
}

export interface OAuthCredential {
  type: 'oauth';
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // unix ms
  clientId?: string;
}

export type Credential = TokenCredential | OAuthCredential;

export interface AuthStore {
  version: 1;
  credentials: Record<string, Credential>; // key = provider name
}

function ensureDir(): void {
  mkdirSync(HERON_DIR, { recursive: true });
}

export function loadAuthStore(): AuthStore {
  try {
    const raw = readFileSync(AUTH_FILE, 'utf-8');
    return JSON.parse(raw) as AuthStore;
  } catch {
    return { version: 1, credentials: {} };
  }
}

export function saveAuthStore(store: AuthStore): void {
  ensureDir();
  writeFileSync(AUTH_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function getCredential(provider: string): Credential | undefined {
  const store = loadAuthStore();
  return store.credentials[provider];
}

export function saveCredential(provider: string, credential: Credential): void {
  const store = loadAuthStore();
  store.credentials[provider] = credential;
  saveAuthStore(store);
}

export function removeCredential(provider: string): void {
  const store = loadAuthStore();
  delete store.credentials[provider];
  saveAuthStore(store);
}

export function isExpired(credential: Credential): boolean {
  if (!credential.expiresAt) return false;
  return Date.now() > credential.expiresAt;
}

export function getAuthFilePath(): string {
  return AUTH_FILE;
}
