import type { AgentConnector } from '../connectors/types.js';
import type { LLMClient } from '../llm/client.js';
import type { QAPair } from '../report/types.js';
import { createProtocol } from './protocol.js';
import * as logger from '../util/logger.js';
import { CORE_QUESTIONS } from './questions.js';

export interface InterviewOptions {
  maxFollowUps?: number;
  verbose?: boolean;
}

export interface InterviewSession {
  transcript: QAPair[];
  startedAt: Date;
  completedAt: Date;
  questionsAsked: number;
}

/**
 * Runs a structured interview with a target agent.
 * Asks core questions, generates follow-ups, collects all answers.
 */
export async function runInterview(
  connector: AgentConnector,
  llmClient: LLMClient,
  options: InterviewOptions = {},
): Promise<InterviewSession> {
  const { maxFollowUps = 3, verbose = false } = options;
  const protocol = createProtocol(llmClient, maxFollowUps);
  const startedAt = new Date();
  const totalCore = CORE_QUESTIONS.length;
  let questionNum = 0;

  logger.heading('Starting agent interview...');

  // Ask all core questions with follow-ups between category changes
  const questions = [...Array.from({ length: CORE_QUESTIONS.length }, (_, i) => i)];
  let prevCategory: QAPair['category'] | null = null;

  for (const _ of questions) {
    const question = protocol.nextQuestion();
    if (!question) break;

    // If category changed, try a follow-up on the previous category
    if (prevCategory && question.category !== prevCategory) {
      const followUp = await protocol.generateFollowUp(prevCategory);
      if (followUp) {
        questionNum++;
        logger.step(questionNum, totalCore, `[${followUp.category}] Follow-up question...`);
        const followUpAnswer = await connector.sendMessage(followUp.text);
        protocol.recordAnswer(followUp, followUpAnswer);
      }
    }

    questionNum++;
    logger.step(questionNum, totalCore, `[${question.category}] Asking question...`);

    if (verbose) {
      console.error(`  Q: ${question.text.slice(0, 80)}...`);
    }

    const answer = await connector.sendMessage(question.text);
    protocol.recordAnswer(question, answer);
    prevCategory = question.category;

    if (verbose) {
      console.error(`  A: ${answer.slice(0, 80)}...`);
    }
  }

  // Final follow-up on the last category (writes)
  const transcript = protocol.getTranscript();
  if (transcript.length > 0) {
    const lastCategory = transcript[transcript.length - 1].category;
    const finalFollowUp = await protocol.generateFollowUp(lastCategory);
    if (finalFollowUp) {
      questionNum++;
      logger.step(questionNum, totalCore, `[${finalFollowUp.category}] Final follow-up...`);

      const answer = await connector.sendMessage(finalFollowUp.text);
      protocol.recordAnswer(finalFollowUp, answer);
    }
  }

  const completedAt = new Date();
  const finalTranscript = protocol.getTranscript();

  logger.success(`Interview complete — ${finalTranscript.length} questions asked`);

  return {
    transcript: finalTranscript,
    startedAt,
    completedAt,
    questionsAsked: finalTranscript.length,
  };
}
