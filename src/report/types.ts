import { z } from 'zod';

// ─── Severity & Blast Radius enums ──────────────────────────────────────────

export const severityLevels = ['low', 'medium', 'high', 'critical'] as const;
export const severitySchema = z.enum(severityLevels);
export type Severity = z.infer<typeof severitySchema>;

export const blastRadiusLevels = [
  'single-record',
  'single-user',
  'team-scope',
  'org-wide',
  'cross-tenant',
] as const;
export const blastRadiusSchema = z.enum(blastRadiusLevels);
export type BlastRadius = z.infer<typeof blastRadiusSchema>;

// ─── QAPair ─────────────────────────────────────────────────────────────────

export const categoryValues = [
  'purpose', 'data', 'frequency', 'access', 'writes', 'followup',
] as const;

export const qaPairSchema = z.object({
  question: z.string(),
  answer: z.string(),
  category: z.enum(categoryValues),
});
export type QAPair = z.infer<typeof qaPairSchema>;

// ─── Per-system SystemAssessment (7 compliance fields) ──────────────────────

export const writeOperationSchema = z.object({
  operation: z.string(),
  target: z.string(),
  reversible: z.boolean(),
  approvalRequired: z.boolean(),
  volumePerDay: z.string(),
});
export type WriteOperation = z.infer<typeof writeOperationSchema>;

export const systemAssessmentSchema = z.object({
  systemId: z.string(),             // e.g. "Google Workspace, Gmail API via OAuth2"
  scopesRequested: z.array(z.string()),
  scopesNeeded: z.array(z.string()),
  scopesDelta: z.array(z.string()), // excessive scopes
  dataSensitivity: z.string(),      // e.g. "PII — email subjects + sender addresses"
  blastRadius: blastRadiusSchema,
  frequencyAndVolume: z.string(),   // e.g. "triggered on new CRM deal, ~15 times/day"
  writeOperations: z.array(writeOperationSchema),
});
export type SystemAssessment = z.infer<typeof systemAssessmentSchema>;

// ─── Legacy flat types (kept for migration compatibility) ───────────────────

export const dataNeedSchema = z.object({
  dataType: z.string(),
  system: z.string(),
  justification: z.string(),
});
export type DataNeed = z.infer<typeof dataNeedSchema>;

export const accessClaimSchema = z.object({
  resource: z.string(),
  accessLevel: z.string(),
  justification: z.string(),
});
export type AccessClaim = z.infer<typeof accessClaimSchema>;

export const writeActionSchema = z.object({
  target: z.string(),
  action: z.string(),
  scope: z.string(),
});
export type WriteAction = z.infer<typeof writeActionSchema>;

export const riskSchema = z.object({
  severity: severitySchema,
  title: z.string(),
  description: z.string(),
  mitigation: z.string().optional(),
});
export type Risk = z.infer<typeof riskSchema>;

// ─── Access Assessment ──────────────────────────────────────────────────────

export const accessAssessmentSchema = z.object({
  claimed: z.array(accessClaimSchema),
  actuallyNeeded: z.array(accessClaimSchema),
  excessive: z.array(accessClaimSchema),
  missing: z.array(accessClaimSchema),
});
export type AccessAssessment = z.infer<typeof accessAssessmentSchema>;

// ─── Interview Result ───────────────────────────────────────────────────────

export const interviewResultSchema = z.object({
  agentPurpose: z.string(),
  dataNeeds: z.array(dataNeedSchema),
  accessFrequency: z.string(),
  currentAccess: z.array(accessClaimSchema),
  writesAndModifications: z.array(writeActionSchema),
  rawTranscript: z.array(qaPairSchema),
});
export type InterviewResult = z.infer<typeof interviewResultSchema>;

// ─── Recommendation ─────────────────────────────────────────────────────────

export const recommendationValues = [
  'APPROVE',
  'APPROVE WITH CONDITIONS',
  'DENY',
] as const;
export const recommendationSchema = z.enum(recommendationValues);
export type Recommendation = z.infer<typeof recommendationSchema>;

// ─── Analysis Result (LLM output schema) ────────────────────────────────────

export const analysisResultSchema = z.object({
  summary: z.string(),
  agentPurpose: z.string(),
  agentTrigger: z.string().optional(),
  agentOwner: z.string().optional(),
  systems: z.array(systemAssessmentSchema),
  risks: z.array(riskSchema),
  recommendations: z.array(z.string()),
  recommendation: recommendationSchema.optional(),
  overallRiskLevel: severitySchema,
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;

// ─── Audit Report ───────────────────────────────────────────────────────────

export const auditReportSchema = z.object({
  summary: z.string(),
  agentPurpose: z.string(),
  agentTrigger: z.string().optional(),
  agentOwner: z.string().optional(),
  systems: z.array(systemAssessmentSchema),
  // Legacy flat fields for backward compat
  dataNeeds: z.array(dataNeedSchema),
  accessAssessment: accessAssessmentSchema,
  risks: z.array(riskSchema),
  recommendations: z.array(z.string()),
  recommendation: recommendationSchema.optional(),
  overallRiskLevel: severitySchema,
  transcript: z.array(qaPairSchema),
  metadata: z.object({
    date: z.string(),
    target: z.string(),
    interviewDuration: z.number(),
    questionsAsked: z.number(),
  }),
});
export type AuditReport = z.infer<typeof auditReportSchema>;
