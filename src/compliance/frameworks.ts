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
        'Effective 2026-06-30 (delayed from 2026-02-01 via SB 25B-004, Aug 2025). Applies to deployers doing business in Colorado. AG enforcement; no private right of action. WATCH: on 2026-03-17 a Polis-led working group released a "Proposed ADMT Framework" — working-group endorsement, NOT yet a filed bill in the General Assembly. If enacted as a repeal-and-replace it would take effect 2027-01-01. Absent enactment, SB 24-205 takes effect 2026-06-30 as scheduled.',
      summary:
        'Requires algorithmic discrimination testing, consumer disclosures, human oversight, annual compliance reviews.',
    },
  ),
  hipaa: mandatory('hipaa', 'HIPAA', ['US'], {
    scopeNote: 'Applies only to covered entities (providers, health plans, clearinghouses) and business associates per 45 CFR 160.103. Non-covered health apps fall under FTC Health Breach Notification Rule (16 CFR Part 318) — mutually exclusive per 16 CFR § 318.1. HIPAA Security Rule NPRM (Jan 6 2025) is not yet finalized (OCR targets May 2026).',
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
