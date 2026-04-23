import type { LLMClient } from '../llm/client.js';
import { DIFF_SYSTEM_PROMPT, buildDiffPrompt } from '../llm/prompts.js';
import * as logger from '../util/logger.js';

/** Headings that a well-formed diff must contain at least one of. */
const EXPECTED_HEADINGS = ['## Summary', '## Resolved', '## Added'];

/**
 * Compare two Heron audit reports (markdown) via one LLM call and return the
 * LLM's markdown diff. Retries once on sanity-check failure or thrown error.
 * Throws after double failure — no silent fallback (matches `analyzer.ts`
 * behavior rationale for a user-facing operation).
 */
export async function diffReports(
  oldReport: string,
  newReport: string,
  llmClient: LLMClient,
): Promise<string> {
  const userPrompt = buildDiffPrompt(oldReport, newReport);

  // Attempt 1
  let result = await tryDiff(llmClient, userPrompt);

  // Attempt 2 (retry) if first failed
  if (!result) {
    logger.warn('First diff attempt failed sanity check, retrying...');
    result = await tryDiff(llmClient, userPrompt);
  }

  if (!result) {
    throw new Error(
      'Diff generation failed: the LLM did not return well-formed diff markdown after two attempts. ' +
        'The reports may be empty, non-Heron, or the LLM is misbehaving.',
    );
  }

  return result;
}

async function tryDiff(llmClient: LLMClient, userPrompt: string): Promise<string | null> {
  try {
    const response = await llmClient.chat(DIFF_SYSTEM_PROMPT, userPrompt);
    const stripped = stripFences(response);
    if (!passesSanityCheck(stripped)) return null;
    return stripped;
  } catch (e) {
    logger.warn(`Diff attempt failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Strip surrounding ``` or ```markdown fences, trim whitespace. */
function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:markdown|md)?\n?/, '').replace(/\n?```$/, '');
  }
  return t.trim();
}

function passesSanityCheck(text: string): boolean {
  if (!text) return false;
  return EXPECTED_HEADINGS.some((h) => text.includes(h));
}
