import { describe, it, expect } from 'vitest';
import { renderStructuredCompliance } from '../../src/report/templates.js';
import { mapFindingsToRiskCategories } from '../../src/compliance/mapper.js';
import type { QAPair, SystemAssessment } from '../../src/report/types.js';

function qa(answer: string): QAPair {
  return { question: 'q', answer, category: 'purpose' };
}

function sys(overrides: Partial<SystemAssessment> = {}): SystemAssessment {
  return {
    systemId: 'Google Workspace',
    scopesRequested: ['drive'],
    scopesNeeded: ['drive.file'],
    scopesDelta: ['drive'],
    dataSensitivity: 'PII — names and emails',
    blastRadius: 'single-user',
    frequencyAndVolume: '50/day',
    writeOperations: [],
    ...overrides,
  };
}

describe('renderObligationsChecklist — conditional GDPR (AAP-43 P1 #3)', () => {
  it('omits GDPR rows when no PII / decisions / transfer signals fire', () => {
    const transcript = [qa('Agent logs diagnostic messages locally, no external PII touched')];
    // No business systems, no PII — GDPR shouldn't activate
    const compliance = mapFindingsToRiskCategories({
      systems: [],
      transcript,
      makesDecisionsAboutPeople: false,
    });
    const md = renderStructuredCompliance(compliance);
    // Should not print GDPR Art. 21 (profiling opt-out) when no decisions
    expect(md).not.toMatch(/GDPR Art\. 21/);
  });

  it('includes Arts. 44-49 only when international transfer signal fires', () => {
    const withTransfer = mapFindingsToRiskCategories({
      systems: [sys({ systemId: 'Google Sheets API via OAuth2' })],
      transcript: [qa('PII is stored in Google Sheets and processed by Apify, a US-based service')],
      makesDecisionsAboutPeople: false,
    });
    const mdWith = renderStructuredCompliance(withTransfer);
    expect(mdWith).toMatch(/GDPR Arts\. 44-49/);
  });

  it('includes Art. 21 only when decisions-about-people signal fires', () => {
    const withDecisions = mapFindingsToRiskCategories({
      systems: [sys()],
      transcript: [qa('Agent scores leads by fit and ranks them for sales outreach based on profile data')],
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'Agent scores and ranks candidates for sales outreach',
    });
    const md = renderStructuredCompliance(withDecisions);
    expect(md).toMatch(/GDPR Art\. 21/);
  });
});
