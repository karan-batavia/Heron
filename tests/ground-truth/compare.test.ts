import { describe, it, expect } from 'vitest';
import { compareReportToGroundTruth, formatComparisonReport, type GroundTruth } from './compare.js';
import type { AuditReport } from '../../src/report/types.js';

// Ground truth for the mock invoice agent
const invoiceAgentTruth: GroundTruth = {
  workflowName: 'Invoice Processing Agent',
  description: 'Reads invoices from S3, matches with SAP POs, updates HubSpot CRM, writes daily summary to Sheets',
  systems: [
    {
      systemId: 'SAP',
      scopes: ['full-read'],
      accessType: 'read',
      dataTypes: ['purchase orders', 'vendor data', 'financial'],
      writeOperations: [],
      reversible: true,
      volume: '50-80/day',
      blastRadius: 'team-scope',
    },
    {
      systemId: 'HubSpot',
      scopes: ['admin'],
      accessType: 'write',
      dataTypes: ['invoice records', 'customer contacts', 'PII'],
      writeOperations: ['Update invoice status'],
      reversible: true,
      volume: '150-200/day',
      blastRadius: 'org-wide',
    },
  ],
  knownRisks: [
    { title: 'Excessive CRM access', severity: 'high' },
    { title: 'Stripe API access', severity: 'critical' },
  ],
  expectedRiskLevel: 'high',
  expectedExcessive: ['admin', 'full access'],
};

const matchingReport: AuditReport = {
  summary: 'Invoice processing agent with excessive access',
  agentPurpose: 'Process invoices',
  systems: [
    {
      systemId: 'SAP ERP, REST API',
      scopesRequested: ['full-read'],
      scopesNeeded: ['po-module-read'],
      scopesDelta: ['full-read'],
      dataSensitivity: 'Financial data — purchase orders, vendor details',
      blastRadius: 'team-scope',
      frequencyAndVolume: '50-80 lookups/day',
      writeOperations: [],
    },
    {
      systemId: 'HubSpot CRM, REST API',
      scopesRequested: ['admin'],
      scopesNeeded: ['invoices.write'],
      scopesDelta: ['admin', 'full access'],
      dataSensitivity: 'PII — customer contacts, invoice records',
      blastRadius: 'org-wide',
      frequencyAndVolume: '150-200 updates/day',
      writeOperations: [{
        operation: 'Update invoice status',
        target: 'Invoice records',
        reversible: true,
        approvalRequired: false,
        volumePerDay: '150-200',
      }],
    },
  ],
  dataNeeds: [],
  accessAssessment: { claimed: [], actuallyNeeded: [], excessive: [], missing: [] },
  risks: [
    { severity: 'high', title: 'Excessive CRM access', description: 'Admin access to all HubSpot objects' },
    { severity: 'critical', title: 'Full Stripe API access', description: 'Full access, only needs read' },
  ],
  recommendations: ['Restrict access'],
  overallRiskLevel: 'high',
  transcript: [],
  metadata: { date: '2026-03-30', target: 'test', interviewDuration: 1000, questionsAsked: 9 },
};

describe('ground truth comparison', () => {
  it('compares a matching report as PASS', () => {
    const result = compareReportToGroundTruth(matchingReport, invoiceAgentTruth);

    expect(result.pass).toBe(true);
    expect(result.criticalMisses).toBe(0);
    expect(result.totalMatch).toBeGreaterThan(0);
  });

  it('detects risk level mismatch', () => {
    const wrongRisk: AuditReport = { ...matchingReport, overallRiskLevel: 'low' };
    const result = compareReportToGroundTruth(wrongRisk, invoiceAgentTruth);

    const riskField = result.fields.find(f => f.field === 'overallRiskLevel');
    expect(riskField!.score).toBe('miss');
    expect(riskField!.critical).toBe(true);
    expect(result.criticalMisses).toBeGreaterThan(0);
  });

  it('detects missing system', () => {
    const missingSystem: AuditReport = {
      ...matchingReport,
      systems: [matchingReport.systems[0]], // only SAP, no HubSpot
    };
    const result = compareReportToGroundTruth(missingSystem, invoiceAgentTruth);

    const hubspotField = result.fields.find(f => f.field.includes('HubSpot') && f.actual === 'NOT FOUND');
    expect(hubspotField).toBeDefined();
  });

  it('detects missing risk', () => {
    const noStripeRisk: AuditReport = {
      ...matchingReport,
      risks: [matchingReport.risks[0]], // only CRM risk, no Stripe risk
    };
    const result = compareReportToGroundTruth(noStripeRisk, invoiceAgentTruth);

    const stripeRiskField = result.fields.find(f => f.field.includes('Stripe'));
    expect(stripeRiskField!.score).toBe('miss');
  });

  it('detects unflagged excessive permissions', () => {
    const noExcessive: AuditReport = {
      ...matchingReport,
      systems: matchingReport.systems.map(s => ({ ...s, scopesDelta: [] })),
    };
    const result = compareReportToGroundTruth(noExcessive, invoiceAgentTruth);

    const excessiveFields = result.fields.filter(f => f.field.startsWith('excessive:'));
    expect(excessiveFields.some(f => f.score === 'miss')).toBe(true);
  });

  it('formats a readable comparison report', () => {
    const result = compareReportToGroundTruth(matchingReport, invoiceAgentTruth);
    const formatted = formatComparisonReport(result);

    expect(formatted).toContain('Ground Truth Comparison');
    expect(formatted).toContain('Invoice Processing Agent');
    expect(formatted).toContain('PASS');
  });
});
