import { generateId } from '../util/id.js';
import { createProtocol, type InterviewProtocol } from '../interview/protocol.js';
import { analyzeTranscript } from '../analysis/analyzer.js';
import { computeRiskScore } from '../analysis/risk-scorer.js';
import { renderMarkdownReport } from '../report/templates.js';
import type { LLMClient } from '../llm/client.js';
import type { AuditReport, QAPair } from '../report/types.js';
import type { InterviewQuestion } from '../interview/questions.js';
import * as logger from '../util/logger.js';

export type SessionStatus = 'interviewing' | 'analyzing' | 'complete' | 'error';

export interface Session {
  id: string;
  status: SessionStatus;
  protocol: InterviewProtocol;
  /** The question Heron is currently waiting for the agent to answer */
  pendingQuestion: InterviewQuestion | null;
  /** Category of the last answered question (for follow-up generation) */
  lastCategory: QAPair['category'] | null;
  /** Whether we need to try generating a follow-up before the next core question */
  needsFollowUp: boolean;
  report: string | null;
  reportJson: AuditReport | null;
  createdAt: Date;
  updatedAt: Date;
  questionsAsked: number;
  error?: string;
}

/**
 * Manages interrogation sessions for server mode.
 * Each agent that connects gets its own session with its own interview state.
 */
export class SessionManager {
  private sessions = new Map<string, Session>();
  private llmClient: LLMClient;
  private maxFollowUps: number;
  private reportDir: string | undefined;

  constructor(llmClient: LLMClient, options: { maxFollowUps?: number; reportDir?: string } = {}) {
    this.llmClient = llmClient;
    this.maxFollowUps = options.maxFollowUps ?? 3;
    this.reportDir = options.reportDir;
  }

  /** Create a new session and return the first question */
  createSession(): { session: Session; firstQuestion: string } {
    const id = generateId('sess');
    const protocol = createProtocol(this.llmClient, this.maxFollowUps);
    const firstQ = protocol.nextQuestion()!;

    const session: Session = {
      id,
      status: 'interviewing',
      protocol,
      pendingQuestion: firstQ,
      lastCategory: null,
      needsFollowUp: false,
      report: null,
      reportJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      questionsAsked: 0,
    };

    this.sessions.set(id, session);
    logger.log(`New session: ${id}`);
    return { session, firstQuestion: firstQ.text };
  }

  /** Process an agent's answer and return the next question or final result */
  async processAnswer(
    sessionId: string,
    answer: string,
  ): Promise<{ done: false; question: string } | { done: true; report: string; reportJson: AuditReport }> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status !== 'interviewing') {
      throw new Error(`Session ${sessionId} is in status "${session.status}", not interviewing`);
    }

    // Record the answer to the pending question
    if (session.pendingQuestion) {
      session.protocol.recordAnswer(session.pendingQuestion, answer);
      session.lastCategory = session.pendingQuestion.category;
      session.questionsAsked++;
      session.needsFollowUp = true;
      logger.step(
        session.questionsAsked,
        0,
        `[${session.pendingQuestion.category}] Got answer (${answer.length} chars)`,
      );
    }

    session.updatedAt = new Date();

    // Try to get the next question (follow-up or core)
    const nextQ = await this.getNextQuestion(session);

    if (nextQ) {
      session.pendingQuestion = nextQ;
      return { done: false, question: nextQ.text };
    }

    // No more questions — generate report
    return this.finishSession(session);
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  private async getNextQuestion(session: Session): Promise<InterviewQuestion | null> {
    // Try a follow-up first if category just changed
    if (session.needsFollowUp && session.lastCategory) {
      session.needsFollowUp = false;
      const nextCore = session.protocol.nextQuestion();

      // If the next core question is a different category, generate follow-up for the previous
      if (nextCore && nextCore.category !== session.lastCategory) {
        const followUp = await session.protocol.generateFollowUp(session.lastCategory);
        if (followUp) {
          // Put the core question back — we'll return the follow-up first
          // Since we can't "unget" from protocol, we'll handle this via pendingQuestion
          // Actually, we need to return follow-up now and remember to ask nextCore next
          session.pendingQuestion = followUp;
          // Store nextCore for later by creating a wrapper
          const origNext = session.protocol.nextQuestion.bind(session.protocol);
          let returnedCore = false;
          session.protocol.nextQuestion = () => {
            if (!returnedCore) {
              returnedCore = true;
              return nextCore;
            }
            return origNext();
          };
          return followUp;
        }
      }

      return nextCore;
    }

    return session.protocol.nextQuestion();
  }

  private async finishSession(
    session: Session,
  ): Promise<{ done: true; report: string; reportJson: AuditReport }> {
    session.status = 'analyzing';
    logger.heading(`Analyzing session ${session.id}...`);

    try {
      const transcript = session.protocol.getTranscript();
      const analysis = await analyzeTranscript(this.llmClient, transcript);
      const riskScore = computeRiskScore(analysis.accessAssessment, analysis.risks);

      const reportJson: AuditReport = {
        summary: analysis.summary,
        agentPurpose: analysis.agentPurpose,
        dataNeeds: analysis.dataNeeds,
        accessAssessment: analysis.accessAssessment,
        risks: analysis.risks,
        recommendations: analysis.recommendations,
        overallRiskLevel: riskScore.overall,
        transcript,
        metadata: {
          date: session.createdAt.toISOString().split('T')[0],
          target: `session:${session.id}`,
          interviewDuration: Date.now() - session.createdAt.getTime(),
          questionsAsked: session.questionsAsked,
        },
      };

      const report = renderMarkdownReport(reportJson);

      // Save to disk if reportDir is set
      if (this.reportDir) {
        const { writeFileSync, mkdirSync } = await import('node:fs');
        mkdirSync(this.reportDir, { recursive: true });
        const filePath = `${this.reportDir}/${session.id}.md`;
        writeFileSync(filePath, report, 'utf-8');
        logger.success(`Report saved: ${filePath}`);
      }

      session.report = report;
      session.reportJson = reportJson;
      session.status = 'complete';
      session.updatedAt = new Date();

      logger.success(`Session ${session.id} complete — risk: ${riskScore.overall.toUpperCase()}`);

      return { done: true, report, reportJson };
    } catch (err) {
      session.status = 'error';
      session.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}
