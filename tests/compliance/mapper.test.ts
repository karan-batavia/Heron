import { describe, it, expect } from 'vitest';
import {
  mapFindingsToRiskCategories,
  detectSignals,
  classifyDecisionImpact,
} from '../../src/compliance/mapper.js';
import { MAPPING_VERSION } from '../../src/compliance/types.js';
import { CONTROL_MAPPINGS } from '../../src/compliance/control-mappings.js';
import {
  FRAMEWORKS,
  listMandatoryFrameworks,
  listVoluntaryFrameworks,
  frameworksFor,
} from '../../src/compliance/frameworks.js';
import type { SystemAssessment, QAPair } from '../../src/report/types.js';

const baseSystem = (over: Partial<SystemAssessment> = {}): SystemAssessment => ({
  systemId: 'Acme CRM, REST API via OAuth2',
  scopesRequested: ['crm.read', 'crm.write'],
  scopesNeeded: ['crm.read'],
  scopesDelta: ['crm.write'],
  dataSensitivity: 'PII — customer names and emails',
  blastRadius: 'org-wide',
  frequencyAndVolume: '~100/day',
  writeOperations: [
    {
      operation: 'Update contact',
      target: 'contacts',
      reversible: false,
      approvalRequired: false,
      volumePerDay: '~100/day',
    },
  ],
  ...over,
});

const tx = (answers: string[]): QAPair[] =>
  answers.map((a, i) => ({ question: `Q${i}`, answer: a, category: 'data' }));

// ─── Registry shape ─────────────────────────────────────────────────────────

describe('frameworks registry', () => {
  it('registers all AAP-30 + AAP-31 frameworks', () => {
    const ids = Object.keys(FRAMEWORKS);
    // AAP-30 originals
    expect(ids).toContain('eu-ai-act');
    expect(ids).toContain('gdpr');
    expect(ids).toContain('nist-ai-rmf');
    expect(ids).toContain('iso-23894');
    expect(ids).toContain('iso-42001');
    expect(ids).toContain('soc-2');
    // AAP-31 restored (nyc-ll144 and ico-ai-toolkit removed from v1 scope)
    expect(ids).toContain('uk-gdpr-dpa-2018');
    expect(ids).toContain('colorado-ai-act');
    expect(ids).toContain('hipaa');
    expect(ids).toContain('ccpa-cpra');
  });

  it('uses Jurisdiction[] for mandatoriness, not booleans', () => {
    for (const f of Object.values(FRAMEWORKS)) {
      expect(Array.isArray(f.mandatoryIn)).toBe(true);
    }
    expect(FRAMEWORKS['eu-ai-act'].mandatoryIn).toContain('EU');
    expect(FRAMEWORKS.gdpr.mandatoryIn).toContain('EU');
    expect(FRAMEWORKS['uk-gdpr-dpa-2018'].mandatoryIn).toContain('UK');
    expect(FRAMEWORKS['nist-ai-rmf'].mandatoryIn).toEqual([]);
  });

  it('models US-state laws as US with a scopeNote', () => {
    expect(FRAMEWORKS['colorado-ai-act'].mandatoryIn).toEqual(['US']);
    expect(FRAMEWORKS['colorado-ai-act'].scopeNote).toMatch(/colorado/i);
    expect(FRAMEWORKS['hipaa'].mandatoryIn).toEqual(['US']);
    expect(FRAMEWORKS['hipaa'].scopeNote).toMatch(/covered entit/i);
    expect(FRAMEWORKS['ccpa-cpra'].mandatoryIn).toEqual(['US']);
    expect(FRAMEWORKS['ccpa-cpra'].scopeNote).toMatch(/california/i);
  });

  it('partitions cleanly into mandatory + voluntary', () => {
    const m = listMandatoryFrameworks().map((f) => f.id);
    const v = listVoluntaryFrameworks().map((f) => f.id);
    expect(m).toContain('eu-ai-act');
    expect(m).toContain('colorado-ai-act');
    expect(v).toContain('nist-ai-rmf');
    // No overlap
    for (const id of m) expect(v).not.toContain(id);
  });

  it('frameworksFor(UK) includes UK GDPR', () => {
    const uk = frameworksFor('UK').map((f) => f.id);
    expect(uk).toContain('uk-gdpr-dpa-2018');
    expect(uk).not.toContain('eu-ai-act');
  });
});

// ─── control-mappings shape ─────────────────────────────────────────────────

describe('control-mappings table', () => {
  it('covers every finding type', () => {
    const types = Object.keys(CONTROL_MAPPINGS);
    expect(types).toContain('excessive-access');
    expect(types).toContain('write-risk');
    expect(types).toContain('sensitive-data');
    expect(types).toContain('scope-creep');
    expect(types).toContain('regulatory-flags');
    expect(types).toContain('risk-score');
    expect(types).toContain('decisions-about-people');
  });

  it('only references registered frameworks', () => {
    const ids = new Set(Object.keys(FRAMEWORKS));
    for (const m of Object.values(CONTROL_MAPPINGS)) {
      for (const c of m.controls) {
        expect(ids.has(c.frameworkId)).toBe(true);
      }
    }
  });

  it('sensitive-data activates HIPAA, CCPA, UK GDPR controls', () => {
    const ids = CONTROL_MAPPINGS['sensitive-data'].controls.map((c) => c.frameworkId);
    expect(ids).toContain('hipaa');
    expect(ids).toContain('ccpa-cpra');
    expect(ids).toContain('uk-gdpr-dpa-2018');
  });

  it('decisions-about-people activates Colorado AI Act (CCPA removed from this path in v1)', () => {
    const ids = CONTROL_MAPPINGS['decisions-about-people'].controls.map((c) => c.frameworkId);
    expect(ids).toContain('colorado-ai-act');
    // CCPA ADMT sub-flag deferred to v2 (effective 2027-01-01); base CCPA flag
    // fires only via sensitive-data path. No ccpa-cpra row here.
    expect(ids).not.toContain('ccpa-cpra');
  });
});

// ─── mapFindingsToRiskCategories ────────────────────────────────────────────

describe('mapFindingsToRiskCategories', () => {
  it('stamps mapping version and starts AAP-31', () => {
    const r = mapFindingsToRiskCategories({ systems: [], transcript: [] });
    expect(r.mappingVersion).toBe(MAPPING_VERSION);
    expect(r.mappingVersion).toMatch(/^aap-31/);
  });

  it('produces mandatory + voluntary buckets with 4 categories each', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['We process customer name and email PII via API']),
    });
    for (const bucket of [r.mandatory, r.voluntary]) {
      expect(bucket).toHaveProperty('privacy');
      expect(bucket).toHaveProperty('ip');
      expect(bucket).toHaveProperty('consumer-protection');
      expect(bucket).toHaveProperty('sector-specific');
    }
  });

  it('every flag carries an "indicative mapping" qualifier', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['name email pii via api']),
    });
    expect(r.all.length).toBeGreaterThan(0);
    for (const f of r.all) {
      expect(f.description.toLowerCase()).toContain('indicative mapping');
    }
  });

  it('fires HIPAA only when health signals are present', () => {
    const without = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['names, emails, sales pipeline']),
    });
    expect(without.frameworksActivated).not.toContain('hipaa');

    const withHealth = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['We sync patient medical records to our EHR system']),
    });
    expect(withHealth.frameworksActivated).toContain('hipaa');
  });

  it('fires Colorado AI Act for high-impact decisions, not generic outreach', () => {
    const sales = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['scores leads for sales outreach']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'We score leads and rank them for sales outreach campaigns',
    });
    expect(sales.frameworksActivated).not.toContain('colorado-ai-act');

    const hiring = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['screens job applicants']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails:
        'We screen candidates for hiring decisions and recommend approve or reject',
    });
    expect(hiring.frameworksActivated).toContain('colorado-ai-act');
  });

  it('fires CCPA for sensitive PII and ADMT', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['We collect SSN and bank account data']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'Approves or denies loan applications using credit scoring',
    });
    expect(r.frameworksActivated).toContain('ccpa-cpra');
  });

  it('fires UK GDPR / DPA 2018 whenever PII is processed', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['Processes customer name, email, and phone']),
    });
    expect(r.frameworksActivated).toContain('uk-gdpr-dpa-2018');
  });

  it('places restored mandatory frameworks in the mandatory bucket', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['EHR with patient health records, names, emails, ssn']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screens job applicants and makes hiring decisions',
    });
    const mandIds = new Set(
      [
        ...r.mandatory.privacy,
        ...r.mandatory['consumer-protection'],
        ...r.mandatory['sector-specific'],
        ...r.mandatory.ip,
      ].map((f) => f.frameworkId),
    );
    expect(mandIds.has('hipaa')).toBe(true);
    expect(mandIds.has('colorado-ai-act')).toBe(true);
    expect(mandIds.has('ccpa-cpra')).toBe(true);
    expect(mandIds.has('uk-gdpr-dpa-2018')).toBe(true);
  });

  it('categorizes restored frameworks per the AAP-31 spec', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['EHR patient health records with name, email, phone PII']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screens candidates and rejects unqualified applicants for hiring',
    });

    // Colorado AI Act → consumer-protection (high-impact decisions)
    expect(
      r.mandatory['consumer-protection'].some((f) => f.frameworkId === 'colorado-ai-act'),
    ).toBe(true);

    // HIPAA → sector-specific (health)
    expect(
      r.mandatory['sector-specific'].some((f) => f.frameworkId === 'hipaa'),
    ).toBe(true);

    // CCPA → privacy (California PII)
    expect(r.mandatory.privacy.some((f) => f.frameworkId === 'ccpa-cpra')).toBe(true);

    // UK GDPR → privacy (UK data subjects)
    expect(r.mandatory.privacy.some((f) => f.frameworkId === 'uk-gdpr-dpa-2018')).toBe(true);
  });

  it('flags carry mandatoryIn jurisdictions and scopeNote where applicable', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['EHR patient health records']),
    });
    const hipaa = r.all.find((f) => f.frameworkId === 'hipaa');
    expect(hipaa).toBeDefined();
    expect(hipaa!.mandatoryIn).toEqual(['US']);
    expect(hipaa!.scopeNote).toBeTruthy();
  });
});

// ─── Decision impact classifier ─────────────────────────────────────────────

describe('classifyDecisionImpact', () => {
  it('returns none when not deciding', () => {
    expect(classifyDecisionImpact(false)).toBe('none');
  });
  it('returns unclear without details', () => {
    expect(classifyDecisionImpact(true)).toBe('unclear');
  });
  it('detects high-impact employment', () => {
    expect(
      classifyDecisionImpact(true, 'we screen candidate resumes for hiring decisions'),
    ).toBe('high');
  });
  it('detects medium-impact scoring', () => {
    expect(
      classifyDecisionImpact(true, 'we score and rank leads for sales outreach campaigns'),
    ).toBe('medium');
  });
});

describe('detectSignals', () => {
  it('flags employment-related decisions', () => {
    const s = detectSignals(
      [],
      tx(['screening applicants']),
      true,
      'We screen candidates and recommend hiring decisions',
    );
    expect(s.hasEmploymentDecisions).toBe(true);
    expect(s.decisionImpact).toBe('high');
  });
});

describe('detectSignals — new AAP-31 signals', () => {
  describe('hasCoveredEntitySignal (HIPAA)', () => {
    it('matches EHR/EMR vocabulary', () => {
      const s = detectSignals(
        [],
        tx(['We integrate with EHR systems and process PHI']),
        false,
      );
      expect(s.hasCoveredEntitySignal).toBe(true);
    });

    it('matches "covered entity" phrase', () => {
      const s = detectSignals([], tx(['We are a HIPAA covered entity']), false);
      expect(s.hasCoveredEntitySignal).toBe(true);
    });

    it('does not fire on generic "health data"', () => {
      const s = detectSignals([], tx(['We process user health data']), false);
      expect(s.hasCoveredEntitySignal).toBe(false);
    });

    it('does not fire on wellness/fitness context', () => {
      const s = detectSignals([], tx(['fitness tracker wellness app']), false);
      expect(s.hasCoveredEntitySignal).toBe(false);
    });
  });

  describe('hasConsequentialDecisionSignal (Colorado 8 domains)', () => {
    it('matches employment morphological variants', () => {
      expect(detectSignals([], tx(['hire candidates']), true, 'screening applicants').hasConsequentialDecisionSignal).toBe(true);
      expect(detectSignals([], tx([]), true, 'hiring').hasConsequentialDecisionSignal).toBe(true);
    });
    it('matches credit/lending', () => {
      expect(detectSignals([], tx(['loan underwriting']), true, 'credit decisions').hasConsequentialDecisionSignal).toBe(true);
    });
    it('matches housing', () => {
      expect(detectSignals([], tx([]), true, 'rental application decisions').hasConsequentialDecisionSignal).toBe(true);
    });
    it('matches insurance', () => {
      expect(detectSignals([], tx([]), true, 'insurance claim denial').hasConsequentialDecisionSignal).toBe(true);
    });
    it('does not fire on generic customer service', () => {
      expect(detectSignals([], tx(['answer customer questions']), true, 'reply to queries').hasConsequentialDecisionSignal).toBe(false);
    });
  });

  describe('hasSignificantDecisionSignal (CCPA 5 domains)', () => {
    it('matches CCPA significant-decision domains', () => {
      expect(detectSignals([], tx([]), true, 'credit scoring').hasSignificantDecisionSignal).toBe(true);
      expect(detectSignals([], tx([]), true, 'school admission').hasSignificantDecisionSignal).toBe(true);
    });
    it('does not fire on insurance context (outside CCPA 5 domains)', () => {
      expect(
        detectSignals([], tx([]), true, 'insurer coverage denial').hasSignificantDecisionSignal,
      ).toBe(false);
    });
  });

  describe('hasBiometricSignal (Annex III §1)', () => {
    it('fires on facial recognition', () => {
      expect(detectSignals([], tx(['facial recognition matching']), false).hasBiometricSignal).toBe(true);
    });
    it('fires on voiceprint', () => {
      expect(detectSignals([], tx(['voiceprint analysis']), false).hasBiometricSignal).toBe(true);
    });
    it('does not fire on generic biometrics-adjacent language', () => {
      expect(detectSignals([], tx(['user photo upload']), false).hasBiometricSignal).toBe(false);
    });
  });

  describe('isEducationAssessmentContext (Annex III §3)', () => {
    it('fires on grading', () => {
      expect(detectSignals([], tx([]), true, 'automated grading of student submissions').isEducationAssessmentContext).toBe(true);
    });
    it('fires on admission decisions', () => {
      expect(detectSignals([], tx([]), true, 'university admission decisions').isEducationAssessmentContext).toBe(true);
    });
  });

  describe('isLawEnforcementContext (Annex III §6)', () => {
    it('fires on police/law enforcement', () => {
      expect(detectSignals([], tx(['law enforcement investigations']), true, 'crime prediction').isLawEnforcementContext).toBe(true);
    });
    it('fires on parole/sentencing', () => {
      expect(detectSignals([], tx([]), true, 'parole recommendations').isLawEnforcementContext).toBe(true);
    });
  });

  describe('hasEssentialServicesSignal (Annex III §5)', () => {
    it('fires on credit scoring', () => {
      expect(detectSignals([], tx([]), true, 'credit scoring for loan applicants').hasEssentialServicesSignal).toBe(true);
    });
    it('fires on public benefits eligibility', () => {
      expect(detectSignals([], tx(['welfare benefit eligibility determination']), true).hasEssentialServicesSignal).toBe(true);
    });
    it('does not fire on generic org decisions', () => {
      expect(detectSignals([], tx(['internal workforce planning decisions']), true).hasEssentialServicesSignal).toBe(false);
    });
  });
});

describe('Framework registry — deprecated entries removed', () => {
  it('does not include nyc-ll144', () => {
    expect(FRAMEWORKS).not.toHaveProperty('nyc-ll144');
  });
  it('does not include ico-ai-toolkit', () => {
    expect(FRAMEWORKS).not.toHaveProperty('ico-ai-toolkit');
  });
  it('no CONTROL_MAPPINGS reference nyc-ll144', () => {
    for (const mapping of Object.values(CONTROL_MAPPINGS)) {
      const ids = mapping.controls.map((c) => c.frameworkId);
      expect(ids).not.toContain('nyc-ll144');
    }
  });
  it('no CONTROL_MAPPINGS reference ico-ai-toolkit', () => {
    for (const mapping of Object.values(CONTROL_MAPPINGS)) {
      const ids = mapping.controls.map((c) => c.frameworkId);
      expect(ids).not.toContain('ico-ai-toolkit');
    }
  });
});

describe('hasEmploymentDecisions — plural/gerund matching (regex bug fix)', () => {
  it('matches "hiring" (gerund)', () => {
    expect(detectSignals([], tx([]), true, 'hiring decisions').hasEmploymentDecisions).toBe(true);
  });
  it('matches "candidates" (plural)', () => {
    expect(detectSignals([], tx(['screen candidates for positions']), true, 'applicants').hasEmploymentDecisions).toBe(true);
  });
  it('matches "applicants" and "resumes"', () => {
    expect(detectSignals([], tx([]), true, 'review applicants and resumes').hasEmploymentDecisions).toBe(true);
  });
  it('matches "recruiting/recruiter"', () => {
    expect(detectSignals([], tx(['our recruiter uses this']), true, 'recruiting').hasEmploymentDecisions).toBe(true);
  });
});

describe('Colorado AI Act scope-gate', () => {
  const baseInput = {
    systems: [baseSystem()],
    transcript: tx(['hire candidates']),
    makesDecisionsAboutPeople: true,
  };

  it('fires on decisionImpact=high + consequential signal', () => {
    const r = mapFindingsToRiskCategories({
      ...baseInput,
      decisionMakingDetails: 'screen candidates and make hiring decisions',
    });
    expect(r.all.some((f) => f.frameworkId === 'colorado-ai-act')).toBe(true);
  });

  it('does NOT fire on decisionImpact=medium (generic scoring)', () => {
    const r = mapFindingsToRiskCategories({
      ...baseInput,
      decisionMakingDetails: 'rank leads for sales outreach',
    });
    expect(r.all.some((f) => f.frameworkId === 'colorado-ai-act')).toBe(false);
  });

  it('does NOT fire on decisionImpact=unclear', () => {
    const r = mapFindingsToRiskCategories({
      ...baseInput,
      decisionMakingDetails: 'make decisions',
    });
    expect(r.all.some((f) => f.frameworkId === 'colorado-ai-act')).toBe(false);
  });

  it('does NOT fire on high-impact decision outside 8 domains', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['reject refund requests for customers']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'reject refund requests based on fraud score',
    });
    expect(r.all.some((f) => f.frameworkId === 'colorado-ai-act')).toBe(false);
  });

  it('fires on loan denial (credit/lending domain)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'approve or deny loan applications based on underwriting',
    });
    expect(r.all.some((f) => f.frameworkId === 'colorado-ai-act')).toBe(true);
  });
});

describe('HIPAA scope-gate', () => {
  it('fires on hasHealth + covered-entity signal', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['EHR patient records clinical data']),
    });
    expect(r.all.some((f) => f.frameworkId === 'hipaa')).toBe(true);
  });

  it('does NOT fire on hasHealth without covered-entity signal', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['wellness app with health data from users']),
    });
    expect(r.all.some((f) => f.frameworkId === 'hipaa')).toBe(false);
  });

  it('does NOT fire when no health signal present', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['generic customer support data']),
    });
    expect(r.all.some((f) => f.frameworkId === 'hipaa')).toBe(false);
  });
});

describe('CCPA scope-gate (base flag only, no ADMT sub-flag in v1)', () => {
  it('fires on sensitive-data with hasPII', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['name, email, phone PII collected from users']),
    });
    expect(r.all.some((f) => f.frameworkId === 'ccpa-cpra')).toBe(true);
  });

  it('fires only ONCE on ccpa-cpra (no ADMT sub-flag)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['email, phone PII']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'credit scoring for loan approval',
    });
    const ccpaFlags = r.all.filter((f) => f.frameworkId === 'ccpa-cpra');
    expect(ccpaFlags.length).toBe(1);
  });

  it('does NOT fire without PII signals', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['generic anonymous telemetry metrics only']),
    });
    expect(r.all.some((f) => f.frameworkId === 'ccpa-cpra')).toBe(false);
  });
});

describe('Framework registry — primarySource', () => {
  it('every framework has a primarySource URL', () => {
    for (const [id, f] of Object.entries(FRAMEWORKS)) {
      expect(f.primarySource, `framework ${id}`).toBeTruthy();
      expect(f.primarySource, `framework ${id}`).toMatch(/^https?:\/\//);
    }
  });
});

describe('EU AI Act — two-level gating', () => {
  it('base eu-ai-act fires on every active finding', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['name, email PII']),
    });
    expect(r.all.some((f) => f.frameworkId === 'eu-ai-act')).toBe(true);
  });

  it('high-risk fires on biometric sensitive-data (Annex III §1)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['facial recognition with ssn government id']),
    });
    expect(r.all.some((f) => f.frameworkId === 'eu-ai-act-high-risk')).toBe(true);
  });

  it('high-risk fires on employment decisions (Annex III §4)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screen candidates for hiring',
    });
    expect(r.all.some((f) => f.frameworkId === 'eu-ai-act-high-risk')).toBe(true);
  });

  it('high-risk fires on education assessment (Annex III §3)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'student exam grading and admission decisions',
    });
    expect(r.all.some((f) => f.frameworkId === 'eu-ai-act-high-risk')).toBe(true);
  });

  it('high-risk fires on law enforcement (Annex III §6)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['police criminal investigation']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'predictive policing',
    });
    expect(r.all.some((f) => f.frameworkId === 'eu-ai-act-high-risk')).toBe(true);
  });

  it('high-risk does NOT fire on generic decisions without Annex III match', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['refund request approval decisions']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'approve refunds based on policy',
    });
    expect(r.all.some((f) => f.frameworkId === 'eu-ai-act-high-risk')).toBe(false);
  });

  it('high-risk fires on essential services credit scoring (Annex III §5)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'approve or deny consumer loan applications based on credit scoring',
    });
    expect(r.all.some((f) => f.frameworkId === 'eu-ai-act-high-risk')).toBe(true);
  });

  it('high-risk does NOT duplicate across all finding types for law enforcement', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['police criminal investigation']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'predictive policing recidivism assessment',
    });
    const hrFlags = r.all.filter((f) => f.frameworkId === 'eu-ai-act-high-risk');
    // Should fire only on decisions-about-people and/or regulatory-flags findings,
    // NOT on every finding type (excessive-access, write-risk, etc.)
    for (const f of hrFlags) {
      expect(['decisions-about-people', 'regulatory-flags']).toContain(f.triggeredBy);
    }
  });
});

describe('Control-mapping citations — every row carries a note', () => {
  it('every FrameworkControl has a non-empty note', () => {
    for (const [findingType, mapping] of Object.entries(CONTROL_MAPPINGS)) {
      for (const ctrl of mapping.controls) {
        expect(ctrl.note, `${findingType} / ${ctrl.frameworkId} / ${ctrl.controlId}`).toBeTruthy();
      }
    }
  });
});

describe('Flag disclaimers — statute jurisdictional caveats', () => {
  function findingWith(input: MapperInput, frameworkId: string) {
    const r = mapFindingsToRiskCategories(input);
    return r.all.find((f) => f.frameworkId === frameworkId);
  }

  it('Colorado flag description names Colorado business/residents test', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx(['hire candidates']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screen candidates for hiring',
    }, 'colorado-ai-act');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/Colorado/i);
    expect(flag!.description).toMatch(/2026-06-30|June 30, 2026/);
  });

  it('CCPA flag description names CCPA thresholds', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx(['name email phone PII']),
    }, 'ccpa-cpra');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/26,625,000|CCPA threshold/i);
    expect(flag!.description).toMatch(/California resident/i);
  });

  it('HIPAA flag description names covered-entity test + HBNR fallback', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx(['EHR patient records']),
    }, 'hipaa');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/covered entity/i);
    expect(flag!.description).toMatch(/FTC Health Breach Notification Rule|HBNR/i);
  });

  it('UK GDPR flag description names targeting/monitoring test', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx(['name email phone PII']),
    }, 'uk-gdpr-dpa-2018');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/UK data subjects|UK.based behaviour/i);
  });

  it('EU AI Act base flag description names EU market/output test', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx(['name email PII']),
    }, 'eu-ai-act');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/EU market|outputs are used in the EU/i);
  });

  it('EU AI Act high-risk flag description references Annex III + profiling disclaimer', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screen candidates for hiring',
    }, 'eu-ai-act-high-risk');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/Annex III/i);
    expect(flag!.description).toMatch(/profiling/i);
  });
});

describe('Legacy removal', () => {
  it('mapper module does not export toLegacyJurisdictions', async () => {
    const m = await import('../../src/compliance/mapper.js');
    expect((m as Record<string, unknown>).toLegacyJurisdictions).toBeUndefined();
  });
});
