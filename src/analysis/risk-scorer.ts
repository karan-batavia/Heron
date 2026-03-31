import type { Risk, SystemAssessment, Severity, BlastRadius } from '../report/types.js';

export interface RiskScore {
  overall: Severity;
  score: number; // 0-100
  breakdown: {
    excessiveAccess: number;
    writeRisk: number;
    sensitiveData: number;
    scopeCreep: number;
  };
}

// ─── Rubric weights ─────────────────────────────────────────────────────────

const WEIGHTS = {
  excessiveAccess: 0.35,
  writeRisk: 0.30,
  sensitiveData: 0.20,
  scopeCreep: 0.15,
} as const;

// ─── Blast radius severity multiplier ────────────────────────────────────────

const BLAST_RADIUS_MULTIPLIER: Record<BlastRadius, number> = {
  'single-record': 0.2,
  'single-user': 0.4,
  'team-scope': 0.6,
  'org-wide': 0.85,
  'cross-tenant': 1.0,
};

// ─── Sensitivity keywords for scoring ────────────────────────────────────────

const SENSITIVE_KEYWORDS = [
  'pii', 'personal', 'credential', 'confidential', 'financial',
  'password', 'secret', 'token', 'ssn', 'credit card', 'health',
  'medical', 'salary', 'compensation',
];

/**
 * Rubric-driven risk scorer.
 * Computes risk from structured per-system data, not keyword-grepping risk descriptions.
 *
 * Inputs: per-system assessments + LLM-identified risks.
 * Each component scores 0-100, then weighted sum → overall 0-100 → severity level.
 */
export function computeRiskScore(
  systems: SystemAssessment[],
  risks: Risk[],
): RiskScore {
  const breakdown = {
    excessiveAccess: scoreExcessiveAccess(systems),
    writeRisk: scoreWriteRisk(systems),
    sensitiveData: scoreSensitiveData(systems),
    scopeCreep: scoreScopeCreep(systems),
  };

  const rawScore =
    breakdown.excessiveAccess * WEIGHTS.excessiveAccess +
    breakdown.writeRisk * WEIGHTS.writeRisk +
    breakdown.sensitiveData * WEIGHTS.sensitiveData +
    breakdown.scopeCreep * WEIGHTS.scopeCreep;

  // Escalation: if multiple HIGH-severity risks from LLM analysis, bump up
  const highOrCriticalRisks = risks.filter(r => r.severity === 'high' || r.severity === 'critical');
  const escalation = highOrCriticalRisks.length >= 2 ? 10 : 0;

  const score = Math.min(100, Math.round(rawScore + escalation));

  return {
    overall: scoreToLevel(score),
    score,
    breakdown,
  };
}

/**
 * Excessive access: ratio of excessive scopes to total requested across all systems.
 * Weighted by blast radius of each system.
 */
function scoreExcessiveAccess(systems: SystemAssessment[]): number {
  if (systems.length === 0) return 0;

  let totalWeighted = 0;
  let totalRequested = 0;

  for (const sys of systems) {
    const requested = sys.scopesRequested.length || 1;
    const excessive = sys.scopesDelta.length;
    const multiplier = BLAST_RADIUS_MULTIPLIER[sys.blastRadius] ?? 0.5;
    totalWeighted += (excessive / requested) * multiplier * 100;
    totalRequested++;
  }

  return Math.min(100, Math.round(totalWeighted / totalRequested));
}

/**
 * Write risk: based on write operations across all systems.
 * Considers reversibility, approval requirements, blast radius, and volume.
 */
function scoreWriteRisk(systems: SystemAssessment[]): number {
  if (systems.length === 0) return 0;

  let maxWriteScore = 0;

  for (const sys of systems) {
    const multiplier = BLAST_RADIUS_MULTIPLIER[sys.blastRadius] ?? 0.5;

    for (const write of sys.writeOperations) {
      let writeScore = 40; // base: writes exist

      if (!write.reversible) writeScore += 30;         // irreversible: +30
      if (!write.approvalRequired) writeScore += 15;    // no approval: +15
      writeScore *= multiplier;                          // scale by blast radius

      maxWriteScore = Math.max(maxWriteScore, writeScore);
    }
  }

  return Math.min(100, Math.round(maxWriteScore));
}

/**
 * Sensitive data: check dataSensitivity field for known keywords.
 * Weighted by blast radius.
 */
function scoreSensitiveData(systems: SystemAssessment[]): number {
  if (systems.length === 0) return 0;

  let maxScore = 0;

  for (const sys of systems) {
    const lower = sys.dataSensitivity.toLowerCase();
    const hitCount = SENSITIVE_KEYWORDS.filter(kw => lower.includes(kw)).length;

    if (hitCount === 0) continue;

    const multiplier = BLAST_RADIUS_MULTIPLIER[sys.blastRadius] ?? 0.5;
    const sensitivityScore = Math.min(100, hitCount * 25) * multiplier;
    maxScore = Math.max(maxScore, sensitivityScore);
  }

  return Math.min(100, Math.round(maxScore));
}

/**
 * Scope creep: ratio of requested scopes to needed scopes across all systems.
 */
function scoreScopeCreep(systems: SystemAssessment[]): number {
  if (systems.length === 0) return 0;

  let totalRequested = 0;
  let totalNeeded = 0;

  for (const sys of systems) {
    totalRequested += sys.scopesRequested.length;
    totalNeeded += sys.scopesNeeded.length;
  }

  if (totalNeeded === 0) return totalRequested > 0 ? 75 : 0;

  const ratio = totalRequested / totalNeeded;
  if (ratio <= 1) return 0;
  if (ratio <= 1.5) return 25;
  if (ratio <= 2) return 50;
  if (ratio <= 3) return 75;
  return 100;
}

function scoreToLevel(score: number): Severity {
  if (score <= 20) return 'low';
  if (score <= 45) return 'medium';
  if (score <= 70) return 'high';
  return 'critical';
}
