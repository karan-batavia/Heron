import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../src/server/sessions.js';
import type { LLMClient } from '../../src/llm/client.js';

function createMockLLM(): LLMClient {
  return {
    chat: vi.fn().mockImplementation(async (system: string, user: string) => {
      // If it's a follow-up generation request
      if (user.includes('follow-up question')) {
        return 'Can you tell me more about the data retention policy?';
      }
      // If it's analysis
      return JSON.stringify({
        summary: 'Test agent with moderate risk',
        agentPurpose: 'Processes invoices',
        dataNeeds: [{ dataType: 'invoices', system: 'SAP', justification: 'Core function' }],
        accessAssessment: {
          claimed: [{ resource: 'SAP', accessLevel: 'read-write', justification: 'Invoice processing' }],
          actuallyNeeded: [{ resource: 'SAP', accessLevel: 'read', justification: 'Only reads needed' }],
          excessive: [{ resource: 'SAP', accessLevel: 'write', justification: 'Write not needed' }],
          missing: [],
        },
        risks: [{ severity: 'high', title: 'Excessive SAP access', description: 'Write access not needed' }],
        recommendations: ['Remove write access to SAP'],
        overallRiskLevel: 'high',
      });
    }),
  };
}

describe('SessionManager', () => {
  it('creates a session and returns first question', () => {
    const sessions = new SessionManager(createMockLLM());
    const { session, firstQuestion } = sessions.createSession();

    expect(session.id).toMatch(/^sess_/);
    expect(session.status).toBe('interviewing');
    expect(firstQuestion).toBeTruthy();
    expect(typeof firstQuestion).toBe('string');
  });

  it('processes answers and advances through interview', async () => {
    const sessions = new SessionManager(createMockLLM(), { maxFollowUps: 0 });
    const { session } = sessions.createSession();

    // Answer all questions until done
    let done = false;
    let iterations = 0;
    const maxIterations = 20;

    while (!done && iterations < maxIterations) {
      const result = await sessions.processAnswer(session.id, 'I process invoices in SAP with read-write access.');
      iterations++;
      if (result.done) {
        done = true;
        expect(result.report).toContain('Agent Audit Report');
        expect(result.reportJson.overallRiskLevel).toBeTruthy();
      } else {
        expect(result.question).toBeTruthy();
      }
    }

    expect(done).toBe(true);
    expect(session.status).toBe('complete');
  });

  it('lists sessions', () => {
    const sessions = new SessionManager(createMockLLM());
    sessions.createSession();
    sessions.createSession();

    const list = sessions.listSessions();
    expect(list.length).toBe(2);
  });

  it('retrieves session by id', () => {
    const sessions = new SessionManager(createMockLLM());
    const { session } = sessions.createSession();

    const found = sessions.getSession(session.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(session.id);
  });

  it('throws on unknown session id', async () => {
    const sessions = new SessionManager(createMockLLM());
    await expect(sessions.processAnswer('unknown', 'test')).rejects.toThrow('Session not found');
  });
});
