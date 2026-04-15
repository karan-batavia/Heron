/**
 * Typed primitives for framework-anchored risk scoring (AAP-31).
 *
 * Structure (differs from prior attempt):
 *   types.ts            — pure types + enums + MAPPING_VERSION
 *   frameworks.ts       — framework metadata registry
 *   control-mappings.ts — finding → controls table
 *   mapper.ts           — signal detection + finding → flag projection
 *
 * Source: AAP-30 / AAP-31 research. Mappings are INDICATIVE — they
 * surface which framework clauses a finding typically activates, not a
 * certification that the controls are satisfied.
 */

// ─── Risk categories ────────────────────────────────────────────────────────

export const RISK_CATEGORIES = [
  'privacy',
  'ip',
  'consumer-protection',
  'sector-specific',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

// ─── Framework tier & IDs ───────────────────────────────────────────────────

export const FRAMEWORK_TIERS = ['mandatory', 'voluntary'] as const;
export type FrameworkTier = (typeof FRAMEWORK_TIERS)[number];

/**
 * Every framework carried by the AAP-31 mapping. This list is the union of
 * the original AAP-30 set (EU AI Act, GDPR, NIST AI RMF, ISO 23894/42001,
 * SOC 2) AND the jurisdiction-specific frameworks restored under AAP-31
 * (Colorado AI Act, HIPAA, CCPA/CPRA, UK GDPR/DPA 2018). NYC LL144 and
 * ICO AI Toolkit are excluded from v1 scope (deferred — see AAP-40).
 */
export const FRAMEWORK_IDS = [
  // ── Mandatory, EU-wide ───────────────────────────────────────────────────
  'eu-ai-act',
  'eu-ai-act-high-risk',
  'gdpr',
  // ── Mandatory, UK ────────────────────────────────────────────────────────
  'uk-gdpr-dpa-2018',
  // ── Mandatory, US-state or US-sector specific ────────────────────────────
  'colorado-ai-act', // SB 24-205 — Colorado consequential decisions
  'hipaa',           // US health sector (covered entities / business associates)
  'ccpa-cpra',       // California Consumer Privacy Act / CPRA
  // ── Voluntary / best-practice ────────────────────────────────────────────
  'nist-ai-rmf',
  'iso-23894',
  'iso-42001',
  'soc-2',
] as const;
export type FrameworkId = (typeof FRAMEWORK_IDS)[number];

export const JURISDICTIONS = ['EU', 'UK', 'US', 'global'] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];

export interface Framework {
  id: FrameworkId;
  name: string;
  tier: FrameworkTier;
  /**
   * Jurisdictions where the framework is legally mandatory.
   * Voluntary frameworks use an empty array.
   *
   * Modelled as a Jurisdiction[] (not a boolean) because mandatoriness is
   * jurisdiction-scoped — GDPR is mandatory in the EU & UK but not the US.
   *
   * US-state-specific laws (Colorado AI Act, CCPA/CPRA) use `['US']`
   * with an explanatory `scopeNote` since we don't model individual US states
   * as first-class jurisdictions.
   */
  mandatoryIn: Jurisdiction[];
  /** Optional clarification on the jurisdictional scope (e.g. "Colorado residents only"). */
  scopeNote?: string;
  /** Optional short blurb rendered in the jurisdictional appendix. */
  summary?: string;
  /** Primary source URL: statutory text, regulatory page, or official standard. Required for audit trail. */
  primarySource: string;
}

// ─── Finding types ──────────────────────────────────────────────────────────

export const FINDING_TYPES = [
  'excessive-access',
  'write-risk',
  'sensitive-data',
  'scope-creep',
  'regulatory-flags',
  'risk-score',
  'decisions-about-people',
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

// ─── Control references ─────────────────────────────────────────────────────

export interface FrameworkControl {
  frameworkId: FrameworkId;
  /** The specific control, clause, or article ID (e.g. "Art. 9(2)(a)", "CC6.6"). */
  controlId: string;
  /** Optional human-readable description of the control. */
  note?: string;
}

/**
 * Per-finding-type mapping bundle.
 *
 * Every finding type lives in exactly one category (privacy / IP /
 * consumer-protection / sector-specific) and carries the set of controls
 * it activates across all registered frameworks.
 */
export interface ControlMapping {
  findingType: FindingType;
  category: RiskCategory;
  /** Short human-readable summary of what triggers this finding type. */
  summary: string;
  controls: FrameworkControl[];
}

// ─── Mapping metadata ───────────────────────────────────────────────────────

/**
 * Version tag for the control-mapping dataset. Bump when the mapping table
 * is materially updated so downstream consumers can detect staleness.
 *
 * Source: AAP-30 research, extended under AAP-31 to restore the
 * jurisdiction-specific mandatory frameworks (Colorado AI Act,
 * HIPAA, CCPA/CPRA, UK GDPR/DPA 2018).
 */
export const MAPPING_VERSION = 'aap-31.2026-04-15' as const;
