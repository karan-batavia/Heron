import { describe, it, expect } from 'vitest';
import {
  applySeverityOverrides,
  computeSeveritySignals,
} from '../../src/analysis/risk-scorer.js';
import type { Risk, SystemAssessment } from '../../src/report/types.js';

function makeSystem(overrides: Partial<SystemAssessment> = {}): SystemAssessment {
  return {
    systemId: 'Test System',
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

function makeRisk(severity: Risk['severity'], title: string, description = ''): Risk {
  return { severity, title, description };
}

describe('applySeverityOverrides (AAP-43 P0 #1c)', () => {
  it('floors scope-creep risk to MEDIUM when excessive perms exist', () => {
    const systems = [
      makeSystem({
        systemId: 'Google Workspace',
        scopesRequested: ['drive'],
        scopesNeeded: ['drive.file'],
        scopesDelta: ['drive'],
      }),
    ];
    const risks = [makeRisk('low', 'Broad OAuth scope', 'scope excessive for stated purpose')];
    const out = applySeverityOverrides(risks, systems);
    expect(out[0].severity).toBe('medium');
  });

  it('floors scope-creep to HIGH when excessive perms + sensitive PII', () => {
    const systems = [
      makeSystem({
        systemId: 'Google Workspace',
        scopesRequested: ['spreadsheets'],
        scopesDelta: ['spreadsheets'],
        dataSensitivity: 'PII, names, emails, phone',
      }),
    ];
    const risks = [makeRisk('low', 'Broad OAuth scope', 'scope oauth excessive')];
    const out = applySeverityOverrides(risks, systems);
    expect(out[0].severity).toBe('high');
  });

  it('preserves LLM severity if higher than rule floor', () => {
    const systems = [makeSystem()];
    const risks = [makeRisk('critical', 'Something bad', 'scope excessive')];
    const out = applySeverityOverrides(risks, systems);
    expect(out[0].severity).toBe('critical');
  });

  it('is deterministic across identical inputs (core determinism guarantee)', () => {
    const systems = [
      makeSystem({
        systemId: 'Google Sheets',
        scopesRequested: ['spreadsheets'],
        scopesDelta: ['spreadsheets'],
        dataSensitivity: 'PII',
        writeOperations: [{ operation: 'append row', target: 'Sheet1', reversible: false, approvalRequired: false, volumePerDay: '50' }],
      }),
    ];
    const risks = [makeRisk('low', 'Scope issue', 'scope excessive oauth')];
    const runs = Array.from({ length: 5 }, () => applySeverityOverrides(risks, systems)[0].severity);
    const unique = new Set(runs);
    expect(unique.size).toBe(1);
  });

  it('floors decisions-about-people risk to HIGH when makesDecisionsAboutPeople=true', () => {
    const systems = [makeSystem()];
    const risks = [makeRisk('medium', 'Decisions about candidates', 'agent makes hiring decisions')];
    const out = applySeverityOverrides(risks, systems, true);
    expect(out[0].severity).toBe('high');
  });

  it('does not floor decisions risks when makesDecisionsAboutPeople=false', () => {
    const systems = [makeSystem()];
    const risks = [makeRisk('low', 'Decisions about users', 'user-facing decisions')];
    const out = applySeverityOverrides(risks, systems, false);
    expect(out[0].severity).toBe('low');
  });
});

describe('computeSeveritySignals (AAP-43 P0 #1c)', () => {
  it('detects org-wide writes', () => {
    const signals = computeSeveritySignals([
      makeSystem({
        blastRadius: 'org-wide',
        writeOperations: [{ operation: 'update', target: 'all users', reversible: true, approvalRequired: false, volumePerDay: '10' }],
      }),
    ]);
    expect(signals.hasOrgWideWrites).toBe(true);
  });

  it('detects sensitive PII from data sensitivity keywords', () => {
    const signals = computeSeveritySignals([
      makeSystem({ dataSensitivity: 'contains SSN and credit card' }),
    ]);
    expect(signals.hasSensitivePII).toBe(true);
  });
});
