/**
 * Maps raw audit signals (systems, transcript, decision metadata) onto the
 * framework-control bundles defined in `./control-mappings.ts`.
 *
 * Output shape: `CategorizedCompliance`, grouped by mandatoriness
 * (mandatory vs voluntary) and risk category (privacy / IP /
 * consumer-protection / sector-specific). The report template renders
 * this directly.
 *
 * The "framework gating" logic decides whether a jurisdiction-specific
 * statute (e.g. Colorado AI Act, HIPAA, CCPA) applies to the
 * currently-detected signals. Unlike generic frameworks (which always fire
 * whenever the finding is active), these narrow statutes only fire when the
 * signals match their jurisdictional scope — otherwise we'd spam the report
 * with irrelevant US-state flags.
 */

import type {
  QAPair,
  RegulatoryFlag,
  SystemAssessment,
} from '../report/types.js';
import { CONTROL_MAPPINGS } from './control-mappings.js';
import { FRAMEWORKS } from './frameworks.js';
import type {
  ControlMapping,
  FindingType,
  Framework,
  FrameworkControl,
  FrameworkId,
  FrameworkTier,
  Jurisdiction,
  RiskCategory,
} from './types.js';
import { MAPPING_VERSION } from './types.js';

// ─── Decision impact ────────────────────────────────────────────────────────

export type DecisionImpact = 'high' | 'medium' | 'unclear' | 'none';

export function classifyDecisionImpact(
  decidesAboutPeople: boolean,
  details?: string,
): DecisionImpact {
  if (!decidesAboutPeople) return 'none';
  if (!details || details === 'NOT PROVIDED' || details.trim().length < 10)
    return 'unclear';

  const text = details.toLowerCase();

  const highImpact =
    /\b(hir(e|ing)|recruit|screen.?candidate|reject|deny|approv(e|al|ing).*(loan|credit|mortgage|claim|application)|terminat|fir(e|ing)|credit.?scor|insurance.?claim|diagnos|prescri|legal.?decision|sentenc|parole|bail|evict|expel|suspend|disqualif|ban\b|block.?user|delist)\b/i;
  if (highImpact.test(text)) return 'high';

  const mediumImpact =
    /\b(scor(e|ing)|rank|filter|recommend|prioriti[sz]|moderate|flag|qualif(y|ied)|match|sort|categori[sz]|segment|lead|prospect|outreach|target|personali[sz])\b/i;
  if (mediumImpact.test(text)) return 'medium';

  return 'unclear';
}

// ─── Signal detection ───────────────────────────────────────────────────────

export interface ComplianceSignals {
  hasSensitivePII: boolean;
  hasPublicPII: boolean;
  hasPII: boolean;
  hasHealth: boolean;
  hasEmploymentDecisions: boolean;
  hasWriteOps: boolean;
  hasIrreversibleWrites: boolean;
  hasExcessivePerms: boolean;
  hasScopeCreep: boolean;
  hasOrgBlast: boolean;
  hasOrgBlastWithWrites: boolean;
  decisionImpact: DecisionImpact;
  businessSystems: SystemAssessment[];

  // NEW in AAP-31 v1 — statute scope-gates
  hasCoveredEntitySignal: boolean;
  hasConsequentialDecisionSignal: boolean;
  hasSignificantDecisionSignal: boolean;

  // NEW in AAP-31 v1 — EU AI Act Annex III high-risk detection
  hasBiometricSignal: boolean;
  isEducationAssessmentContext: boolean;
  isLawEnforcementContext: boolean;
}

// Colorado SB 24-205 §6-1-1701(3): 8 enumerated consequential-decision domains.
const CONSEQUENTIAL_DECISION_PATTERN = new RegExp(
  '\\b(' + [
    'education|school|university|admission|enrollment|financial.?aid',
    'hir(e|ing)?|recruit(er|ing)?|employ(ee|er|ment)?|candidates?|resumes?|applicants?|screen|promot|terminat|fir(e|ing)',
    'credit|loan|mortgage|underwrit|credit.?scor|deni(al|ed)?',
    'benefit|eligib|license|permit|government.?service',
    'treatment|diagnos|prescri|clinical',
    'rent(al)?|lease|eviction|housing',
    'insur(ance)?|claim|premium',
    'sentenc|parole|bail|deport|legal.?service',
  ].join('|') + ')\\b',
  'i',
);

// CCPA § 7001(e) "significant decisions": narrower 5-domain list.
const SIGNIFICANT_DECISION_PATTERN = new RegExp(
  '\\b(' + [
    'credit|loan|mortgage|underwrit',
    'rent|lease|housing',
    'education|school|university|admission|enrollment',
    'hir(e|ing)?|recruit(er|ing)?|employ(ee|er|ment)?|candidates?|applicants?',
    'treatment|clinical|health.?care',
  ].join('|') + ')\\b',
  'i',
);

// HIPAA covered-entity detection per 45 CFR 160.103.
const COVERED_ENTITY_PATTERN = new RegExp(
  '\\b(' + [
    'ehr|emr|phi|protected.?health',
    'clinical|provider|hospital|clinic',
    'covered.?entity|business.?associate|baa',
    'hipaa|payer|insurer|claims',
  ].join('|') + ')\\b',
  'i',
);

// EU AI Act Annex III §1 — biometric identification/categorisation/emotion recognition.
const BIOMETRIC_PATTERN = new RegExp(
  '\\b(' + [
    'biometric|facial.?recognition|face.?recognit',
    'voiceprint|voice.?biometric|speaker.?recognit',
    'fingerprint|iris|retina|gait',
    'emotion.?recognition|affect.?detect',
    'liveness|anti.?spoof',
  ].join('|') + ')\\b',
  'i',
);

// EU AI Act Annex III §3 — education/vocational training assessment.
const EDUCATION_ASSESSMENT_PATTERN = new RegExp(
  '\\b(' + [
    'student.?evaluation|grading|exam.?scoring|exam.?proctor',
    'admission|enrollment|school.?assignment',
    'academic.?assessment|learning.?assessment',
    'vocational.?training|apprenticeship',
  ].join('|') + ')\\b',
  'i',
);

// EU AI Act Annex III §6 — law enforcement.
const LAW_ENFORCEMENT_PATTERN = new RegExp(
  '\\b(' + [
    'law.?enforcement|police|prosecut',
    'criminal.?investigation|criminal.?justice',
    'border|immigration|asylum',
    'parole|recidivism|sentenc',
    'predictive.?policing',
  ].join('|') + ')\\b',
  'i',
);

function isBusinessSystem(s: SystemAssessment): boolean {
  const id = s.systemId.toLowerCase();
  if (/\bheron\b/.test(id)) return false;
  if (/internal\s*(orchestrat|api|platform)/.test(id)) return false;
  if (/interview\s*(platform|endpoint|api)/.test(id)) return false;
  if (/audit\s*(platform|endpoint|api)/.test(id)) return false;
  if (/platform.?session.?token/i.test(id) && s.scopesRequested.length === 0)
    return false;
  return true;
}

export function detectSignals(
  systems: SystemAssessment[],
  transcript: QAPair[],
  decidesAboutPeople: boolean,
  decisionMakingDetails?: string,
): ComplianceSignals {
  const allText = transcript.map((qa) => qa.answer.toLowerCase()).join(' ');

  const hasSensitivePII =
    /\b(ssn|passport|social.?security|date.?of.?birth|dob|bank.?account|credit.?card|driver.?licen[sc]e|tax.?id|national.?id)\b/i.test(
      allText,
    );
  const hasPublicPII =
    /\b(pii|personal|email|name|phone|address|linkedin|profile|title|company)\b/i.test(
      allText,
    );
  const hasPII = hasSensitivePII || hasPublicPII;

  const hasMedicalTerms =
    /\b(medical|patient|hipaa|diagnosis|prescription|clinical|ehr|emr|phi\b|protected.?health)\b/i.test(
      allText,
    );
  const hasHealthInContext =
    /\b(health)\b/i.test(allText) &&
    !/health.?check|health.?endpoint|health.?status|health.?ping|health(y|ier)/i.test(
      allText,
    ) &&
    /\b(data|record|information|system|care|provider)\b/i.test(allText);
  const hasHealth = hasMedicalTerms || hasHealthInContext;

  const hasEmploymentDecisions = /\b(hir(e|ing)?|recruit(er|ing)?|employ(ee|er|ment)?|candidates?|resumes?|applicants?)\b/i.test(
    (decisionMakingDetails ?? '') + ' ' + allText,
  );

  const combinedText = (decisionMakingDetails ?? '') + ' ' + allText;

  const hasCoveredEntitySignal = COVERED_ENTITY_PATTERN.test(allText);
  const hasConsequentialDecisionSignal = CONSEQUENTIAL_DECISION_PATTERN.test(combinedText);
  const hasSignificantDecisionSignal = SIGNIFICANT_DECISION_PATTERN.test(combinedText);
  const hasBiometricSignal = BIOMETRIC_PATTERN.test(allText);
  const isEducationAssessmentContext = EDUCATION_ASSESSMENT_PATTERN.test(combinedText);
  const isLawEnforcementContext = LAW_ENFORCEMENT_PATTERN.test(combinedText);

  const businessSystems = systems.filter(isBusinessSystem);

  const hasWriteOps = businessSystems.some((s) => s.writeOperations.length > 0);
  const hasIrreversibleWrites = businessSystems.some((s) =>
    s.writeOperations.some((w) => !w.reversible),
  );
  const hasExcessivePerms = businessSystems.some((s) => s.scopesDelta.length > 0);
  const hasScopeCreep = businessSystems.some(
    (s) =>
      s.scopesNeeded.length > 0 &&
      s.scopesRequested.length > s.scopesNeeded.length,
  );
  const hasOrgBlast = businessSystems.some(
    (s) => s.blastRadius === 'org-wide' || s.blastRadius === 'cross-tenant',
  );
  const hasOrgBlastWithWrites = hasOrgBlast && hasWriteOps;

  const decisionImpact = classifyDecisionImpact(
    decidesAboutPeople,
    decisionMakingDetails,
  );

  return {
    hasSensitivePII,
    hasPublicPII,
    hasPII,
    hasHealth,
    hasEmploymentDecisions,
    hasWriteOps,
    hasIrreversibleWrites,
    hasExcessivePerms,
    hasScopeCreep,
    hasOrgBlast,
    hasOrgBlastWithWrites,
    decisionImpact,
    businessSystems,
    hasCoveredEntitySignal,
    hasConsequentialDecisionSignal,
    hasSignificantDecisionSignal,
    hasBiometricSignal,
    isEducationAssessmentContext,
    isLawEnforcementContext,
  };
}

// ─── Typed flag shape ───────────────────────────────────────────────────────

export type FlagSeverity =
  | 'info'
  | 'warning'
  | 'action-required'
  | 'clarification-needed';

export interface TypedRegulatoryFlag extends RegulatoryFlag {
  frameworkId: FrameworkId;
  /** All controls from this framework activated by the triggering finding. */
  controlIds: string[];
  category: RiskCategory;
  tier: FrameworkTier;
  mandatoryIn: Jurisdiction[];
  scopeNote?: string;
  triggeredBy: FindingType;
}

export interface CategorizedBucket {
  privacy: TypedRegulatoryFlag[];
  ip: TypedRegulatoryFlag[];
  'consumer-protection': TypedRegulatoryFlag[];
  'sector-specific': TypedRegulatoryFlag[];
}

export interface CategorizedCompliance {
  mappingVersion: string;
  mandatory: CategorizedBucket;
  voluntary: CategorizedBucket;
  /** Frameworks actually activated — drives the jurisdictional appendix. */
  frameworksActivated: FrameworkId[];
  /** Flat list for backward-compat consumers. */
  all: TypedRegulatoryFlag[];
}

function emptyBucket(): CategorizedBucket {
  return {
    privacy: [],
    ip: [],
    'consumer-protection': [],
    'sector-specific': [],
  };
}

// ─── Framework gating (jurisdiction-specific scoping) ──────────────────────

/**
 * Decides whether a framework should fire for a given finding + signal set.
 *
 * Generic frameworks (EU AI Act, GDPR, UK GDPR, NIST AI RMF, ISO, SOC 2)
 * always fire when the finding itself fires. Narrow statutes (Colorado AI Act,
 * HIPAA, CCPA) only fire when the signals match their scope — otherwise the
 * report gets spammed with US-state flags for every audit regardless of context.
 */
function frameworkApplies(
  frameworkId: FrameworkId,
  findingType: FindingType,
  signals: ComplianceSignals,
): boolean {
  switch (frameworkId) {
    case 'eu-ai-act-high-risk':
      // Annex III categories §1, §3, §4, §5, §6 gated. §2, §7, §8 deferred.
      return (
        (findingType === 'sensitive-data' && signals.hasSensitivePII && signals.hasBiometricSignal) ||
        ((findingType === 'decisions-about-people' || findingType === 'regulatory-flags') && signals.isEducationAssessmentContext) ||
        (findingType === 'decisions-about-people' && signals.hasEmploymentDecisions && signals.decisionImpact !== 'none') ||
        (findingType === 'decisions-about-people' && signals.hasOrgBlast && signals.decisionImpact === 'high') ||
        signals.isLawEnforcementContext
      );

    case 'colorado-ai-act':
      // SB 24-205 §6-1-1701(3) — consequential decisions (8 enumerated domains).
      // Fires only on high-impact decisions AND signal match for one of 8 domains.
      return (
        findingType === 'decisions-about-people' &&
        signals.decisionImpact === 'high' &&
        signals.hasConsequentialDecisionSignal
      );

    case 'hipaa':
      // 16 CFR § 318.1 + 45 CFR 160.103 — fires only when covered-entity signal
      // matches. Non-covered health apps fall under FTC HBNR; description disclaimer
      // directs deployer there.
      return signals.hasHealth && signals.hasCoveredEntitySignal;

    case 'ccpa-cpra':
      // Base CCPA flag only in v1. ADMT operational obligations effective
      // 2027-01-01 — sub-flag deferred (see design doc "Items deferred").
      return findingType === 'sensitive-data' && signals.hasPII;

    default:
      // All other frameworks (generic) always fire with their finding.
      return true;
  }
}

// ─── Jurisdictional disclaimer appender ────────────────────────────────────

function disclaimerFor(frameworkId: FrameworkId, baseDescription: string): string {
  switch (frameworkId) {
    case 'colorado-ai-act':
      return `${baseDescription} Applies only if you do business in Colorado or make consequential decisions about Colorado residents. Effective 2026-06-30 (delayed from 2026-02-01 via SB 25B-004).`;
    case 'ccpa-cpra':
      return `${baseDescription} Applies if business meets CCPA thresholds (>$26,625,000 annual gross revenue per § 1798.140(d)(1)(A) CPI-adjusted via § 1798.199.95(d); OR ≥100K CA consumers/households; OR ≥50% revenue from selling/sharing PI) AND processes data of California residents. ADMT operational obligations effective 2027-01-01.`;
    case 'hipaa':
      return `${baseDescription} Applies only if you are a HIPAA covered entity (provider, health plan, clearinghouse) or business associate. Non-covered health apps fall under FTC Health Breach Notification Rule (16 CFR Part 318).`;
    case 'uk-gdpr-dpa-2018':
      return `${baseDescription} Applies if offering goods/services to UK data subjects (targeted marketing per Art. 3(2)(a)) OR monitoring UK-based behaviour (purpose element required under Art. 3(2)(b), not mere accessibility).`;
    case 'gdpr':
      return `${baseDescription} Applies if offering goods/services to EU data subjects or monitoring EU-based behaviour (Art. 3(2)).`;
    case 'eu-ai-act':
      return `${baseDescription} Applies if placing AI on the EU market, if you are an EU-established deployer, or if outputs are used in the EU.`;
    case 'eu-ai-act-high-risk':
      return `${baseDescription} Your deployment signals match an Annex III category, classifying this as high-risk. Full obligations effective 2026-08-02. Art. 6(3) offers a narrow exemption (4 enumerated conditions AND no material outcome influence); profiling of natural persons is always high-risk across ALL Annex III categories — Art. 6(3) does not exempt profiling.`;
    default:
      return baseDescription;
  }
}

// ─── Per-finding description builder ───────────────────────────────────────

function describeFinding(
  findingType: FindingType,
  framework: Framework,
  controlIds: string[],
  signals: ComplianceSignals,
  decisionDetails?: string,
): { severity: FlagSeverity; description: string } {
  const ids = controlIds.join(', ');
  const indicative = '(indicative mapping)';

  switch (findingType) {
    case 'excessive-access':
      return {
        severity: 'warning',
        description: `Agent holds permissions beyond stated need. Activates ${framework.name} controls (${ids}) ${indicative}. Narrow scopes to the minimum required.`,
      };

    case 'scope-creep':
      return {
        severity: 'warning',
        description: `Requested scopes exceed stated needs across one or more systems. Activates ${framework.name} controls (${ids}) ${indicative}. Review purpose-limitation and change-management process.`,
      };

    case 'sensitive-data': {
      const sev: FlagSeverity = signals.hasSensitivePII
        ? 'action-required'
        : 'info';
      const qualifier = signals.hasSensitivePII
        ? 'sensitive personal data (government IDs, financial identifiers)'
        : 'personal data';
      return {
        severity: sev,
        description: `Agent processes ${qualifier}. Activates ${framework.name} controls (${ids}) ${indicative}. Ensure lawful basis, data minimization, and breach-readiness.`,
      };
    }

    case 'write-risk': {
      const sev: FlagSeverity =
        signals.hasIrreversibleWrites || signals.hasOrgBlastWithWrites
          ? 'warning'
          : 'info';
      const qualifier = signals.hasIrreversibleWrites
        ? 'Irreversible write operations detected. '
        : signals.hasOrgBlastWithWrites
          ? 'Org-wide blast radius with write access. '
          : 'Write operations detected. ';
      return {
        severity: sev,
        description: `${qualifier}Activates ${framework.name} controls (${ids}) ${indicative}. Require approval, monitoring, and rollback paths for high-impact operations.`,
      };
    }

    case 'regulatory-flags':
      return {
        severity: 'clarification-needed',
        description: `Agent may operate in a regulated domain (employment, credit, insurance, health, housing, education, legal). Activates ${framework.name} controls (${ids}) ${indicative}. Clarify the agent's domain to determine obligations.`,
      };

    case 'risk-score':
      return {
        severity: 'info',
        description: `Overall risk rating is anchored to ${framework.name} risk-management controls (${ids}) ${indicative}. See Methodology.`,
      };

    case 'decisions-about-people': {
      const impact = signals.decisionImpact;
      if (impact === 'high') {
        const employment = /\b(hir(e|ing)?|recruit(er|ing)?|employ(ee|er|ment)?|candidates?|resumes?|applicants?)\b/i.test(
          decisionDetails ?? '',
        );
        return {
          severity: 'action-required',
          description: `High-impact automated decisions about people${
            employment ? ' (employment context)' : ''
          }. Activates ${framework.name} controls (${ids}) ${indicative}. Requires human oversight, contestability, and explanation of logic.`,
        };
      }
      if (impact === 'medium') {
        return {
          severity: 'info',
          description: `Agent influences outcomes for people (scoring/ranking/recommending) without binding legal effects. Activates ${framework.name} controls (${ids}) ${indicative}. Maintain transparency and data-subject rights.`,
        };
      }
      if (impact === 'unclear') {
        return {
          severity: 'clarification-needed',
          description: `Agent reports making decisions about people but impact level is unclear. Activates ${framework.name} controls (${ids}) ${indicative}. Clarify whether decisions have legal/significant effects.`,
        };
      }
      return {
        severity: 'info',
        description: `No decisions about people detected. ${framework.name} controls (${ids}) listed for reference ${indicative}.`,
      };
    }
  }
}

// ─── Finding gating (is the finding active at all?) ────────────────────────

function isFindingActive(
  findingType: FindingType,
  signals: ComplianceSignals,
): boolean {
  switch (findingType) {
    case 'excessive-access':
      return signals.hasExcessivePerms;
    case 'write-risk':
      return signals.hasWriteOps;
    case 'sensitive-data':
      return signals.hasPII || signals.hasHealth;
    case 'scope-creep':
      return signals.hasScopeCreep || signals.hasExcessivePerms;
    case 'regulatory-flags':
      return signals.hasHealth || signals.decisionImpact !== 'none';
    case 'risk-score':
      return true;
    case 'decisions-about-people':
      return true;
  }
}

// ─── Main mapper ────────────────────────────────────────────────────────────

export interface MapperInput {
  systems: SystemAssessment[];
  transcript: QAPair[];
  makesDecisionsAboutPeople?: boolean;
  decisionMakingDetails?: string;
}

export function mapFindingsToRiskCategories(
  input: MapperInput,
): CategorizedCompliance {
  const signals = detectSignals(
    input.systems,
    input.transcript,
    input.makesDecisionsAboutPeople === true,
    input.decisionMakingDetails,
  );

  const mandatory = emptyBucket();
  const voluntary = emptyBucket();
  const all: TypedRegulatoryFlag[] = [];
  const activated = new Set<FrameworkId>();

  for (const mapping of Object.values(CONTROL_MAPPINGS) as ControlMapping[]) {
    if (!isFindingActive(mapping.findingType, signals)) continue;

    // Group controls by framework — one flag per framework per finding type.
    const byFramework = new Map<FrameworkId, FrameworkControl[]>();
    for (const ctrl of mapping.controls) {
      const arr = byFramework.get(ctrl.frameworkId) ?? [];
      arr.push(ctrl);
      byFramework.set(ctrl.frameworkId, arr);
    }

    for (const [frameworkId, controls] of byFramework) {
      if (!frameworkApplies(frameworkId, mapping.findingType, signals)) continue;

      const framework = FRAMEWORKS[frameworkId];
      const controlIds = controls.map((c) => c.controlId);
      const { severity, description: baseDescription } = describeFinding(
        mapping.findingType,
        framework,
        controlIds,
        signals,
        input.decisionMakingDetails,
      );
      const description = disclaimerFor(frameworkId, baseDescription);

      const controlsLabel = controlIds.join(', ');
      const flag: TypedRegulatoryFlag = {
        framework: `${framework.name} — ${controlsLabel}`,
        severity,
        description,
        frameworkId: framework.id,
        controlIds,
        category: mapping.category,
        tier: framework.tier,
        mandatoryIn: framework.mandatoryIn,
        scopeNote: framework.scopeNote,
        triggeredBy: mapping.findingType,
      };

      all.push(flag);
      activated.add(framework.id);
      const bucket = framework.tier === 'mandatory' ? mandatory : voluntary;
      bucket[mapping.category].push(flag);
    }
  }

  return {
    mappingVersion: MAPPING_VERSION,
    mandatory,
    voluntary,
    frameworksActivated: [...activated],
    all,
  };
}
