import { generateId } from '../util/id.js';
import { createProtocol, type InterviewProtocol } from '../interview/protocol.js';
import { analyzeTranscript } from '../analysis/analyzer.js';
import { computeRiskScore } from '../analysis/risk-scorer.js';
import { renderMarkdownReport } from '../report/templates.js';
import type { LLMClient } from '../llm/client.js';
import type { AuditReport, DataQuality, QAPair } from '../report/types.js';
import type { InterviewQuestion } from '../interview/questions.js';
import { COMPLIANCE_FIELD_CHECKLIST } from '../llm/prompts.js';
import * as logger from '../util/logger.js';

export type SessionStatus = 'interviewing' | 'analyzing' | 'complete' | 'error';

export interface SessionEvent {
  timestamp: string;
  type: 'question' | 'answer' | 'followup' | 'greeting_skipped' | 'analysis_start' | 'analysis_complete' | 'error';
  data: Record<string, unknown>;
}

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
  /** Queue of questions to ask before resuming core questions */
  questionQueue: InterviewQuestion[];
  report: string | null;
  reportJson: AuditReport | null;
  createdAt: Date;
  updatedAt: Date;
  questionsAsked: number;
  /** Structured event log for ground truth comparison */
  eventLog: SessionEvent[];
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
    this.maxFollowUps = options.maxFollowUps ?? 6;
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
      questionQueue: [],
      report: null,
      reportJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      questionsAsked: 0,
      eventLog: [],
    };

    this.logEvent(session, 'question', { questionId: firstQ.id, text: firstQ.text, category: firstQ.category });
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
      const recorded = session.protocol.recordAnswer(session.pendingQuestion, answer);

      if (!recorded) {
        // Greeting was skipped — re-ask the same question
        this.logEvent(session, 'greeting_skipped', { answer: answer.slice(0, 100) });
        logger.log(`[${session.id}] Greeting skipped, re-asking Q1`);
        // pendingQuestion stays the same, just return it again
        return { done: false, question: session.pendingQuestion.text };
      }

      this.logEvent(session, 'answer', {
        questionId: session.pendingQuestion.id,
        category: session.pendingQuestion.category,
        answerLength: answer.length,
      });
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
      this.logEvent(session, 'question', { questionId: nextQ.id, text: nextQ.text, category: nextQ.category });
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
    // Drain the question queue first (clean replacement for monkey-patching)
    if (session.questionQueue.length > 0) {
      return session.questionQueue.shift()!;
    }

    // Try a follow-up if category just changed
    if (session.needsFollowUp && session.lastCategory) {
      session.needsFollowUp = false;
      const nextCore = session.protocol.nextQuestion();

      // If the next core question is a different category, generate follow-up for the previous
      if (nextCore && nextCore.category !== session.lastCategory) {
        const followUp = await session.protocol.generateFollowUp(session.lastCategory);
        if (followUp) {
          // Enqueue the core question, return the follow-up first
          session.questionQueue.push(nextCore);
          this.logEvent(session, 'followup', { questionId: followUp.id, text: followUp.text, category: followUp.category });
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
    this.logEvent(session, 'analysis_start', {});
    logger.heading(`Analyzing session ${session.id}...`);

    try {
      const transcript = session.protocol.getTranscript();
      const dataQuality = computeDataQuality(transcript);
      const analysis = await analyzeTranscript(this.llmClient, transcript);
      const riskScore = computeRiskScore(analysis.systems, analysis.risks);

      const reportJson: AuditReport = {
        summary: analysis.summary,
        agentPurpose: analysis.agentPurpose,
        agentTrigger: analysis.agentTrigger,
        agentOwner: analysis.agentOwner,
        systems: analysis.systems,
        dataNeeds: analysis.dataNeeds,
        accessAssessment: analysis.accessAssessment,
        risks: analysis.risks,
        recommendations: analysis.recommendations,
        recommendation: analysis.recommendation,
        overallRiskLevel: riskScore.overall,
        transcript,
        dataQuality,
        metadata: {
          date: session.createdAt.toISOString().split('T')[0],
          target: `session:${session.id}`,
          interviewDuration: Date.now() - session.createdAt.getTime(),
          questionsAsked: session.questionsAsked,
        },
      };

      const report = renderMarkdownReport(reportJson);

      // Save report + event log to disk if reportDir is set
      if (this.reportDir) {
        const { writeFileSync, mkdirSync } = await import('node:fs');
        mkdirSync(this.reportDir, { recursive: true });
        const filePath = `${this.reportDir}/${session.id}.md`;
        writeFileSync(filePath, report, 'utf-8');
        // JSON session event log for ground truth comparison
        const logPath = `${this.reportDir}/${session.id}.events.json`;
        writeFileSync(logPath, JSON.stringify(session.eventLog, null, 2), 'utf-8');
        logger.success(`Report saved: ${filePath}`);
        logger.log(`Event log saved: ${logPath}`);
      }

      session.report = report;
      session.reportJson = reportJson;
      session.status = 'complete';
      session.updatedAt = new Date();

      this.logEvent(session, 'analysis_complete', { riskLevel: riskScore.overall, riskScore: riskScore.score });
      logger.success(`Session ${session.id} complete — risk: ${riskScore.overall.toUpperCase()} | data quality: ${dataQuality.score}/100`);

      return { done: true, report, reportJson };
    } catch (err) {
      session.status = 'error';
      session.error = err instanceof Error ? err.message : String(err);
      this.logEvent(session, 'error', { message: session.error });
      throw err;
    }
  }

  private logEvent(session: Session, type: SessionEvent['type'], data: Record<string, unknown>): void {
    session.eventLog.push({
      timestamp: new Date().toISOString(),
      type,
      data,
    });
  }
}

// ─── Data Quality Computation ────────────────────────────────────────────────

/** Compute data quality metrics from the interview transcript */
function computeDataQuality(transcript: QAPair[]): DataQuality {
  const totalQuestions = transcript.length;

  // Count repeated/canned answers
  const repeatedAnswers = transcript.filter(qa => qa.answer.startsWith('[REPEATED RESPONSE]')).length;

  // Count greetings that slipped through
  const greetingCount = transcript.filter(qa =>
    /^hi\b|^hello\b|ready to answer|ready for questions|^i am ready/i.test(qa.answer.trim())
  ).length;

  const uniqueAnswers = totalQuestions - repeatedAnswers - greetingCount;

  // Check which compliance fields have real data
  const nonRepeatedText = transcript
    .filter(qa => !qa.answer.startsWith('[REPEATED RESPONSE]'))
    .map(qa => qa.answer.toLowerCase())
    .join(' ');

  const fieldsProvided: string[] = [];
  const fieldsMissing: string[] = [];

  const fieldChecks: Record<string, RegExp> = {
    systemId: /\b(api|oauth|sdk|via|using|rest|webhook|token)\b/i,
    scopesRequested: /\b(scope|permission|role|\.readonly|\.send|\.modify|\.admin|\.edit|\.file|spreadsheets|drive)\b/i,
    dataSensitivity: /\b(pii|sensitive|confidential|financial|personal|classified|non.?sensitive|credentials?)\b/i,
    blastRadius: /\b(single.?record|single.?user|team|org.?wide|cross.?tenant|one record|one user|affected)\b/i,
    frequencyAndVolume: /\b(\d+\s*(times?|per|\/|calls?|runs?|operations?)\s*(day|hour|minute|week|session|run)|batch|\d+\/day)\b/i,
    writeOperations: /\b(write|create|update|append|send|modify|delete|insert|post)\b/i,
    reversibility: /\b(revers|rollback|undo|irrevers|cannot be undone|can be restored|can be undone)\b/i,
  };

  for (const [field, pattern] of Object.entries(fieldChecks)) {
    if (pattern.test(nonRepeatedText)) {
      fieldsProvided.push(field);
    } else {
      fieldsMissing.push(field);
    }
  }

  // Score: percentage of fields provided, penalized by repeats
  const fieldScore = (fieldsProvided.length / Object.keys(fieldChecks).length) * 100;
  const repeatPenalty = (repeatedAnswers / Math.max(totalQuestions, 1)) * 50;
  const score = Math.max(0, Math.min(100, Math.round(fieldScore - repeatPenalty)));

  return {
    score,
    uniqueAnswers,
    totalQuestions,
    fieldsProvided,
    fieldsMissing,
    repeatedAnswers,
  };
}
