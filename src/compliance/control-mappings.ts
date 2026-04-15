/**
 * Finding → framework-control mapping table.
 *
 * This file is DATA — one entry per finding type, listing the controls each
 * finding activates across every registered framework (mandatory + voluntary).
 *
 * AAP-31 extension: entries for the restored jurisdiction-specific mandatory
 * frameworks (Colorado AI Act, NYC LL144, HIPAA, CCPA/CPRA, UK GDPR/DPA 2018,
 * ICO AI Toolkit) sit alongside the original AAP-30 set. The mapper's signal
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
      c('nist-ai-rmf', 'MAP 3.2'),
      c('nist-ai-rmf', 'GOVERN 6.1'),
      c('nist-ai-rmf', 'MEASURE 2.7'),
      c('nist-ai-rmf', 'MANAGE 1.2'),
      c('iso-42001', 'A.6.2.6'),
      c('iso-42001', 'A.6.2.5'),
      c('iso-42001', 'A.9.2'),
      c('iso-23894', 'Clause 6.4.3'),
      c('eu-ai-act', 'Art. 9(2)(a)'),
      c('eu-ai-act', 'Art. 15(4-5)'),
      c('soc-2', 'CC6.6'),
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
      c('nist-ai-rmf', 'MAP 3.5'),
      c('nist-ai-rmf', 'MANAGE 2.4'),
      c('nist-ai-rmf', 'GOVERN 1.7'),
      c('iso-42001', 'A.6.2.4'),
      c('iso-42001', 'A.6.2.8'),
      c('iso-42001', 'A.5.3'),
      c('iso-23894', 'Clause 6.5'),
      c('eu-ai-act', 'Art. 14(4)(d)'),
      c('eu-ai-act', 'Art. 9(6)-(7)'),
      c('soc-2', 'CC5.1'),
      c('soc-2', 'CC7.2'),
      c('soc-2', 'CC7.4'),
      c('soc-2', 'PI1.3'),
    ],
  },

  'sensitive-data': {
    findingType: 'sensitive-data',
    category: 'privacy',
    summary:
      'Agent processes personal, health, financial, or otherwise sensitive data — activates data-protection statutes.',
    controls: [
      c('nist-ai-rmf', 'MEASURE 2.10'),
      c('nist-ai-rmf', 'GOVERN 1.1'),
      c('nist-ai-rmf', 'MAP 5.1'),
      c('iso-42001', 'A.7.4'),
      c('iso-42001', 'A.7.5'),
      c('iso-42001', 'A.5.4'),
      c('iso-23894', 'Clause 6.4.2'),
      c('eu-ai-act', 'Art. 10(1-5)'),
      c('eu-ai-act', 'Art. 13'),
      c('eu-ai-act', 'Art. 50(1)'),
      c('gdpr', 'Art. 6', 'Lawful basis for processing.'),
      c('gdpr', 'Art. 35', 'DPIA for high-risk processing.'),
      c('gdpr', 'Art. 33', '72-hour breach notification.'),
      c('soc-2', 'CC6.5'),
      c('soc-2', 'P1.1'),
      c('soc-2', 'P3.1'),
      c('soc-2', 'P4.1'),
      c('soc-2', 'P4.2'),
      c('soc-2', 'P4.3'),
      c('soc-2', 'C1.1'),
      c('soc-2', 'C1.2'),
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
      c('nist-ai-rmf', 'MEASURE 2.4'),
      c('nist-ai-rmf', 'MEASURE 3.1'),
      c('nist-ai-rmf', 'MAP 1.6'),
      c('iso-42001', 'A.6.2.6'),
      c('iso-42001', 'A.5.2'),
      c('iso-23894', 'Clause 6.6'),
      c('eu-ai-act', 'Art. 9(1)'),
      c('eu-ai-act', 'Art. 72'),
      c('eu-ai-act', 'Art. 11'),
      c('soc-2', 'CC3.1'),
      c('soc-2', 'CC3.2'),
      c('soc-2', 'CC3.4'),
      c('soc-2', 'CC4.1'),
      c('soc-2', 'CC4.2'),
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
      c('nist-ai-rmf', 'GOVERN 1.1'),
      c('nist-ai-rmf', 'MAP 4.1'),
      c('nist-ai-rmf', 'GOVERN 3.2'),
      c('iso-42001', 'A.5.2'),
      c('iso-42001', 'A.9.3'),
      c('iso-23894', 'Clause 6.7'),
      c('eu-ai-act', 'Art. 6(2) + Annex III'),
      c('eu-ai-act', 'Art. 43'),
      c('eu-ai-act', 'Art. 12'),
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
      c('nist-ai-rmf', 'MANAGE 1.2'),
      c('nist-ai-rmf', 'MEASURE 1.1'),
      c('iso-23894', 'Clause 6.3'),
      c('iso-23894', 'Clause 6.4.4'),
      c('iso-42001', 'Clause 6.1'),
      c('eu-ai-act', 'Art. 9(2)(b)'),
      c('eu-ai-act', 'Art. 9(8)'),
      c('soc-2', 'CC3.3'),
    ],
  },

  'decisions-about-people': {
    findingType: 'decisions-about-people',
    category: 'consumer-protection',
    summary:
      'Agent makes or materially influences automated decisions affecting individuals (employment, credit, access, etc.).',
    controls: [
      c('nist-ai-rmf', 'GOVERN 1.1'),
      c('nist-ai-rmf', 'MAP 4.1'),
      c('iso-42001', 'A.9.3'),
      c('iso-23894', 'Clause 6.4.3'),
      c('eu-ai-act', 'Art. 6(2) + Annex III'),
      c('eu-ai-act', 'Art. 14(4)(d)'),
      c('gdpr', 'Art. 22', 'Right not to be subject to solely automated decisions.'),
      c('soc-2', 'CC3.3'),
      // ── AAP-31 restores ──
      c('uk-gdpr-dpa-2018', 'Art. 22', 'UK: right not to be subject to solely automated decisions.'),
      c('colorado-ai-act', 'SB 24-205 §6-1-1702', 'Algorithmic discrimination duty.'),
      c('colorado-ai-act', 'SB 24-205 §6-1-1703', 'Consumer disclosures + human oversight.'),
      c('ccpa-cpra', '§1798.185(a)(16)', 'ADMT regulations (effective 1 Jan 2027).'),
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
