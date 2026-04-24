import type { SystemAssessment } from '../report/types.js';

/**
 * Distinguish "real" business systems (Google Workspace, Stripe, Telegram,
 * PostgreSQL, etc.) from internal orchestration / local-storage components
 * (filesystem log, SQLite idempotency store, env vars, Heron's own audit
 * endpoint) that happen to appear in transcripts but have no OAuth scopes,
 * no external blast radius, and should not trigger compliance findings.
 *
 * AAP-43 P2 #8: reviewers flagged "template pollution" when rules fired on
 * orchestration components — `scope-exceeds-purpose` on "Local filesystem
 * log" is nonsense because a log file doesn't have scopes. Every rule that
 * applies to external systems should filter through this predicate first.
 */
export function isBusinessSystem(s: SystemAssessment): boolean {
  const id = s.systemId.toLowerCase();

  // Heron itself
  if (/\bheron\b/.test(id)) return false;

  // Interview / audit platform endpoints
  if (/internal\s*(orchestrat|api|platform)/.test(id)) return false;
  if (/interview\s*(platform|endpoint|api)/.test(id)) return false;
  if (/audit\s*(platform|endpoint|api)/.test(id)) return false;

  // Platform session token without real scopes = orchestration layer
  if (/platform.?session.?token/i.test(id) && s.scopesRequested.length === 0) return false;

  // AAP-43: local-only storage / logging / env-var components have no OAuth
  // scopes and no external blast radius. Excluding them prevents
  // scope-exceeds-purpose rules from firing on log files and SQLite stores.
  if (/\blocal\b.*\b(filesystem|file.?system|disk|storage|log|sqlite|database|db|cache|store)\b/i.test(id)) return false;
  if (/\b(env|\.env|environment)\s*(var|variable|file)?\b/i.test(id) && s.scopesRequested.length === 0) return false;
  if (/\bsecret[s]?.?manager\b/.test(id) && s.writeOperations.length === 0) return false;
  if (/\bidempotency\b/.test(id)) return false;

  return true;
}
