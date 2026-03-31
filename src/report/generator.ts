import type { AuditReport } from './types.js';
import type { InterviewSession } from '../interview/interviewer.js';
import { analyzeTranscript } from '../analysis/analyzer.js';
import { computeRiskScore } from '../analysis/risk-scorer.js';
import { renderMarkdownReport } from './templates.js';
import type { LLMClient } from '../llm/client.js';
import * as logger from '../util/logger.js';

export interface GenerateReportOptions {
  target: string;
  format: 'markdown' | 'json';
}

/**
 * Generates a complete audit report from an interview session.
 * Runs LLM analysis, computes risk score, and formats the output.
 */
export async function generateReport(
  session: InterviewSession,
  llmClient: LLMClient,
  options: GenerateReportOptions,
): Promise<string> {
  // 1. Analyze transcript with LLM
  const analysis = await analyzeTranscript(llmClient, session.transcript);

  // 2. Compute risk score from structured per-system data
  const riskScore = computeRiskScore(analysis.systems, analysis.risks);

  // 3. Build report object
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
    metadata: {
      date: session.startedAt.toISOString().split('T')[0],
      target: options.target,
      interviewDuration: session.completedAt.getTime() - session.startedAt.getTime(),
      questionsAsked: session.questionsAsked,
    },
  };

  // 4. Format output
  if (options.format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  return renderMarkdownReport(report);
}
