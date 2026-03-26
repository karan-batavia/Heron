import type { LLMClient } from '../llm/client.js';
import type { QAPair, AuditReport, AccessAssessment, DataNeed, Risk } from '../report/types.js';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt } from '../llm/prompts.js';
import * as logger from '../util/logger.js';

interface AnalysisResult {
  summary: string;
  agentPurpose: string;
  dataNeeds: DataNeed[];
  accessAssessment: AccessAssessment;
  risks: Risk[];
  recommendations: string[];
  overallRiskLevel: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Uses LLM to analyze the interview transcript and produce a structured audit.
 */
export async function analyzeTranscript(
  llmClient: LLMClient,
  transcript: QAPair[],
): Promise<AnalysisResult> {
  logger.heading('Analyzing interview transcript...');

  const prompt = buildAnalysisPrompt(transcript);
  const response = await llmClient.chat(ANALYSIS_SYSTEM_PROMPT, prompt);

  // Parse JSON response — handle potential markdown fences
  let jsonStr = response.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(jsonStr) as AnalysisResult;
  } catch (e) {
    logger.warn('Failed to parse LLM analysis as JSON, using fallback');
    parsed = buildFallbackAnalysis(transcript);
  }

  // Validate and normalize
  parsed.overallRiskLevel = normalizeRiskLevel(parsed.overallRiskLevel);
  parsed.risks = (parsed.risks ?? []).map(r => ({
    ...r,
    severity: normalizeRiskLevel(r.severity),
  }));

  logger.success(`Analysis complete — risk level: ${parsed.overallRiskLevel.toUpperCase()}`);

  return parsed;
}

function normalizeRiskLevel(level: string): 'low' | 'medium' | 'high' | 'critical' {
  const normalized = (level ?? 'medium').toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(normalized)) {
    return normalized as 'low' | 'medium' | 'high' | 'critical';
  }
  return 'medium';
}

function buildFallbackAnalysis(transcript: QAPair[]): AnalysisResult {
  const purposeAnswers = transcript
    .filter(qa => qa.category === 'purpose')
    .map(qa => qa.answer)
    .join(' ');

  return {
    summary: 'Analysis could not be parsed from LLM response. Manual review recommended.',
    agentPurpose: purposeAnswers || 'Unknown — LLM analysis failed',
    dataNeeds: [],
    accessAssessment: {
      claimed: [],
      actuallyNeeded: [],
      excessive: [],
      missing: [],
    },
    risks: [{
      severity: 'medium',
      title: 'Incomplete analysis',
      description: 'Automated analysis failed. Manual review of the transcript is required.',
    }],
    recommendations: ['Review the interview transcript manually'],
    overallRiskLevel: 'medium',
  };
}
