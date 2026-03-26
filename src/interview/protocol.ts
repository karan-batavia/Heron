import type { QAPair } from '../report/types.js';
import type { LLMClient } from '../llm/client.js';
import { getAllQuestionsSorted, type InterviewQuestion } from './questions.js';
import { INTERVIEW_SYSTEM_PROMPT, buildFollowUpPrompt } from '../llm/prompts.js';

export interface InterviewProtocol {
  /** Get the next question to ask, or null if interview is complete */
  nextQuestion(): InterviewQuestion | null;

  /** Record an answer and decide if follow-up is needed */
  recordAnswer(question: InterviewQuestion, answer: string): void;

  /** Generate a follow-up question based on context */
  generateFollowUp(category: QAPair['category']): Promise<InterviewQuestion | null>;

  /** Get the full transcript so far */
  getTranscript(): QAPair[];

  /** Check if the interview is complete */
  isComplete(): boolean;
}

export function createProtocol(llmClient: LLMClient, maxFollowUps = 3): InterviewProtocol {
  const coreQuestions = getAllQuestionsSorted();
  let currentIndex = 0;
  const transcript: QAPair[] = [];
  let followUpCount = 0;
  let pendingFollowUp: InterviewQuestion | null = null;

  return {
    nextQuestion(): InterviewQuestion | null {
      // If there's a pending follow-up, return it first
      if (pendingFollowUp) {
        const q = pendingFollowUp;
        pendingFollowUp = null;
        return q;
      }

      if (currentIndex >= coreQuestions.length) {
        return null;
      }

      return coreQuestions[currentIndex++];
    },

    recordAnswer(question: InterviewQuestion, answer: string): void {
      transcript.push({
        question: question.text,
        answer,
        category: question.category,
      });
    },

    async generateFollowUp(category: QAPair['category']): Promise<InterviewQuestion | null> {
      if (followUpCount >= maxFollowUps) {
        return null;
      }

      const categoryQA = transcript.filter(qa => qa.category === category);
      if (categoryQA.length === 0) return null;

      try {
        const followUpText = await llmClient.chat(
          INTERVIEW_SYSTEM_PROMPT,
          buildFollowUpPrompt(category, categoryQA),
        );

        if (!followUpText.trim()) return null;

        followUpCount++;
        const followUp: InterviewQuestion = {
          id: `followup_${category}_${followUpCount}`,
          category,
          text: followUpText.trim(),
          priority: 100 + followUpCount,
        };
        return followUp;
      } catch {
        return null;
      }
    },

    getTranscript(): QAPair[] {
      return [...transcript];
    },

    isComplete(): boolean {
      return currentIndex >= coreQuestions.length && pendingFollowUp === null;
    },
  };
}
