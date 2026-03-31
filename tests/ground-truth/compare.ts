/**
 * Ground truth comparison tooling.
 *
 * Compares a Heron AuditReport against a manually documented GroundTruth sheet.
 * Each compliance field is scored as: match / partial / miss.
 * Target: 0 misses on critical fields, <2 partial matches.
 */

import type { AuditReport, SystemAssessment } from '../../src/report/types.js';

export interface GroundTruthSystem {
  systemId: string;
  scopes: string[];           // exact scopes/permissions
  accessType: 'read' | 'write' | 'admin';
  dataTypes: string[];
  writeOperations: string[];
  reversible: boolean;
  volume: string;
  blastRadius: string;
}

export interface GroundTruth {
  workflowName: string;
  description: string;
  systems: GroundTruthSystem[];
  knownRisks: { title: string; severity: string }[];
  expectedRiskLevel: string;
  expectedExcessive: string[];
  expectedMissing: string[];
}

export type FieldScore = 'match' | 'partial' | 'miss';

export interface FieldComparison {
  field: string;
  expected: string;
  actual: string;
  score: FieldScore;
  critical: boolean;
}

export interface ComparisonResult {
  workflowName: string;
  fields: FieldComparison[];
  totalMatch: number;
  totalPartial: number;
  totalMiss: number;
  criticalMisses: number;
  pass: boolean; // 0 critical misses and <2 partial
}

/**
 * Compare a Heron report against ground truth.
 */
export function compareReportToGroundTruth(
  report: AuditReport,
  truth: GroundTruth,
): ComparisonResult {
  const fields: FieldComparison[] = [];

  // 1. Compare overall risk level (critical field)
  fields.push({
    field: 'overallRiskLevel',
    expected: truth.expectedRiskLevel,
    actual: report.overallRiskLevel,
    score: report.overallRiskLevel === truth.expectedRiskLevel ? 'match' : 'miss',
    critical: true,
  });

  // 2. Compare systems
  for (const gtSys of truth.systems) {
    const reportSys = findMatchingSystem(report.systems, gtSys.systemId);

    if (!reportSys) {
      fields.push({
        field: `system:${gtSys.systemId}`,
        expected: gtSys.systemId,
        actual: 'NOT FOUND',
        score: 'miss',
        critical: true,
      });
      continue;
    }

    // Scopes (critical)
    fields.push(compareStringArrays(
      `${gtSys.systemId}:scopes`,
      gtSys.scopes,
      reportSys.scopesRequested,
      true,
    ));

    // Data types
    fields.push({
      field: `${gtSys.systemId}:dataSensitivity`,
      expected: gtSys.dataTypes.join(', '),
      actual: reportSys.dataSensitivity,
      score: gtSys.dataTypes.some(dt =>
        reportSys.dataSensitivity.toLowerCase().includes(dt.toLowerCase())
      ) ? 'match' : 'partial',
      critical: false,
    });

    // Write operations (critical)
    fields.push(compareStringArrays(
      `${gtSys.systemId}:writeOperations`,
      gtSys.writeOperations,
      reportSys.writeOperations.map(w => w.operation),
      true,
    ));

    // Blast radius
    fields.push({
      field: `${gtSys.systemId}:blastRadius`,
      expected: gtSys.blastRadius,
      actual: reportSys.blastRadius,
      score: reportSys.blastRadius === gtSys.blastRadius ? 'match' : 'partial',
      critical: false,
    });
  }

  // 3. Compare known risks (critical)
  for (const risk of truth.knownRisks) {
    const found = report.risks.some(r =>
      r.title.toLowerCase().includes(risk.title.toLowerCase()) ||
      r.description.toLowerCase().includes(risk.title.toLowerCase())
    );
    fields.push({
      field: `risk:${risk.title}`,
      expected: `${risk.severity}: ${risk.title}`,
      actual: found ? 'Found' : 'NOT FOUND',
      score: found ? 'match' : 'miss',
      critical: true,
    });
  }

  // 4. Compare excessive permissions
  for (const scope of truth.expectedExcessive) {
    const found = report.systems.some(s =>
      s.scopesDelta.some(d => d.toLowerCase().includes(scope.toLowerCase()))
    );
    fields.push({
      field: `excessive:${scope}`,
      expected: scope,
      actual: found ? 'Flagged' : 'NOT FLAGGED',
      score: found ? 'match' : 'miss',
      critical: true,
    });
  }

  const totalMatch = fields.filter(f => f.score === 'match').length;
  const totalPartial = fields.filter(f => f.score === 'partial').length;
  const totalMiss = fields.filter(f => f.score === 'miss').length;
  const criticalMisses = fields.filter(f => f.score === 'miss' && f.critical).length;

  return {
    workflowName: truth.workflowName,
    fields,
    totalMatch,
    totalPartial,
    totalMiss,
    criticalMisses,
    pass: criticalMisses === 0 && totalPartial < 2,
  };
}

function findMatchingSystem(
  systems: SystemAssessment[],
  systemId: string,
): SystemAssessment | undefined {
  const lower = systemId.toLowerCase();
  return systems.find(s => s.systemId.toLowerCase().includes(lower));
}

function compareStringArrays(
  field: string,
  expected: string[],
  actual: string[],
  critical: boolean,
): FieldComparison {
  if (expected.length === 0 && actual.length === 0) {
    return { field, expected: '[]', actual: '[]', score: 'match', critical };
  }

  const expectedLower = expected.map(s => s.toLowerCase());
  const actualLower = actual.map(s => s.toLowerCase());

  const matchCount = expectedLower.filter(e =>
    actualLower.some(a => a.includes(e) || e.includes(a))
  ).length;

  const ratio = matchCount / Math.max(expected.length, 1);

  let score: FieldScore;
  if (ratio >= 0.8) score = 'match';
  else if (ratio >= 0.4) score = 'partial';
  else score = 'miss';

  return {
    field,
    expected: expected.join(', '),
    actual: actual.join(', '),
    score,
    critical,
  };
}

/**
 * Format comparison result as a human-readable table.
 */
export function formatComparisonReport(result: ComparisonResult): string {
  const lines = [
    `# Ground Truth Comparison: ${result.workflowName}`,
    '',
    `| Field | Expected | Actual | Score | Critical |`,
    `|-------|----------|--------|-------|----------|`,
  ];

  for (const f of result.fields) {
    const icon = f.score === 'match' ? 'OK' : f.score === 'partial' ? '~' : 'MISS';
    lines.push(`| ${f.field} | ${f.expected} | ${f.actual} | ${icon} | ${f.critical ? 'Yes' : 'No'} |`);
  }

  lines.push('');
  lines.push(`**Match**: ${result.totalMatch} | **Partial**: ${result.totalPartial} | **Miss**: ${result.totalMiss} | **Critical Misses**: ${result.criticalMisses}`);
  lines.push(`**Result**: ${result.pass ? 'PASS' : 'FAIL'}`);

  return lines.join('\n');
}
