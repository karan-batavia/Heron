# Heron Changelog

## [Unreleased]

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
