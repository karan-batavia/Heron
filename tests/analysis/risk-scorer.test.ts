import { describe, it, expect } from 'vitest';
import { computeRiskScore } from '../../src/analysis/risk-scorer.js';
import type { SystemAssessment, Risk } from '../../src/report/types.js';

// Helper to create a system assessment with defaults
function sys(overrides: Partial<SystemAssessment> = {}): SystemAssessment {
  return {
    systemId: 'Test System',
    scopesRequested: ['read'],
    scopesNeeded: ['read'],
    scopesDelta: [],
    dataSensitivity: 'Non-sensitive test data',
    blastRadius: 'single-user',
    frequencyAndVolume: '10 times/day',
    writeOperations: [],
    ...overrides,
  };
}

describe('risk-scorer', () => {
  // ── Excessive access scoring ──────────────────────────────────────────

  it('returns low risk when no excessive access and no risks', () => {
    const result = computeRiskScore([sys()], []);
    expect(result.overall).toBe('low');
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it('scores excessive scopes higher with wider blast radius', () => {
    const narrow = computeRiskScore([sys({
      scopesRequested: ['read', 'write'],
      scopesDelta: ['write'],
      blastRadius: 'single-record',
    })], []);

    const wide = computeRiskScore([sys({
      scopesRequested: ['read', 'write'],
      scopesDelta: ['write'],
      blastRadius: 'org-wide',
    })], []);

    expect(wide.breakdown.excessiveAccess).toBeGreaterThan(narrow.breakdown.excessiveAccess);
  });

  it('scores 100% excessive access at org-wide blast radius as critical', () => {
    const result = computeRiskScore([sys({
      scopesRequested: ['admin'],
      scopesNeeded: [],
      scopesDelta: ['admin'],
      blastRadius: 'org-wide',
    })], [{
      severity: 'critical',
      title: 'Full admin',
      description: 'Agent has write access org-wide',
    }]);

    expect(result.breakdown.excessiveAccess).toBeGreaterThan(50);
  });

  // ── Write risk scoring ────────────────────────────────────────────────

  it('scores zero write risk when no write operations', () => {
    const result = computeRiskScore([sys()], []);
    expect(result.breakdown.writeRisk).toBe(0);
  });

  it('scores higher write risk for irreversible operations', () => {
    const reversible = computeRiskScore([sys({
      writeOperations: [{
        operation: 'update status',
        target: 'invoice',
        reversible: true,
        approvalRequired: true,
        volumePerDay: '10',
      }],
    })], []);

    const irreversible = computeRiskScore([sys({
      writeOperations: [{
        operation: 'delete record',
        target: 'invoice',
        reversible: false,
        approvalRequired: false,
        volumePerDay: '10',
      }],
    })], []);

    expect(irreversible.breakdown.writeRisk).toBeGreaterThan(reversible.breakdown.writeRisk);
  });

  it('scales write risk by blast radius', () => {
    const singleUser = computeRiskScore([sys({
      blastRadius: 'single-user',
      writeOperations: [{
        operation: 'update',
        target: 'profile',
        reversible: false,
        approvalRequired: false,
        volumePerDay: '5',
      }],
    })], []);

    const orgWide = computeRiskScore([sys({
      blastRadius: 'org-wide',
      writeOperations: [{
        operation: 'update',
        target: 'profile',
        reversible: false,
        approvalRequired: false,
        volumePerDay: '5',
      }],
    })], []);

    expect(orgWide.breakdown.writeRisk).toBeGreaterThan(singleUser.breakdown.writeRisk);
  });

  // ── Sensitive data scoring ────────────────────────────────────────────

  it('scores zero for non-sensitive data', () => {
    const result = computeRiskScore([sys({
      dataSensitivity: 'Public product catalog data, no user information',
    })], []);

    expect(result.breakdown.sensitiveData).toBe(0);
  });

  it('scores sensitive data keywords: PII', () => {
    const result = computeRiskScore([sys({
      dataSensitivity: 'Accesses PII: email addresses, phone numbers',
    })], []);

    expect(result.breakdown.sensitiveData).toBeGreaterThan(0);
  });

  it('scores sensitive data keywords: financial', () => {
    const result = computeRiskScore([sys({
      dataSensitivity: 'Financial records: payment amounts, credit card data',
    })], []);

    expect(result.breakdown.sensitiveData).toBeGreaterThan(0);
  });

  it('scores sensitive data keywords: credentials', () => {
    const result = computeRiskScore([sys({
      dataSensitivity: 'Handles API tokens and credential storage',
    })], []);

    expect(result.breakdown.sensitiveData).toBeGreaterThan(0);
  });

  it('scores higher sensitivity with wider blast radius', () => {
    const narrow = computeRiskScore([sys({
      dataSensitivity: 'PII: email addresses',
      blastRadius: 'single-user',
    })], []);

    const wide = computeRiskScore([sys({
      dataSensitivity: 'PII: email addresses',
      blastRadius: 'org-wide',
    })], []);

    expect(wide.breakdown.sensitiveData).toBeGreaterThan(narrow.breakdown.sensitiveData);
  });

  // ── Scope creep scoring ───────────────────────────────────────────────

  it('scores zero scope creep when requested equals needed', () => {
    const result = computeRiskScore([sys({
      scopesRequested: ['read'],
      scopesNeeded: ['read'],
    })], []);

    expect(result.breakdown.scopeCreep).toBe(0);
  });

  it('scores scope creep when requested exceeds needed', () => {
    const result = computeRiskScore([sys({
      scopesRequested: ['read', 'write', 'admin', 'delete'],
      scopesNeeded: ['read'],
    })], []);

    expect(result.breakdown.scopeCreep).toBeGreaterThan(0);
  });

  // ── Risk escalation ───────────────────────────────────────────────────

  it('escalates score when multiple HIGH/CRITICAL LLM risks exist', () => {
    const singleRisk = computeRiskScore([sys()], [{
      severity: 'high',
      title: 'Risk A',
      description: 'Write access issue',
    }]);

    const multipleRisks = computeRiskScore([sys()], [
      { severity: 'high', title: 'Risk A', description: 'Write access issue' },
      { severity: 'critical', title: 'Risk B', description: 'Admin access issue' },
    ]);

    expect(multipleRisks.score).toBeGreaterThan(singleRisk.score);
  });

  // ── Multi-system scoring ──────────────────────────────────────────────

  it('aggregates risk across multiple systems', () => {
    const singleSys = computeRiskScore([sys({
      scopesRequested: ['read', 'write'],
      scopesDelta: ['write'],
    })], []);

    const multiSys = computeRiskScore([
      sys({
        systemId: 'System A',
        scopesRequested: ['read', 'write'],
        scopesDelta: ['write'],
      }),
      sys({
        systemId: 'System B',
        scopesRequested: ['admin'],
        scopesDelta: ['admin'],
        blastRadius: 'org-wide',
      }),
    ], []);

    expect(multiSys.score).toBeGreaterThan(singleSys.score);
  });

  // ── Score-to-level boundaries ─────────────────────────────────────────

  it('maps score 0 to low', () => {
    const result = computeRiskScore([sys()], []);
    expect(result.overall).toBe('low');
  });

  it('returns breakdown with all four components', () => {
    const result = computeRiskScore([sys()], []);
    expect(result.breakdown).toHaveProperty('excessiveAccess');
    expect(result.breakdown).toHaveProperty('writeRisk');
    expect(result.breakdown).toHaveProperty('sensitiveData');
    expect(result.breakdown).toHaveProperty('scopeCreep');
  });

  // ── Empty systems ─────────────────────────────────────────────────────

  it('handles empty systems array gracefully', () => {
    const result = computeRiskScore([], []);
    expect(result.overall).toBe('low');
    expect(result.score).toBe(0);
  });
});
