/**
 * Finding → framework-control mapping table.
 *
 * This file is DATA — one entry per finding type, listing the controls each
 * finding activates across every registered framework (mandatory + voluntary).
 *
 * AAP-31 extension: entries for the restored jurisdiction-specific mandatory
 * frameworks (Colorado AI Act, HIPAA, CCPA/CPRA, UK GDPR/DPA 2018)
 * sit alongside the original AAP-30 set. The mapper's signal
 * detection decides which of these are included for any given audit.
 *
 * Mappings are INDICATIVE — they surface which framework clauses a finding
 * typically activates, not a certification that the controls are satisfied.
 */

import type { ControlMapping, FindingType, FrameworkControl } from './types.js';

// ─── Tiny builder to keep the data table readable ──────────────────────────

const c = (
  frameworkId: FrameworkControl['frameworkId'],
  controlId: string,
  note?: string,
): FrameworkControl => ({ frameworkId, controlId, note });

// ─── Mappings by finding type ──────────────────────────────────────────────

export const CONTROL_MAPPINGS: Record<FindingType, ControlMapping> = {
  'excessive-access': {
    findingType: 'excessive-access',
    category: 'privacy',
    summary:
      'Agent has been granted scopes or resource access beyond what its stated purpose requires (least-privilege violation).',
    controls: [
      c('nist-ai-rmf', 'MAP 3.2', 'Map context of use — identify access scope.'),
      c('nist-ai-rmf', 'GOVERN 6.1', 'Policies for organizational risk governance.'),
      c('nist-ai-rmf', 'MEASURE 2.7', 'Evaluate AI system trustworthiness metrics.'),
      c('nist-ai-rmf', 'MANAGE 1.2', 'Treat and respond to identified risks.'),
      c('iso-42001', 'A.6.2.6', 'Access controls for AI system resources.'),
      c('iso-42001', 'A.6.2.5', 'Restrict AI system resource interactions.'),
      c('iso-42001', 'A.9.2', 'Internal audit of AI management system.'),
      c('iso-23894', 'Clause 6.4.3', 'Risk treatment — scope and access controls.'),
      c('eu-ai-act', 'Art. 9(2)(a)', 'Risk management — identification and analysis (high-risk baseline reference).'),
      c('eu-ai-act', 'Art. 15(4-5)', 'Accuracy and robustness — resilience to misuse (baseline reference).'),
      c('soc-2', 'CC6.6', 'Logical access controls restrict permissions.'),
      // ── AAP-31 restores ──
      c('gdpr', 'Art. 25', 'Data protection by design and by default.'),
      c('uk-gdpr-dpa-2018', 'Art. 25', 'UK GDPR: data protection by design.'),
    ],
  },

  'write-risk': {
    findingType: 'write-risk',
    category: 'consumer-protection',
    summary:
      'Agent performs write operations — especially irreversible or unapproved ones — that can affect users or downstream systems.',
    controls: [
      c('nist-ai-rmf', 'MAP 3.5', 'Map risks from AI-induced actions and side-effects.'),
      c('nist-ai-rmf', 'MANAGE 2.4', 'Manage residual risk from AI system operations.'),
      c('nist-ai-rmf', 'GOVERN 1.7', 'Processes for escalating AI-driven actions.'),
      c('iso-42001', 'A.6.2.4', 'Controls for AI system operational changes.'),
      c('iso-42001', 'A.6.2.8', 'Logging and monitoring of AI system actions.'),
      c('iso-42001', 'A.5.3', 'Roles and responsibilities for AI operations.'),
      c('iso-23894', 'Clause 6.5', 'Risk treatment — irreversible action controls.'),
      c('eu-ai-act', 'Art. 14(4)(d)', 'Human oversight — override/stop function (baseline).'),
      c('eu-ai-act', 'Art. 9(6)-(7)', 'Risk management testing before deployment (baseline reference).'),
      c('soc-2', 'CC5.1', 'Control environment for change management.'),
      c('soc-2', 'CC7.2', 'Monitor system components for anomalies.'),
      c('soc-2', 'CC7.4', 'Respond to identified security incidents.'),
      c('soc-2', 'PI1.3', 'Processing integrity — complete and accurate.'),
    ],
  },

  'sensitive-data': {
    findingType: 'sensitive-data',
    category: 'privacy',
    summary:
      'Agent processes personal, health, financial, or otherwise sensitive data — activates data-protection statutes.',
    controls: [
      c('nist-ai-rmf', 'MEASURE 2.10', 'Privacy risk — measure and document impacts.'),
      c('nist-ai-rmf', 'GOVERN 1.1', 'Policies for AI risk management established.'),
      c('nist-ai-rmf', 'MAP 5.1', 'Likelihood and impact of privacy harms mapped.'),
      c('iso-42001', 'A.7.4', 'Data quality and integrity for AI systems.'),
      c('iso-42001', 'A.7.5', 'Sensitive data handling procedures.'),
      c('iso-42001', 'A.5.4', 'Privacy impact considerations in AI lifecycle.'),
      c('iso-23894', 'Clause 6.4.2', 'Risk identification — sensitive data categories.'),
      // ── Base eu-ai-act (transparency + baseline) ──
      c('eu-ai-act', 'Art. 50(1)', 'Transparency — inform affected persons.'),
      // ── eu-ai-act-high-risk (Annex III data governance) ──
      c('eu-ai-act-high-risk', 'Art. 10(1-5)', 'Data governance for high-risk AI systems — training/validation/test sets.'),
      c('eu-ai-act-high-risk', 'Art. 13', 'Transparency and provision of information (high-risk).'),
      c('eu-ai-act-high-risk', 'Art. 15', 'Accuracy, robustness, cybersecurity (high-risk).'),
      c('gdpr', 'Art. 6', 'Lawful basis for processing.'),
      c('gdpr', 'Art. 35', 'DPIA for high-risk processing.'),
      c('gdpr', 'Art. 33', '72-hour breach notification.'),
      c('soc-2', 'CC6.5', 'Logical access controls for sensitive data.'),
      c('soc-2', 'P1.1', 'Privacy notice — collection and use.'),
      c('soc-2', 'P3.1', 'Consent — personal information collection.'),
      c('soc-2', 'P4.1', 'Personal information used for stated purpose.'),
      c('soc-2', 'P4.2', 'Personal information retained per policy.'),
      c('soc-2', 'P4.3', 'Personal information disposed of appropriately.'),
      c('soc-2', 'C1.1', 'Confidential information identified and protected.'),
      c('soc-2', 'C1.2', 'Confidential information disposed of appropriately.'),
      // ── AAP-31 restores ──
      c('uk-gdpr-dpa-2018', 'Art. 6', 'Lawful basis under UK GDPR.'),
      c('uk-gdpr-dpa-2018', 'Art. 35', 'DPIA for high-risk processing.'),
      c('uk-gdpr-dpa-2018', 'Art. 33', '72-hour ICO breach notification.'),
      c('ccpa-cpra', '§1798.100', 'Consumer right to know.'),
      c('ccpa-cpra', '§1798.105', 'Consumer right to deletion.'),
      c('ccpa-cpra', '§1798.121', 'Opt-out for sensitive personal information.'),
      c('hipaa', '§164.502', 'PHI minimum-necessary standard (if covered entity).'),
      c('hipaa', '§164.308', 'Administrative safeguards (Security Rule).'),
    ],
  },

  'scope-creep': {
    findingType: 'scope-creep',
    category: 'consumer-protection',
    summary:
      'Agent\'s requested permissions exceed what is needed for the stated purpose — a precursor to unintended use.',
    controls: [
      c('nist-ai-rmf', 'MEASURE 2.4', 'Measure scientific merit and scope of AI system.'),
      c('nist-ai-rmf', 'MEASURE 3.1', 'Measure effectiveness of risk response.'),
      c('nist-ai-rmf', 'MAP 1.6', 'Map intended and potential unintended uses.'),
      c('iso-42001', 'A.6.2.6', 'Access controls — restrict scope to purpose.'),
      c('iso-42001', 'A.5.2', 'AI policy covers purpose limitation.'),
      c('iso-23894', 'Clause 6.6', 'Risk treatment — scope limitation measures.'),
      c('eu-ai-act', 'Art. 9(1)', 'Risk management system — continuous obligation (baseline).'),
      c('eu-ai-act', 'Art. 72', 'Post-market monitoring plan (baseline reference).'),
      c('eu-ai-act', 'Art. 11', 'Technical documentation (baseline reference).'),
      c('soc-2', 'CC3.1', 'Risk assessment includes scope and purpose.'),
      c('soc-2', 'CC3.2', 'Risk assessment covers system components.'),
      c('soc-2', 'CC3.4', 'Assess fraud risks related to scope.'),
      c('soc-2', 'CC4.1', 'Monitor controls for effectiveness.'),
      c('soc-2', 'CC4.2', 'Evaluate control deficiencies and remediate.'),
      c('gdpr', 'Art. 5(1)(b)', 'Purpose limitation.'),
      c('uk-gdpr-dpa-2018', 'Art. 5(1)(b)', 'Purpose limitation.'),
    ],
  },

  'regulatory-flags': {
    findingType: 'regulatory-flags',
    category: 'sector-specific',
    summary:
      'Agent operates in a regulated domain (employment, credit, insurance, health, housing, education, legal) that triggers domain-specific obligations.',
    controls: [
      c('nist-ai-rmf', 'GOVERN 1.1', 'Policies for AI risk management established.'),
      c('nist-ai-rmf', 'MAP 4.1', 'Map organizational risk tolerance to AI risks.'),
      c('nist-ai-rmf', 'GOVERN 3.2', 'Processes for regulatory compliance tracking.'),
      c('iso-42001', 'A.5.2', 'AI policy addresses sector-specific obligations.'),
      c('iso-42001', 'A.9.3', 'Management review includes regulatory findings.'),
      c('iso-23894', 'Clause 6.7', 'Risk treatment — sector-specific risk measures.'),
      // ── Base eu-ai-act (baseline reference) ──
      c('eu-ai-act', 'Art. 12', 'Record-keeping for regulated contexts (baseline).'),
      // ── eu-ai-act-high-risk (Annex III regulated domains) ──
      c('eu-ai-act-high-risk', 'Art. 6(2) + Annex III', 'High-risk classification — regulated sector reference.'),
      c('eu-ai-act-high-risk', 'Art. 43', 'Conformity assessment for high-risk systems.'),
      c('eu-ai-act-high-risk', 'Art. 49', 'EU database registration (high-risk).'),
      c('eu-ai-act-high-risk', 'Art. 9', 'Risk management system (high-risk).'),
      c('eu-ai-act-high-risk', 'Art. 11', 'Technical documentation (high-risk).'),
      c('eu-ai-act-high-risk', 'Art. 12', 'Record-keeping obligations (high-risk).'),
      // ── AAP-31 restores ──
      c('hipaa', '§164.306', 'Security Rule general requirements.'),
      c('hipaa', '§164.502(b)', 'Minimum-necessary standard.'),
      c('colorado-ai-act', 'SB 24-205 §6-1-1701', 'Consequential decision definition.'),
      c('colorado-ai-act', 'SB 24-205 §6-1-1703', 'Deployer duties (impact assessment, notice).'),
    ],
  },

  'risk-score': {
    findingType: 'risk-score',
    category: 'consumer-protection',
    summary:
      'Overall composite risk-score methodology — anchors the headline rating to published risk-management frameworks.',
    controls: [
      c('nist-ai-rmf', 'MANAGE 1.2', 'Treat and respond to identified risks.'),
      c('nist-ai-rmf', 'MEASURE 1.1', 'Identify and document AI risk measurement methods.'),
      c('iso-23894', 'Clause 6.3', 'Risk assessment — establish evaluation criteria.'),
      c('iso-23894', 'Clause 6.4.4', 'Risk evaluation against criteria.'),
      c('iso-42001', 'Clause 6.1', 'Actions to address risks and opportunities.'),
      c('eu-ai-act', 'Art. 9(2)(b)', 'Risk management — estimation and evaluation (baseline).'),
      c('eu-ai-act', 'Art. 9(8)', 'Risk management system documented and up-to-date (baseline).'),
      c('soc-2', 'CC3.3', 'Risk assessment considers fraud and error.'),
    ],
  },

  'decisions-about-people': {
    findingType: 'decisions-about-people',
    category: 'consumer-protection',
    summary:
      'Agent makes or materially influences automated decisions affecting individuals (employment, credit, access, etc.).',
    controls: [
      c('nist-ai-rmf', 'GOVERN 1.1', 'Policies for AI risk management established.'),
      c('nist-ai-rmf', 'MAP 4.1', 'Map organizational risk tolerance to AI risks.'),
      c('iso-42001', 'A.9.3', 'Management review includes decision-impact findings.'),
      c('iso-23894', 'Clause 6.4.3', 'Risk treatment — automated decision controls.'),
      // ── Base eu-ai-act (transparency + baseline oversight) ──
      c('eu-ai-act', 'Art. 50(1)', 'Transparency — inform affected persons.'),
      c('eu-ai-act', 'Art. 14(4)(d)', 'Human oversight — baseline override/stop function.'),
      // ── eu-ai-act-high-risk (full high-risk obligations) ──
      c('eu-ai-act-high-risk', 'Art. 6(2) + Annex III', 'High-risk classification reference.'),
      c('eu-ai-act-high-risk', 'Art. 9', 'Risk management system (high-risk).'),
      c('eu-ai-act-high-risk', 'Art. 10', 'Data governance (high-risk).'),
      c('eu-ai-act-high-risk', 'Art. 14', 'Human oversight — full high-risk obligations.'),
      c('eu-ai-act-high-risk', 'Art. 27', 'FRIA — deployers (public bodies).'),
      c('eu-ai-act-high-risk', 'Art. 43', 'Conformity assessment.'),
      c('eu-ai-act-high-risk', 'Art. 49', 'EU database registration.'),
      c('eu-ai-act-high-risk', 'Art. 72', 'Post-market monitoring.'),
      c('gdpr', 'Art. 22', 'Right not to be subject to solely automated decisions.'),
      c('soc-2', 'CC3.3', 'Risk assessment considers decision-impact scenarios.'),
      // ── AAP-31 restores ──
      c('uk-gdpr-dpa-2018', 'Art. 22', 'UK: right not to be subject to solely automated decisions.'),
      c('colorado-ai-act', 'SB 24-205 §6-1-1702', 'Algorithmic discrimination duty.'),
      c('colorado-ai-act', 'SB 24-205 §6-1-1703', 'Consumer disclosures + human oversight.'),
    ],
  },
};

// ─── Convenience accessors ──────────────────────────────────────────────────

export function getMapping(findingType: FindingType): ControlMapping {
  return CONTROL_MAPPINGS[findingType];
}

export function controlsFor(
  findingType: FindingType,
  frameworkId: FrameworkControl['frameworkId'],
): FrameworkControl[] {
  return CONTROL_MAPPINGS[findingType].controls.filter(
    (ctrl) => ctrl.frameworkId === frameworkId,
  );
}
