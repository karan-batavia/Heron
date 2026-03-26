import type { Risk, AccessAssessment } from '../report/types.js';

export interface RiskScore {
  overall: 'low' | 'medium' | 'high' | 'critical';
  score: number; // 0-100
  breakdown: {
    excessiveAccess: number;
    writeRisk: number;
    sensitiveData: number;
    scopeCreep: number;
  };
}

/**
 * Computes a numeric risk score from the analysis results.
 * Used to provide a quick at-a-glance risk indicator.
 */
export function computeRiskScore(
  accessAssessment: AccessAssessment,
  risks: Risk[],
): RiskScore {
  const breakdown = {
    excessiveAccess: scoreExcessiveAccess(accessAssessment),
    writeRisk: scoreWriteRisk(risks),
    sensitiveData: scoreSensitiveData(risks),
    scopeCreep: scoreScopeCreep(accessAssessment),
  };

  const score = Math.round(
    breakdown.excessiveAccess * 0.35 +
    breakdown.writeRisk * 0.30 +
    breakdown.sensitiveData * 0.20 +
    breakdown.scopeCreep * 0.15
  );

  return {
    overall: scoreToLevel(score),
    score,
    breakdown,
  };
}

function scoreExcessiveAccess(assessment: AccessAssessment): number {
  const total = assessment.claimed.length || 1;
  const excessive = assessment.excessive.length;
  return Math.min(100, Math.round((excessive / total) * 100));
}

function scoreWriteRisk(risks: Risk[]): number {
  const writeRisks = risks.filter(r =>
    r.title.toLowerCase().includes('write') ||
    r.description.toLowerCase().includes('write') ||
    r.description.toLowerCase().includes('modify') ||
    r.description.toLowerCase().includes('delete')
  );

  if (writeRisks.length === 0) return 0;

  const maxSeverity = writeRisks.reduce((max, r) => {
    const val = severityToNum(r.severity);
    return val > max ? val : max;
  }, 0);

  return maxSeverity * 25; // 0, 25, 50, 75, 100
}

function scoreSensitiveData(risks: Risk[]): number {
  const sensitiveRisks = risks.filter(r =>
    r.description.toLowerCase().includes('sensitive') ||
    r.description.toLowerCase().includes('personal') ||
    r.description.toLowerCase().includes('credential') ||
    r.description.toLowerCase().includes('confidential') ||
    r.description.toLowerCase().includes('pii')
  );

  if (sensitiveRisks.length === 0) return 0;
  return Math.min(100, sensitiveRisks.length * 30);
}

function scoreScopeCreep(assessment: AccessAssessment): number {
  const needed = assessment.actuallyNeeded.length || 1;
  const claimed = assessment.claimed.length;
  const ratio = claimed / needed;

  if (ratio <= 1) return 0;
  if (ratio <= 1.5) return 25;
  if (ratio <= 2) return 50;
  if (ratio <= 3) return 75;
  return 100;
}

function severityToNum(severity: string): number {
  switch (severity) {
    case 'low': return 1;
    case 'medium': return 2;
    case 'high': return 3;
    case 'critical': return 4;
    default: return 2;
  }
}

function scoreToLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score <= 20) return 'low';
  if (score <= 45) return 'medium';
  if (score <= 70) return 'high';
  return 'critical';
}
