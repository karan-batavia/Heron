import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startMockAgent } from './mock-agent.js';
import { createConnector } from '../../src/connectors/index.js';
import { runInterview } from '../../src/interview/interviewer.js';
import { renderMarkdownReport } from '../../src/report/templates.js';
import { analyzeTranscript } from '../../src/analysis/analyzer.js';
import type { LLMClient } from '../../src/llm/client.js';
import type { AuditReport } from '../../src/report/types.js';

// Mock LLM client that returns structured analysis
const mockLLMClient: LLMClient = {
  async chat(_system: string, user: string): Promise<string> {
    // If it's a follow-up generation request, return a follow-up question
    if (user.includes('generate a follow-up question')) {
      return 'Can you clarify which specific database tables you read from?';
    }

    // If it's an analysis request, return structured JSON
    if (user.includes('Analyze this interview transcript')) {
      return JSON.stringify({
        summary: 'The agent processes invoices with excessive access to multiple production systems.',
        agentPurpose: 'Automated invoice processing and CRM status updates',
        dataNeeds: [
          { dataType: 'Invoices', system: 'SAP ERP', justification: 'Read POs for matching' },
          { dataType: 'Payment status', system: 'Stripe', justification: 'Verify payments' },
        ],
        accessAssessment: {
          claimed: [
            { resource: 'SAP ERP', accessLevel: 'full read', justification: 'Service account' },
            { resource: 'HubSpot CRM', accessLevel: 'admin', justification: 'Admin API key' },
            { resource: 'Stripe', accessLevel: 'full access', justification: 'Live secret key' },
          ],
          actuallyNeeded: [
            { resource: 'SAP ERP', accessLevel: 'read PO module', justification: 'Only needs POs' },
            { resource: 'HubSpot CRM', accessLevel: 'read-write invoices', justification: 'Update invoice status' },
            { resource: 'Stripe', accessLevel: 'read-only', justification: 'Only reads payments' },
          ],
          excessive: [
            { resource: 'SAP ERP', accessLevel: 'full read', justification: 'Only needs PO module' },
            { resource: 'HubSpot CRM', accessLevel: 'admin', justification: 'Only needs invoice object' },
            { resource: 'Stripe', accessLevel: 'full access', justification: 'Only needs read access' },
          ],
          missing: [],
        },
        risks: [
          { severity: 'critical', title: 'Full Stripe API access', description: 'Agent could create charges or modify subscriptions' },
          { severity: 'high', title: 'Excessive CRM write access', description: 'Agent can modify any CRM record' },
        ],
        recommendations: [
          'Use Stripe read-only API key',
          'Restrict HubSpot to Invoice object only',
          'Limit SAP to PO module',
        ],
        overallRiskLevel: 'high',
      });
    }

    return 'Mock response';
  },
};

describe('Full flow integration', () => {
  let mockAgent: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    mockAgent = await startMockAgent(4666);
  });

  afterAll(async () => {
    await mockAgent.close();
  });

  it('runs complete interview → analysis → report pipeline', async () => {
    // 1. Connect to mock agent
    const connector = createConnector({ type: 'http', url: mockAgent.url });

    // 2. Run interview
    const session = await runInterview(connector, mockLLMClient, {
      maxFollowUps: 1,
      verbose: false,
    });

    expect(session.transcript.length).toBeGreaterThanOrEqual(9); // 9 core questions
    expect(session.questionsAsked).toBeGreaterThanOrEqual(9);

    // Check that we got answers for all categories
    const categories = new Set(session.transcript.map(qa => qa.category));
    expect(categories).toContain('purpose');
    expect(categories).toContain('data');
    expect(categories).toContain('access');
    expect(categories).toContain('writes');

    // 3. Analyze
    const analysis = await analyzeTranscript(mockLLMClient, session.transcript);

    expect(analysis.agentPurpose).toBeTruthy();
    expect(analysis.risks.length).toBeGreaterThan(0);
    expect(analysis.accessAssessment.excessive.length).toBeGreaterThan(0);

    // 4. Generate report
    const report: AuditReport = {
      ...analysis,
      transcript: session.transcript,
      metadata: {
        date: '2026-03-25',
        target: mockAgent.url,
        interviewDuration: session.completedAt.getTime() - session.startedAt.getTime(),
        questionsAsked: session.questionsAsked,
      },
    };

    const markdown = renderMarkdownReport(report);

    expect(markdown).toContain('# Agent Audit Report');
    expect(markdown).toContain('HIGH');
    expect(markdown).toContain('Stripe');
    expect(markdown).toContain('Excessive');
    expect(markdown).toContain('Recommendations');

    await connector.close();
  }, 30000);
});
