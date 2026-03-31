import type { LLMClient } from '../llm/client.js';
import type { QAPair, AccessAssessment, DataNeed, Risk, SystemAssessment } from '../report/types.js';
import { analysisResultSchema, type AnalysisResult, type Recommendation } from '../report/types.js';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt } from '../llm/prompts.js';
import * as logger from '../util/logger.js';

// Extended result that includes both new per-system data and legacy flat fields
export interface FullAnalysisResult extends AnalysisResult {
  dataNeeds: DataNeed[];
  accessAssessment: AccessAssessment;
}

/**
 * Uses LLM to analyze the interview transcript and produce a structured audit.
 * Validates output with Zod schema. Retries once on parse failure.
 * Falls back to partial report on double failure.
 */
export async function analyzeTranscript(
  llmClient: LLMClient,
  transcript: QAPair[],
): Promise<FullAnalysisResult> {
  logger.heading('Analyzing interview transcript...');

  const prompt = buildAnalysisPrompt(transcript);

  // Attempt 1
  let parsed = await tryParse(llmClient, prompt);

  // Attempt 2 (retry) if first attempt failed
  if (!parsed) {
    logger.warn('First analysis attempt failed, retrying...');
    parsed = await tryParse(llmClient, prompt);
  }

  // Double failure — partial report fallback
  if (!parsed) {
    logger.warn('Double parse failure, using partial report fallback');
    return buildFallbackAnalysis(transcript);
  }

  logger.success(`Analysis complete — risk level: ${parsed.overallRiskLevel.toUpperCase()}`);

  // Derive legacy flat fields from per-system data
  return enrichWithLegacyFields(parsed);
}

async function tryParse(
  llmClient: LLMClient,
  prompt: string,
): Promise<AnalysisResult | null> {
  try {
    const response = await llmClient.chat(ANALYSIS_SYSTEM_PROMPT, prompt);

    // Strip markdown fences if present
    let jsonStr = response.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const raw = JSON.parse(jsonStr);

    // Zod validation — parse with defaults and coercion
    const result = analysisResultSchema.parse(raw);
    return result;
  } catch (e) {
    logger.warn(`Parse attempt failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Derive legacy flat AccessAssessment and DataNeed[] from per-system data.
 * This keeps backward compatibility with report templates and risk scorer.
 */
function enrichWithLegacyFields(parsed: AnalysisResult): FullAnalysisResult {
  const dataNeeds: DataNeed[] = [];
  const claimed: { resource: string; accessLevel: string; justification: string }[] = [];
  const actuallyNeeded: typeof claimed = [];
  const excessive: typeof claimed = [];
  const missing: typeof claimed = [];

  for (const sys of parsed.systems) {
    // DataNeeds from dataSensitivity
    dataNeeds.push({
      dataType: sys.dataSensitivity,
      system: sys.systemId,
      justification: sys.frequencyAndVolume,
    });

    // Claimed access
    for (const scope of sys.scopesRequested) {
      claimed.push({
        resource: sys.systemId,
        accessLevel: scope,
        justification: 'Requested by agent',
      });
    }

    // Actually needed
    for (const scope of sys.scopesNeeded) {
      actuallyNeeded.push({
        resource: sys.systemId,
        accessLevel: scope,
        justification: 'Minimum needed for stated tasks',
      });
    }

    // Excessive (delta)
    for (const scope of sys.scopesDelta) {
      excessive.push({
        resource: sys.systemId,
        accessLevel: scope,
        justification: 'Not needed for stated tasks',
      });
    }
  }

  return {
    ...parsed,
    dataNeeds,
    accessAssessment: { claimed, actuallyNeeded, excessive, missing },
  };
}

function buildFallbackAnalysis(transcript: QAPair[]): FullAnalysisResult {
  const purposeAnswers = transcript
    .filter(qa => qa.category === 'purpose')
    .map(qa => qa.answer)
    .join(' ');

  const emptySystem: SystemAssessment = {
    systemId: 'Unknown — analysis failed',
    scopesRequested: [],
    scopesNeeded: [],
    scopesDelta: [],
    dataSensitivity: 'Unknown',
    blastRadius: 'single-user',
    frequencyAndVolume: 'Unknown',
    writeOperations: [],
  };

  return {
    summary: 'Analysis could not be parsed from LLM response. Manual review recommended.',
    agentPurpose: purposeAnswers || 'Unknown — LLM analysis failed',
    systems: [emptySystem],
    risks: [{
      severity: 'medium',
      title: 'Incomplete analysis',
      description: 'Automated analysis failed after two attempts. Manual review of the transcript is required.',
      mitigation: 'Manually review the interview transcript below',
    }],
    recommendations: ['Review the interview transcript manually'],
    overallRiskLevel: 'medium',
    dataNeeds: [],
    accessAssessment: {
      claimed: [],
      actuallyNeeded: [],
      excessive: [],
      missing: [],
    },
  };
}
