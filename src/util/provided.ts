/**
 * Helpers for detecting and scrubbing the "NOT PROVIDED" sentinel used by
 * the analyzer when the LLM could not extract a field from the transcript.
 *
 * Two sources produce this sentinel:
 *   1. Zod `.default('NOT PROVIDED')` on fields the LLM returned as null/undefined
 *   2. The LLM itself returning the literal string "NOT PROVIDED"
 *
 * Either way it must not leak into customer-facing output as plain text —
 * reviewers (AAP-43) flagged this as the renderer "losing data between the
 * transcript and the summary table". Fields that are genuinely unknown should
 * be surfaced as an explicit "Unknown — ask deployer" marker instead.
 */

export const UNKNOWN_PLACEHOLDER = 'Unknown — ask deployer';

/**
 * Returns true if the value contains actual content (not missing, empty, or
 * one of the known "no data" sentinels).
 */
export function isProvided(value: string | null | undefined): value is string {
  if (value === null || value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed === '') return false;
  const upper = trimmed.toUpperCase();
  if (upper === 'NOT PROVIDED') return false;
  if (upper === 'NOT_PROVIDED') return false;
  if (upper === 'N/A') return false;
  if (upper === 'UNKNOWN') return false;
  return true;
}

/**
 * Returns the input if it is provided, otherwise returns undefined.
 * Useful for post-processing LLM JSON output where "NOT PROVIDED" may appear
 * as a literal string even when the transcript contained the answer.
 */
export function scrubUnprovided(value: string | null | undefined): string | undefined {
  return isProvided(value) ? value.trim() : undefined;
}

/**
 * Render a string field for customer-facing output. If not provided, renders
 * the UNKNOWN_PLACEHOLDER so the reader sees an explicit prompt rather than
 * a silent gap or the leaked sentinel.
 */
export function renderFieldOrUnknown(value: string | null | undefined): string {
  return isProvided(value) ? value : UNKNOWN_PLACEHOLDER;
}
