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
  // Note: caller shows "⏳ Analyzing transcript..." already

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

  // Note: caller shows the final summary with computed risk level

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

    // Try to extract JSON if mixed with text
    if (!jsonStr.startsWith('{')) {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
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
  // Extract useful data directly from transcript
  const nonRepeated = transcript.filter(qa => !qa.answer.startsWith('[REPEATED RESPONSE]'));
  const purposeAnswers = nonRepeated
    .filter(qa => qa.category === 'purpose')
    .map(qa => qa.answer)
    .join(' ');
  const allAnswers = nonRepeated.map(qa => qa.answer).join(' ');

  // Try to build a useful summary from actual answers
  const summary = nonRepeated.length > 0
    ? `Automated analysis failed. The agent provided ${nonRepeated.length} substantive answers out of ${transcript.length} questions. Review the transcript below for details.`
    : 'Automated analysis failed and the agent did not provide substantive answers. Manual review required.';

  return {
    summary,
    agentPurpose: purposeAnswers.slice(0, 500) || 'Could not determine — see transcript',
    systems: [], // Don't show fake systems
    risks: [],
    recommendations: ['Automated analysis was unable to process the transcript. Review the interview answers manually.'],
    recommendation: 'APPROVE WITH CONDITIONS',
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
