import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../src/server/sessions.js';
import type { LLMClient } from '../../src/llm/client.js';

function createMockLLM(): LLMClient {
  return {
    chat: vi.fn().mockImplementation(async (_system: string, user: string) => {
      // If it's a follow-up generation request
      if (user.includes('follow-up question')) {
        return 'Can you tell me more about the data retention policy?';
      }
      // If it's analysis — return new per-system format
      return JSON.stringify({
        summary: 'Test agent with moderate risk',
        agentPurpose: 'Processes invoices',
        agentTrigger: 'New invoice in S3',
        systems: [{
          systemId: 'SAP ERP, REST API via service account',
          scopesRequested: ['read-write'],
          scopesNeeded: ['read'],
          scopesDelta: ['write'],
          dataSensitivity: 'Financial data — invoice amounts',
          blastRadius: 'team-scope',
          frequencyAndVolume: '50 times/day',
          writeOperations: [{
            operation: 'Update status',
            target: 'Invoice records',
            reversible: true,
            approvalRequired: false,
            volumePerDay: '50',
          }],
        }],
        risks: [{ severity: 'high', title: 'Excessive SAP access', description: 'Write access not needed', mitigation: 'Remove write scope' }],
        recommendations: ['Remove write access to SAP'],
        recommendation: 'APPROVE WITH CONDITIONS',
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

    let done = false;
    let iterations = 0;
    const maxIterations = 20;

    while (!done && iterations < maxIterations) {
      const result = await sessions.processAnswer(session.id, 'I process invoices in SAP with read-write access.');
      iterations++;
      if (result.done) {
        done = true;
        expect(result.report).toContain('Agent Access Audit Report');
        expect(result.reportJson.overallRiskLevel).toBeTruthy();
        expect(result.reportJson.systems.length).toBeGreaterThan(0);
      } else {
        expect(result.question).toBeTruthy();
      }
    }

    expect(done).toBe(true);
    expect(session.status).toBe('complete');
  });

  it('records event log entries throughout session', async () => {
    const sessions = new SessionManager(createMockLLM(), { maxFollowUps: 0 });
    const { session } = sessions.createSession();

    // Initial question event should be logged
    expect(session.eventLog.length).toBeGreaterThan(0);
    expect(session.eventLog[0].type).toBe('question');

    // Process one answer
    await sessions.processAnswer(session.id, 'I process invoices.');

    // Should have answer + next question events
    const types = session.eventLog.map(e => e.type);
    expect(types).toContain('answer');
  });

  it('has questionQueue property (no monkey-patching)', () => {
    const sessions = new SessionManager(createMockLLM());
    const { session } = sessions.createSession();

    // Verify clean follow-up queue exists
    expect(session.questionQueue).toBeDefined();
    expect(Array.isArray(session.questionQueue)).toBe(true);
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

  it('throws when processing answer for non-interviewing session', async () => {
    const sessions = new SessionManager(createMockLLM(), { maxFollowUps: 0 });
    const { session } = sessions.createSession();

    // Complete the session
    let done = false;
    while (!done) {
      const result = await sessions.processAnswer(session.id, 'Test answer');
      done = result.done;
    }

    // Try to process another answer
    await expect(sessions.processAnswer(session.id, 'extra')).rejects.toThrow('not interviewing');
  });
});
