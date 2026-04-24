import { describe, it, expect } from 'vitest';
import {
  mapFindingsToRiskCategories,
  detectSignals,
  classifyDecisionImpact,
  classifyEUAIAct,
  type MapperInput,
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

describe('frameworks registry (post-AAP-42 scope cut)', () => {
  it('contains exactly the 3 v1 frameworks', () => {
    const ids = Object.keys(FRAMEWORKS).sort();
    expect(ids).toEqual(['eu-ai-act', 'gdpr', 'iso-42001']);
  });

  it('uses Jurisdiction[] for mandatoriness', () => {
    for (const f of Object.values(FRAMEWORKS)) {
      expect(Array.isArray(f.mandatoryIn)).toBe(true);
    }
    expect(FRAMEWORKS['eu-ai-act'].mandatoryIn).toContain('EU');
    expect(FRAMEWORKS.gdpr.mandatoryIn).toContain('EU');
    expect(FRAMEWORKS['iso-42001'].mandatoryIn).toEqual([]);
  });

  it('partitions cleanly into mandatory + voluntary', () => {
    const m = listMandatoryFrameworks().map((f) => f.id);
    const v = listVoluntaryFrameworks().map((f) => f.id);
    expect(m).toEqual(expect.arrayContaining(['eu-ai-act', 'gdpr']));
    expect(v).toEqual(['iso-42001']);
    for (const id of m) expect(v).not.toContain(id);
  });

  it('frameworksFor(EU) includes EU AI Act and GDPR', () => {
    const eu = frameworksFor('EU').map((f) => f.id);
    expect(eu).toContain('eu-ai-act');
    expect(eu).toContain('gdpr');
  });

  it('every framework has a primarySource URL', () => {
    for (const [id, f] of Object.entries(FRAMEWORKS)) {
      expect(f.primarySource, `framework ${id}`).toBeTruthy();
      expect(f.primarySource, `framework ${id}`).toMatch(/^https?:\/\//);
    }
  });
});

// ─── Deprecated frameworks fully removed ────────────────────────────────────

describe('Removed frameworks (AAP-42 scope cut)', () => {
  const removed = [
    'uk-gdpr-dpa-2018',
    'colorado-ai-act',
    'hipaa',
    'ccpa-cpra',
    'nist-ai-rmf',
    'iso-23894',
    'soc-2',
    'eu-ai-act-high-risk',
    'nyc-ll144',
    'ico-ai-toolkit',
  ];

  for (const id of removed) {
    it(`registry does not contain ${id}`, () => {
      expect(FRAMEWORKS).not.toHaveProperty(id);
    });
    it(`no CONTROL_MAPPINGS reference ${id}`, () => {
      for (const mapping of Object.values(CONTROL_MAPPINGS)) {
        const ids = mapping.controls.map((c) => c.frameworkId);
        expect(ids).not.toContain(id);
      }
    });
  }
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

  it('sensitive-data activates EU AI Act, GDPR, ISO 42001', () => {
    const ids = CONTROL_MAPPINGS['sensitive-data'].controls.map((c) => c.frameworkId);
    expect(ids).toContain('eu-ai-act');
    expect(ids).toContain('gdpr');
    expect(ids).toContain('iso-42001');
  });

  it('decisions-about-people activates EU AI Act (base + annexIII) and GDPR', () => {
    const ctrls = CONTROL_MAPPINGS['decisions-about-people'].controls;
    const ids = ctrls.map((c) => c.frameworkId);
    expect(ids).toContain('eu-ai-act');
    expect(ids).toContain('gdpr');
    // Some EU AI Act controls are Annex III-gated (only fire on high-risk)
    expect(ctrls.some((c) => c.frameworkId === 'eu-ai-act' && c.annexIII === true)).toBe(true);
    // Some are baseline (always fire)
    expect(ctrls.some((c) => c.frameworkId === 'eu-ai-act' && !c.annexIII)).toBe(true);
  });

  it('every FrameworkControl has a non-empty note', () => {
    for (const [findingType, mapping] of Object.entries(CONTROL_MAPPINGS)) {
      for (const ctrl of mapping.controls) {
        expect(ctrl.note, `${findingType} / ${ctrl.frameworkId} / ${ctrl.controlId}`).toBeTruthy();
      }
    }
  });
});

// ─── mapFindingsToRiskCategories ────────────────────────────────────────────

describe('mapFindingsToRiskCategories', () => {
  it('stamps mapping version (AAP-43)', () => {
    const r = mapFindingsToRiskCategories({ systems: [], transcript: [] });
    expect(r.mappingVersion).toBe(MAPPING_VERSION);
    expect(r.mappingVersion).toMatch(/^aap-43/);
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

  it('every flag carries a description with framework name', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['name email pii via api']),
    });
    expect(r.all.length).toBeGreaterThan(0);
    for (const f of r.all) {
      expect(f.description.length).toBeGreaterThan(20);
    }
  });

  it('attaches euAiActClassification to every audit output', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['name email PII']),
    });
    expect(r.euAiActClassification).toBeDefined();
    expect(['prohibited', 'high-risk', 'limited', 'minimal', 'unclassified'])
      .toContain(r.euAiActClassification.classification);
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

describe('hasEmploymentDecisions — plural/gerund matching', () => {
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

// ─── EU AI Act classification (replaces former two-entry split) ─────────────

describe('classifyEUAIAct', () => {
  const baseSignals = () =>
    detectSignals([], tx([]), false);

  it('defaults to limited-risk when no Annex III signals match', () => {
    const s = detectSignals([], tx(['name email PII for sales outreach']), false);
    const cls = classifyEUAIAct(s);
    expect(cls.classification).toBe('limited');
    expect(cls.annexIIICategories).toEqual([]);
  });

  it('classifies high-risk with §1 category when biometric + sensitive PII detected', () => {
    const s = detectSignals(
      [],
      tx(['facial recognition with ssn government id']),
      false,
    );
    const cls = classifyEUAIAct(s);
    expect(cls.classification).toBe('high-risk');
    expect(cls.annexIIICategories.some((c) => c.includes('§1'))).toBe(true);
  });

  it('classifies high-risk with §4 category for employment decisions', () => {
    const s = detectSignals(
      [],
      tx([]),
      true,
      'screen candidates for hiring',
    );
    const cls = classifyEUAIAct(s);
    expect(cls.classification).toBe('high-risk');
    expect(cls.annexIIICategories.some((c) => c.includes('§4'))).toBe(true);
  });

  it('classifies high-risk with §3 category for education assessment', () => {
    const s = detectSignals(
      [],
      tx([]),
      true,
      'student exam grading and admission decisions',
    );
    const cls = classifyEUAIAct(s);
    expect(cls.classification).toBe('high-risk');
    expect(cls.annexIIICategories.some((c) => c.includes('§3'))).toBe(true);
  });

  it('classifies high-risk with §6 category for law enforcement', () => {
    const s = detectSignals(
      [],
      tx(['police criminal investigation']),
      true,
      'predictive policing',
    );
    const cls = classifyEUAIAct(s);
    expect(cls.classification).toBe('high-risk');
    expect(cls.annexIIICategories.some((c) => c.includes('§6'))).toBe(true);
  });

  it('classifies high-risk with §5 category for essential services credit scoring', () => {
    const s = detectSignals(
      [],
      tx([]),
      true,
      'approve or deny consumer loan applications based on credit scoring',
    );
    const cls = classifyEUAIAct(s);
    expect(cls.classification).toBe('high-risk');
    expect(cls.annexIIICategories.some((c) => c.includes('§5'))).toBe(true);
  });
});

// ─── EU AI Act per-control Annex III gating ─────────────────────────────────

describe('EU AI Act single-framework entry with Annex III gating', () => {
  it('emits exactly one EU AI Act flag per finding type (not two)', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screen candidates for hiring',
    });

    // All EU AI Act flags should share the single framework ID `eu-ai-act`
    const euFlags = r.all.filter((f) => f.frameworkId === 'eu-ai-act');
    expect(euFlags.length).toBeGreaterThan(0);

    // No flag should use the old `eu-ai-act-high-risk` ID
    expect(r.all.some((f) => (f.frameworkId as string) === 'eu-ai-act-high-risk')).toBe(false);

    // frameworksActivated contains only the single entry
    expect(r.frameworksActivated).toContain('eu-ai-act');
    expect((r.frameworksActivated as string[])).not.toContain('eu-ai-act-high-risk');
  });

  it('Annex III-tagged controls only appear when high-risk', () => {
    // High-risk audit: Annex III §4 employment
    const highRisk = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screen candidates for hiring',
    });
    const hrControlIds = highRisk.all
      .filter((f) => f.frameworkId === 'eu-ai-act')
      .flatMap((f) => f.controlIds);
    // Should include at least one known Annex III control
    expect(hrControlIds.some((id) => /Annex III|Art\. 9$|Art\. 10$|Art\. 14$|Art\. 27/.test(id))).toBe(true);

    // Limited-risk audit: generic outreach, no Annex III signals
    const limited = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx(['name, email PII for sales outreach']),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'rank leads for outreach',
    });
    const limitedControlIds = limited.all
      .filter((f) => f.frameworkId === 'eu-ai-act')
      .flatMap((f) => f.controlIds);
    // Must NOT include Annex III-only controls
    expect(limitedControlIds.includes('Art. 27')).toBe(false);
    expect(limitedControlIds.includes('Art. 43')).toBe(false);
    expect(limitedControlIds.includes('Art. 49')).toBe(false);
    // But should include baseline (e.g. Art. 50)
    expect(limitedControlIds.some((id) => /Art\. 50|Art\. 14\(4\)\(d\)|Art\. 9\(1\)/.test(id))).toBe(true);
  });

  it('each EU AI Act flag carries euAiActClassification that matches the audit-level classification', () => {
    const r = mapFindingsToRiskCategories({
      systems: [baseSystem()],
      transcript: tx([]),
      makesDecisionsAboutPeople: true,
      decisionMakingDetails: 'screen candidates for hiring',
    });
    for (const f of r.all.filter((f) => f.frameworkId === 'eu-ai-act')) {
      expect(f.euAiActClassification).toBe(r.euAiActClassification.classification);
    }
  });
});

// ─── Flag disclaimer (jurisdictional caveat) ────────────────────────────────

describe('Flag disclaimers — surviving frameworks only', () => {
  function findingWith(input: MapperInput, frameworkId: string) {
    const r = mapFindingsToRiskCategories(input);
    return r.all.find((f) => f.frameworkId === frameworkId);
  }

  it('EU AI Act flag description names EU market/output test', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx(['name email PII']),
    }, 'eu-ai-act');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/EU market|outputs are used in the EU/i);
  });

  it('GDPR flag description names EU data-subject test', () => {
    const flag = findingWith({
      systems: [baseSystem()],
      transcript: tx(['name email PII']),
    }, 'gdpr');
    expect(flag).toBeDefined();
    expect(flag!.description).toMatch(/EU data subjects|EU-based behaviour/i);
  });
});

describe('Legacy removal', () => {
  it('mapper module does not export toLegacyJurisdictions', async () => {
    const m = await import('../../src/compliance/mapper.js');
    expect((m as Record<string, unknown>).toLegacyJurisdictions).toBeUndefined();
  });
});
