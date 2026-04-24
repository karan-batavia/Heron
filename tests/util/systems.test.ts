import { describe, it, expect } from 'vitest';
import { isBusinessSystem } from '../../src/util/systems.js';
import type { SystemAssessment } from '../../src/report/types.js';

function makeSys(overrides: Partial<SystemAssessment> = {}): SystemAssessment {
  return {
    systemId: 'test',
    scopesRequested: [],
    scopesNeeded: [],
    scopesDelta: [],
    dataSensitivity: '',
    blastRadius: 'single-user',
    frequencyAndVolume: '',
    writeOperations: [],
    ...overrides,
  };
}

describe('isBusinessSystem (AAP-43 P2 #8)', () => {
  it('excludes Heron itself', () => {
    expect(isBusinessSystem(makeSys({ systemId: 'Heron audit platform' }))).toBe(false);
  });

  it('excludes Local filesystem log', () => {
    expect(isBusinessSystem(makeSys({ systemId: 'Local filesystem log' }))).toBe(false);
  });

  it('excludes Local SQLite idempotency store', () => {
    expect(isBusinessSystem(makeSys({ systemId: 'Local SQLite idempotency store' }))).toBe(false);
  });

  it('excludes env var storage when scopes empty', () => {
    expect(isBusinessSystem(makeSys({ systemId: 'Environment variable file', scopesRequested: [] }))).toBe(false);
  });

  it('includes real business systems', () => {
    expect(isBusinessSystem(makeSys({ systemId: 'Google Workspace (Sheets, OAuth2)' }))).toBe(true);
    expect(isBusinessSystem(makeSys({ systemId: 'Apify Scraper' }))).toBe(true);
    expect(isBusinessSystem(makeSys({ systemId: 'Stripe API' }))).toBe(true);
  });
});
