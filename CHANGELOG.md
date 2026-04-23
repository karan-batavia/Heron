# Heron Changelog

## [Unreleased]

### Changed (AAP-42, 2026-04-23) — OSS v1 framework scope cut

- **BREAKING**: Framework registry reduced from 10 to 3 entries. Surviving: EU AI Act, GDPR, ISO/IEC 42001. Removed: UK GDPR / DPA 2018, Colorado AI Act (SB 24-205), HIPAA, CCPA / CPRA, NIST AI RMF, ISO/IEC 23894, SOC 2. Removed frameworks stay in git history — consumers that need them must pin to the prior commit or resurrect via `git revert`.
- **BREAKING**: EU AI Act split consolidated. The prior two-entry model (`eu-ai-act` + `eu-ai-act-high-risk`) collapses into a single `eu-ai-act` framework. High-risk (Annex III) obligations are now surfaced as a classification scope label on the single entry — `euAiActClassification: { classification, annexIIICategories[] }` on `CategorizedCompliance` — and individual controls opt in or out of the high-risk tier via `annexIII: true` on `FrameworkControl`.
- **BREAKING**: `FrameworkId` union narrowed. Code referencing removed IDs will fail to compile.
- `MAPPING_VERSION` bumped to `aap-42.2026-04-23`.
- Report output: applicability summary shows EU AI Act as a single row with classification scope (e.g. "EU AI Act — High-Risk (Annex III §4 employment)") instead of two separate rows.

### Removed (AAP-42)

- Framework entries: `uk-gdpr-dpa-2018`, `colorado-ai-act`, `hipaa`, `ccpa-cpra`, `nist-ai-rmf`, `iso-23894`, `soc-2`, `eu-ai-act-high-risk`.
- Signal detectors: `hasCoveredEntitySignal` (HIPAA), `hasConsequentialDecisionSignal` (Colorado), `hasSignificantDecisionSignal` (CCPA-reserved).
- Regex patterns: `CONSEQUENTIAL_DECISION_PATTERN`, `SIGNIFICANT_DECISION_PATTERN`, `COVERED_ENTITY_PATTERN`.
- Per-framework gating cases in `frameworkApplies()` for all cut frameworks; replaced with per-control `annexIII` gating for EU AI Act.
- Jurisdictional disclaimers for removed frameworks in `disclaimerFor()`.
- Rationale: see Linear AAP-42. OSS v1 focuses on agent-native EU AI Act + GDPR + (next PR) AIUC-1 verification. Jurisdiction-specific statutes and general AI management frameworks move to the paid/cloud tier.

### Added (AAP-42)

- `EUAIActClassification` type and `classifyEUAIAct()` helper.
- `annexIII?: boolean` field on `FrameworkControl` for per-control Annex III gating.
- `euAiActClassification` field on `CategorizedCompliance` output — always present; drives the single-entry EU AI Act display.
- `euAiActClassification?` field on `TypedRegulatoryFlag` — set for EU AI Act flags, undefined otherwise.

### Changed
- **BREAKING**: `AuditReport.regulatory` (jurisdictional `{eu, us, uk}`) replaced with `AuditReport.compliance` (`StructuredCompliance`). Consumers iterating jurisdiction buckets must migrate to `compliance.all` / `compliance.mandatory` / `compliance.voluntary`.
- Regulatory Compliance section in generated reports restructured: Methodology + Mandatory Law × 4 categories + Voluntary Frameworks × 4 categories. No jurisdictional appendix.
- Statute scope-gates locked per 7 rounds of research verification (AAP-40):
  - Colorado AI Act: fires only on decisionImpact=high + consequential-decision signal (8 enumerated domains).
  - HIPAA: fires only with covered-entity signal (non-covered health apps see HBNR disclaimer).
  - CCPA/CPRA: single base flag (no ADMT sub-flag until 2027-01-01 effective date).
  - EU AI Act: two levels — base (always fires) + high-risk (5 Annex III categories gated by signal match).
- Every framework entry now carries primarySource URL.

### Removed
- NYC Local Law 144 and ICO AI Risk Toolkit from the framework registry (deferred from v1 scope).
- `toLegacyJurisdictions()` helper and the jurisdictional `{eu, us, uk}` projection.
- Legacy `renderRegulatoryCompliance` jurisdictional render.

### Added
- Six new signal detectors: `hasCoveredEntitySignal`, `hasConsequentialDecisionSignal`, `hasBiometricSignal`, `isEducationAssessmentContext`, `isLawEnforcementContext`.
- `hasSignificantDecisionSignal` (CCPA § 7001(e) 5-domain list — computed but reserved for v2 ADMT sub-flag, not gating in v1)
- `eu-ai-act-high-risk` framework entry with Annex III classification obligations (Art. 9, 10, 13, 14, 27, 43, 49, 72).
- Jurisdictional disclaimers baked into statute flag descriptions (fire-with-disclaimer model).
