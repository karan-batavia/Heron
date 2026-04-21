import type { AuditReport, DataQuality, QAPair } from './types.js';
import type { InterviewSession } from '../interview/interviewer.js';
import { analyzeTranscript } from '../analysis/analyzer.js';
import { computeRiskScore } from '../analysis/risk-scorer.js';
import { renderMarkdownReport } from './templates.js';
import type { LLMClient } from '../llm/client.js';
import * as logger from '../util/logger.js';
import {
  mapFindingsToRiskCategories,
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

  // 3. Compute structured compliance (AAP-31: CategorizedCompliance)
  const compliance = mapFindingsToRiskCategories({
    systems: analysis.systems,
    transcript: session.transcript,
    makesDecisionsAboutPeople: analysis.makesDecisionsAboutPeople,
    decisionMakingDetails: analysis.decisionMakingDetails,
  });

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
    compliance,
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

// AAP-31: computeRegulatoryFlags (legacy jurisdictional projection) removed.
// All compliance logic lives in src/compliance/{frameworks,control-mappings,mapper}.ts.
// generator.ts calls mapFindingsToRiskCategories() directly and stores the
// result in AuditReport.compliance (StructuredCompliance / CategorizedCompliance).

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
