/**
 * Framework metadata registry.
 *
 * Separation of concerns (differs from the prior AAP-31 attempt which
 * co-located framework metadata with the control-mapping table in one file):
 *
 *   - frameworks.ts       — WHAT each framework is (name, tier, jurisdiction).
 *   - control-mappings.ts — WHICH controls a given finding activates.
 *
 * Using a tiny builder helper (`defineFramework`) keeps each entry concise
 * and makes the mandatory-vs-voluntary distinction obvious at a glance.
 */

import type { Framework, FrameworkId, Jurisdiction } from './types.js';

// ─── Builder helpers ────────────────────────────────────────────────────────

function mandatory(
  id: FrameworkId,
  name: string,
  mandatoryIn: Jurisdiction[],
  extras: { scopeNote?: string; summary?: string } = {},
): Framework {
  return { id, name, tier: 'mandatory', mandatoryIn, ...extras };
}

function voluntary(
  id: FrameworkId,
  name: string,
  summary?: string,
): Framework {
  return { id, name, tier: 'voluntary', mandatoryIn: [], summary };
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const FRAMEWORKS: Record<FrameworkId, Framework> = {
  // ── Mandatory, EU-wide ───────────────────────────────────────────────────
  'eu-ai-act': mandatory('eu-ai-act', 'EU AI Act', ['EU'], {
    summary:
      'Regulation (EU) 2024/1689. High-risk AI systems must meet Annex III obligations by 2 August 2026.',
  }),
  gdpr: mandatory('gdpr', 'GDPR', ['EU'], {
    summary: 'Regulation (EU) 2016/679. Lawful basis, DPIA, data-subject rights.',
  }),

  // ── Mandatory, UK ────────────────────────────────────────────────────────
  'uk-gdpr-dpa-2018': mandatory(
    'uk-gdpr-dpa-2018',
    'UK GDPR / DPA 2018',
    ['UK'],
    {
      summary:
        'UK General Data Protection Regulation + Data Protection Act 2018. Enforced by the ICO.',
    },
  ),

  // ── Mandatory, US-state / US-sector specific ────────────────────────────
  // We model US-state laws as mandatoryIn: ['US'] with a scopeNote, because
  // the Jurisdiction union does not currently enumerate individual states.
  'colorado-ai-act': mandatory(
    'colorado-ai-act',
    'Colorado AI Act (SB 24-205)',
    ['US'],
    {
      scopeNote:
        'Colorado residents / deployers operating in Colorado. Applies to consequential decisions. Effective 30 June 2026.',
      summary:
        'Requires algorithmic discrimination testing, consumer disclosures, human oversight, annual compliance reviews.',
    },
  ),
  'nyc-ll144': mandatory('nyc-ll144', 'NYC Local Law 144', ['US'], {
    scopeNote:
      'Automated employment decision tools used for candidates/employees in New York City. Penalties: $500–$1,500/day.',
    summary:
      'Annual bias audit, public disclosure of audit results, candidate notification before AI assessment.',
  }),
  hipaa: mandatory('hipaa', 'HIPAA', ['US'], {
    scopeNote:
      'Applies only to covered entities (providers, health plans, clearinghouses) and their business associates.',
    summary: 'Privacy Rule + Security Rule obligations for protected health information (PHI).',
  }),
  'ccpa-cpra': mandatory('ccpa-cpra', 'CCPA / CPRA', ['US'], {
    scopeNote:
      'California residents. ADMT (automated decision-making technology) rules effective 1 January 2027.',
    summary:
      'Consumer rights: access, deletion, correction, opt-out of sale/sharing, opt-out of profiling for significant decisions.',
  }),

  // ── Voluntary / best-practice frameworks ─────────────────────────────────
  'nist-ai-rmf': voluntary(
    'nist-ai-rmf',
    'NIST AI RMF',
    'US-origin voluntary risk-management framework. GOVERN / MAP / MEASURE / MANAGE functions.',
  ),
  'iso-23894': voluntary(
    'iso-23894',
    'ISO/IEC 23894',
    'AI risk management guidance. Clauses 6.3–6.7.',
  ),
  'iso-42001': voluntary(
    'iso-42001',
    'ISO/IEC 42001',
    'AI management system standard. Annex A controls (A.5–A.9).',
  ),
  'soc-2': voluntary(
    'soc-2',
    'SOC 2',
    'AICPA Trust Services Criteria (Security, Availability, PI, Confidentiality, Privacy).',
  ),
  'ico-ai-toolkit': voluntary(
    'ico-ai-toolkit',
    'ICO AI Risk Toolkit',
    'UK Information Commissioner\'s Office AI accountability & risk-management guidance.',
  ),
};

// ─── Convenience accessors ──────────────────────────────────────────────────

export function getFramework(id: FrameworkId): Framework {
  return FRAMEWORKS[id];
}

export function listMandatoryFrameworks(): Framework[] {
  return Object.values(FRAMEWORKS).filter((f) => f.tier === 'mandatory');
}

export function listVoluntaryFrameworks(): Framework[] {
  return Object.values(FRAMEWORKS).filter((f) => f.tier === 'voluntary');
}

/**
 * Return frameworks that are mandatory in the given jurisdiction. Used by the
 * jurisdictional appendix renderer to show, e.g., "Frameworks that apply to
 * UK-domiciled processing".
 */
export function frameworksFor(jurisdiction: Jurisdiction): Framework[] {
  return Object.values(FRAMEWORKS).filter((f) =>
    f.mandatoryIn.includes(jurisdiction),
  );
}
