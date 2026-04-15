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
 * statute (e.g. Colorado AI Act, NYC LL144, HIPAA, CCPA) applies to the
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
}

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

  const hasEmploymentDecisions = /\b(hir|recruit|employ|candidate|resume|applicant)\b/i.test(
    (decisionMakingDetails ?? '') + ' ' + allText,
  );

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
 * Generic frameworks (EU AI Act, GDPR, UK GDPR, NIST AI RMF, ISO, SOC 2,
 * ICO Toolkit) always fire when the finding itself fires. Narrow statutes
 * (Colorado AI Act, NYC LL144, HIPAA, CCPA) only fire when the signals
 * match their scope — otherwise the report gets spammed with US-state
 * flags for every audit regardless of context.
 */
function frameworkApplies(
  frameworkId: FrameworkId,
  findingType: FindingType,
  signals: ComplianceSignals,
): boolean {
  switch (frameworkId) {
    case 'colorado-ai-act':
      // Applies only for high-impact or unclear consequential decisions,
      // or when the finding itself is sector-specific regulatory scope.
      return (
        (findingType === 'decisions-about-people' &&
          (signals.decisionImpact === 'high' ||
            signals.decisionImpact === 'unclear')) ||
        (findingType === 'regulatory-flags' &&
          signals.decisionImpact !== 'none')
      );

    case 'nyc-ll144':
      // Strictly employment-related decisions.
      return (
        findingType === 'decisions-about-people' &&
        signals.decisionImpact === 'high' &&
        signals.hasEmploymentDecisions
      );

    case 'hipaa':
      // Health signals only.
      return signals.hasHealth;

    case 'ccpa-cpra':
      // California PII / sensitive data; also ADMT if decisions-about-people.
      return (
        (findingType === 'sensitive-data' && signals.hasPII) ||
        (findingType === 'decisions-about-people' &&
          signals.decisionImpact !== 'none')
      );

    default:
      // All other frameworks (generic) always fire with their finding.
      return true;
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
        const employment = /\b(hir|recruit|employ|candidate|resume|applicant)\b/i.test(
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
      const { severity, description } = describeFinding(
        mapping.findingType,
        framework,
        controlIds,
        signals,
        input.decisionMakingDetails,
      );

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

// ─── Backward-compat jurisdiction projection ───────────────────────────────

/**
 * Projects categorized flags back onto the legacy {eu, us, uk} shape so
 * the existing `RegulatoryCompliance` consumers (CLI, templates) keep
 * working until they migrate to the categorized layout.
 */
export function toLegacyJurisdictions(bundle: CategorizedCompliance): {
  eu: TypedRegulatoryFlag[];
  us: TypedRegulatoryFlag[];
  uk: TypedRegulatoryFlag[];
} {
  const eu: TypedRegulatoryFlag[] = [];
  const us: TypedRegulatoryFlag[] = [];
  const uk: TypedRegulatoryFlag[] = [];

  for (const flag of bundle.all) {
    if (flag.mandatoryIn.includes('EU')) eu.push(flag);
    if (flag.mandatoryIn.includes('UK')) uk.push(flag);
    if (flag.mandatoryIn.includes('US')) us.push(flag);

    // Voluntary frameworks sit under every jurisdiction.
    if (flag.tier === 'voluntary') {
      // ICO AI Toolkit is UK-flavoured voluntary — still useful EU-wide.
      eu.push(flag);
      us.push(flag);
      uk.push(flag);
    }
  }

  return { eu, us, uk };
}
