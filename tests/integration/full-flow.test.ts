import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMockAgent } from './mock-agent.js';
import { createConnector } from '../../src/connectors/index.js';
import { runInterview } from '../../src/interview/interviewer.js';
import { renderMarkdownReport } from '../../src/report/templates.js';
import { analyzeTranscript } from '../../src/analysis/analyzer.js';
import { computeRiskScore } from '../../src/analysis/risk-scorer.js';
import type { LLMClient } from '../../src/llm/client.js';
import type { AuditReport } from '../../src/report/types.js';

// Mock LLM client that returns structured analysis in the new per-system format
const mockLLMClient: LLMClient = {
  async chat(_system: string, user: string): Promise<string> {
    // If it's a follow-up generation request, return a follow-up question
    if (user.includes('follow-up question')) {
      return 'Can you clarify which specific API scopes you use for database access?';
    }

    // If it's an analysis request, return structured JSON in new format
    if (user.includes('Analyze this interview transcript')) {
      return JSON.stringify({
        summary: 'The agent processes invoices with excessive access to multiple production systems.',
        agentPurpose: 'Automated invoice processing and CRM status updates',
        agentTrigger: 'New invoice in S3 bucket',
        agentOwner: 'Finance Operations',
        systems: [
          {
            systemId: 'SAP ERP, REST API via service account',
            scopesRequested: ['full-read-all-modules'],
            scopesNeeded: ['po-module-read', 'vendor-master-read'],
            scopesDelta: ['full-read-all-modules'],
            dataSensitivity: 'Financial data — invoice amounts, vendor bank account numbers',
            blastRadius: 'team-scope',
            frequencyAndVolume: '50-80 lookups/day, batch of 1',
            writeOperations: [],
          },
          {
            systemId: 'HubSpot CRM, REST API via admin API key',
            scopesRequested: ['crm.objects.all.admin'],
            scopesNeeded: ['crm.objects.invoices.write', 'crm.objects.contacts.read'],
            scopesDelta: ['crm.objects.all.admin'],
            dataSensitivity: 'PII — customer names, email addresses, phone numbers',
            blastRadius: 'org-wide',
            frequencyAndVolume: '150-200 updates/day',
            writeOperations: [
              {
                operation: 'Update invoice status',
                target: 'Invoice records',
                reversible: true,
                approvalRequired: false,
                volumePerDay: '150-200',
              },
            ],
          },
          {
            systemId: 'Stripe, REST API via live secret key',
            scopesRequested: ['full-api-access'],
            scopesNeeded: ['charges.read', 'transactions.read'],
            scopesDelta: ['full-api-access'],
            dataSensitivity: 'Financial — payment amounts, transaction history',
            blastRadius: 'org-wide',
            frequencyAndVolume: '~100 lookups/day',
            writeOperations: [],
          },
        ],
        risks: [
          { severity: 'critical', title: 'Full Stripe API access', description: 'Agent could create charges or modify subscriptions', mitigation: 'Use read-only API key' },
          { severity: 'high', title: 'Excessive CRM write access', description: 'Agent can modify any CRM record, not just invoices', mitigation: 'Restrict to Invoice object only' },
          { severity: 'high', title: 'Broad ERP read access', description: 'Full read to all SAP modules, only needs PO + Vendor Master', mitigation: 'Restrict to PO and Vendor Master modules' },
        ],
        recommendations: [
          'Use Stripe read-only API key',
          'Restrict HubSpot to Invoice and Contact objects only',
          'Limit SAP to PO and Vendor Master modules',
          'Remove Slack webhook (not used in normal operation)',
        ],
        recommendation: 'APPROVE WITH CONDITIONS',
        overallRiskLevel: 'high',
      });
    }

    return 'Mock response';
  },
};

describe('Full flow integration', () => {
  let mockAgent: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    mockAgent = await startMockAgent(4667);
  });

  afterAll(async () => {
    await mockAgent.close();
  });

  it('runs complete interview → analysis → report pipeline with per-system data', async () => {
    // 1. Connect to mock agent
    const connector = createConnector({ type: 'http', url: mockAgent.url });

    // 2. Run interview
    const session = await runInterview(connector, mockLLMClient, {
      maxFollowUps: 1,
      verbose: false,
    });

    expect(session.transcript.length).toBeGreaterThanOrEqual(9);
    expect(session.questionsAsked).toBeGreaterThanOrEqual(9);

    // Check all categories covered
    const categories = new Set(session.transcript.map(qa => qa.category));
    expect(categories).toContain('purpose');
    expect(categories).toContain('data');
    expect(categories).toContain('access');
    expect(categories).toContain('writes');

    // 3. Analyze — should return new per-system structure
    const analysis = await analyzeTranscript(mockLLMClient, session.transcript);

    expect(analysis.agentPurpose).toBeTruthy();
    expect(analysis.systems.length).toBe(3); // SAP, HubSpot, Stripe
    expect(analysis.systems[0].systemId).toContain('SAP');
    expect(analysis.systems[1].blastRadius).toBe('org-wide');
    expect(analysis.risks.length).toBe(3);

    // Verify legacy fields are derived
    expect(analysis.accessAssessment.excessive.length).toBeGreaterThan(0);
    expect(analysis.dataNeeds.length).toBe(3);

    // 4. Compute risk from structured data
    const riskScore = computeRiskScore(analysis.systems, analysis.risks);
    expect(riskScore.overall).not.toBe('low'); // Should be high or critical

    // 5. Build and render report
    const report: AuditReport = {
      ...analysis,
      transcript: session.transcript,
      metadata: {
        date: '2026-03-30',
        target: mockAgent.url,
        interviewDuration: session.completedAt.getTime() - session.startedAt.getTime(),
        questionsAsked: session.questionsAsked,
      },
    };

    const markdown = renderMarkdownReport(report);

    // Verify new report sections
    expect(markdown).toContain('# Agent Access Audit Report');
    expect(markdown).toContain('## Systems & Permissions');
    expect(markdown).toContain('SAP ERP');
    expect(markdown).toContain('HubSpot CRM');
    expect(markdown).toContain('Stripe');
    expect(markdown).toContain('## Write Operations');
    expect(markdown).toContain('Update invoice status');
    expect(markdown).toContain('## Risk Assessment');
    expect(markdown).toContain('CRITICAL');
    expect(markdown).toContain('## Permissions Delta');
    expect(markdown).toContain('Excessive');
    expect(markdown).toContain('## Recommendation');
    expect(markdown).toContain('APPROVE WITH CONDITIONS');
    expect(markdown).toContain('self-report'); // footer disclaimer

    await connector.close();
  }, 30000);
});
