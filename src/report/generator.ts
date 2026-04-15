import type { AuditReport, DataQuality, QAPair, RegulatoryCompliance } from './types.js';
import type { InterviewSession } from '../interview/interviewer.js';
import { analyzeTranscript } from '../analysis/analyzer.js';
import { computeRiskScore } from '../analysis/risk-scorer.js';
import { renderMarkdownReport } from './templates.js';
import type { LLMClient } from '../llm/client.js';
import * as logger from '../util/logger.js';
import {
  mapFindingsToRiskCategories,
  toLegacyJurisdictions,
} from '../compliance/mapper.js';

export interface GenerateReportOptions {
  target: string;
  format: 'markdown' | 'json';
}

/**
 * Generates a complete audit report from an interview session.
 * Runs LLM analysis, computes risk score, and formats the output.
 */
export interface ReportResult {
  report: string;
  reportJson: AuditReport;
}

export async function generateReport(
  session: InterviewSession,
  llmClient: LLMClient,
  options: GenerateReportOptions,
): Promise<ReportResult> {
  // 1. Analyze transcript with LLM
  const analysis = await analyzeTranscript(llmClient, session.transcript);

  // 2. Compute risk score from structured per-system data
  const riskScore = computeRiskScore(analysis.systems, analysis.risks);

  // 3. Compute regulatory flags
  const regulatoryCompliance = computeRegulatoryFlags(analysis, session.transcript);

  // 4. Build report object
  const report: AuditReport = {
    summary: analysis.summary,
    agentPurpose: analysis.agentPurpose,
    agentTrigger: analysis.agentTrigger,
    agentOwner: analysis.agentOwner,
    systems: analysis.systems,
    dataNeeds: analysis.dataNeeds,
    accessAssessment: analysis.accessAssessment,
    risks: analysis.risks,
    recommendations: analysis.recommendations,
    recommendation: analysis.recommendation,
    overallRiskLevel: riskScore.overall,
    transcript: session.transcript,
    dataQuality: computeDataQualityFromTranscript(session.transcript),
    makesDecisionsAboutPeople: analysis.makesDecisionsAboutPeople,
    decisionMakingDetails: analysis.decisionMakingDetails,
    regulatoryCompliance,
    metadata: {
      date: session.startedAt.toISOString().split('T')[0],
      target: options.target,
      interviewDuration: session.completedAt.getTime() - session.startedAt.getTime(),
      questionsAsked: session.questionsAsked,
    },
  };

  // 5. Format output
  const formatted = options.format === 'json'
    ? JSON.stringify(report, null, 2)
    : renderMarkdownReport(report);

  return { report: formatted, reportJson: report };
}

// ─── Decision Impact Classification ────────────────────────────────────────

type DecisionImpact = 'high' | 'medium' | 'unclear' | 'none';

/**
 * Classify the impact level of decisions about people.
 * High: hiring, credit, insurance, medical, legal — has legal/significant effects
 * Medium: scoring leads, ranking, recommending, moderating — influences but no legal effect
 * Unclear: agent says it decides about people, but we can't determine impact level
 */
function classifyDecisionImpact(
  decidesAboutPeople: boolean,
  details?: string,
): DecisionImpact {
  if (!decidesAboutPeople) return 'none';
  if (!details || details === 'NOT PROVIDED' || details.trim().length < 10) return 'unclear';

  const text = details.toLowerCase();

  // High-impact: legal/significant effects on individuals
  const highImpact = /\b(hir(e|ing)|recruit|screen.?candidate|reject|deny|approv(e|al|ing).*(loan|credit|mortgage|claim|application)|terminat|fir(e|ing)|credit.?scor|insurance.?claim|diagnos|prescri|legal.?decision|sentenc|parole|bail|evict|expel|suspend|disqualif|ban\b|block.?user|delist)\b/i;
  if (highImpact.test(text)) return 'high';

  // Medium-impact: influences outcomes but no legal/binding effect
  const mediumImpact = /\b(scor(e|ing)|rank|filter|recommend|prioriti[sz]|moderate|flag|qualif(y|ied)|match|sort|categori[sz]|segment|lead|prospect|outreach|target|personali[sz])\b/i;
  if (mediumImpact.test(text)) return 'medium';

  return 'unclear';
}

/**
 * Derive regulatory flags from analysis results and transcript signals.
 *
 * AAP-31: delegates to the typed compliance mapper (`src/compliance/mapper.ts`),
 * which produces categorized mandatory/voluntary buckets. The legacy
 * `{eu, us, uk}` projection is computed for backward compatibility.
 */
export function computeRegulatoryFlags(
  analysis: { systems: AuditReport['systems']; makesDecisionsAboutPeople?: boolean; decisionMakingDetails?: string },
  transcript: QAPair[],
): RegulatoryCompliance {
  const bundle = mapFindingsToRiskCategories({
    systems: analysis.systems,
    transcript,
    makesDecisionsAboutPeople: analysis.makesDecisionsAboutPeople,
    decisionMakingDetails: analysis.decisionMakingDetails,
  });

  const { eu, us, uk } = toLegacyJurisdictions(bundle);

  return {
    eu,
    us,
    uk,
    mandatory: bundle.mandatory,
    voluntary: bundle.voluntary,
    mappingVersion: bundle.mappingVersion,
    frameworksActivated: bundle.frameworksActivated,
  };
}

// AAP-31: legacy inline flag builder (~220 lines) removed; all logic now
// lives in src/compliance/{frameworks,control-mappings,mapper}.ts.

/** Compute data quality metrics from the interview transcript (CLI path) */
function computeDataQualityFromTranscript(transcript: QAPair[]): DataQuality {
  const totalQuestions = transcript.length;
  const repeatedAnswers = transcript.filter(qa => qa.answer.startsWith('[REPEATED RESPONSE]')).length;
  const greetingCount = transcript.filter(qa =>
    /^hi\b|^hello\b|ready to answer|ready for questions|^i am ready/i.test(qa.answer.trim())
  ).length;
  const uniqueAnswers = totalQuestions - repeatedAnswers - greetingCount;

  const nonRepeatedText = transcript
    .filter(qa => !qa.answer.startsWith('[REPEATED RESPONSE]'))
    .map(qa => qa.answer.toLowerCase())
    .join(' ');

  const fieldChecks: Record<string, RegExp> = {
    systemId: /\b(api|oauth|sdk|via|using|rest|webhook|token)\b/i,
    scopesRequested: /\b(scope|permission|role|\.readonly|\.send|\.modify|\.admin|\.edit|\.file|spreadsheets|drive)\b/i,
    dataSensitivity: /\b(pii|sensitive|confidential|financial|personal|classified|non.?sensitive|credentials?)\b/i,
    blastRadius: /\b(single.?record|single.?user|team|org.?wide|cross.?tenant|one record|one user|affected)\b/i,
    frequencyAndVolume: /\b(\d+\s*(times?|per|\/|calls?|runs?|operations?)\s*(day|hour|minute|week|session|run)|batch|\d+\/day)\b/i,
    writeOperations: /\b(write|create|update|append|send|modify|delete|insert|post)\b/i,
    reversibility: /\b(revers|rollback|undo|irrevers|cannot be undone|can be restored|can be undone)\b/i,
  };

  const fieldsProvided: string[] = [];
  const fieldsMissing: string[] = [];
  for (const [field, pattern] of Object.entries(fieldChecks)) {
    if (pattern.test(nonRepeatedText)) {
      fieldsProvided.push(field);
    } else {
      fieldsMissing.push(field);
    }
  }

  const fieldScore = (fieldsProvided.length / Object.keys(fieldChecks).length) * 100;
  const repeatPenalty = (repeatedAnswers / Math.max(totalQuestions, 1)) * 50;
  const score = Math.max(0, Math.min(100, Math.round(fieldScore - repeatPenalty)));

  return { score, uniqueAnswers, totalQuestions, fieldsProvided, fieldsMissing, repeatedAnswers };
}
