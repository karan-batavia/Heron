/**
 * Barrel — re-exports the public surface of the AAP-31 compliance module.
 */

export * from './types.js';
export {
  FRAMEWORKS,
  getFramework,
  listMandatoryFrameworks,
  listVoluntaryFrameworks,
  frameworksFor,
} from './frameworks.js';
export { CONTROL_MAPPINGS, getMapping, controlsFor } from './control-mappings.js';
export {
  classifyDecisionImpact,
  detectSignals,
  mapFindingsToRiskCategories,
  toLegacyJurisdictions,
} from './mapper.js';
export type {
  CategorizedBucket,
  CategorizedCompliance,
  ComplianceSignals,
  DecisionImpact,
  FlagSeverity,
  MapperInput,
  TypedRegulatoryFlag,
} from './mapper.js';
