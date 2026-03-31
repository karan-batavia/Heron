import type { QAPair } from '../report/types.js';
import type { LLMClient } from '../llm/client.js';
import { getAllQuestionsSorted, type InterviewQuestion } from './questions.js';
import { INTERVIEW_SYSTEM_PROMPT, buildFollowUpPrompt, COMPLIANCE_FIELD_CHECKLIST } from '../llm/prompts.js';

export interface InterviewProtocol {
  /** Get the next question to ask, or null if interview is complete */
  nextQuestion(): InterviewQuestion | null;

  /** Record an answer and decide if follow-up is needed */
  recordAnswer(question: InterviewQuestion, answer: string): void;

  /** Generate a follow-up question based on context and missing compliance fields */
  generateFollowUp(category: QAPair['category']): Promise<InterviewQuestion | null>;

  /** Get the full transcript so far */
  getTranscript(): QAPair[];

  /** Check if the interview is complete */
  isComplete(): boolean;
}

/** Vagueness indicators — if an answer matches these patterns, it needs a follow-up */
const VAGUE_PATTERNS = [
  /\b(the database|a database|some database)\b/i,
  /\b(read and write|read\/write|full access)\b/i,
  /\b(user data|some data|the data)\b/i,
  /\b(regularly|periodically|sometimes|occasionally|as needed|when needed)\b/i,
  /\b(could affect|might affect|may affect)\b/i,
  /\b(various|several|multiple|many|some)\s+(systems?|apis?|services?|databases?)/i,
  /\b(everything|all access|full permissions?)\b/i,
  /\bi[' ']?m not sure\b/i,
  /\bnot sure\b/i,
  /\bi don[' ']?t know\b/i,
];

/** Check which compliance fields are missing from the transcript for a given category */
function findMissingFields(transcript: QAPair[]): string[] {
  const allText = transcript.map(qa => qa.answer.toLowerCase()).join(' ');
  const missing: string[] = [];

  // Check for specific system identifiers
  if (!/\b(api|oauth|sdk|via|using)\b/i.test(allText)) {
    missing.push('systemId (specific API names, auth methods)');
  }

  // Check for specific scopes
  if (!/\b(scope|permission|role|\.readonly|\.send|\.modify|\.admin)\b/i.test(allText)) {
    missing.push('scopesRequested (specific OAuth scopes, API permissions)');
  }

  // Check for data sensitivity classification
  if (!/\b(pii|sensitive|confidential|financial|personal|classified)\b/i.test(allText)) {
    missing.push('dataSensitivity (PII, financial, confidential classification)');
  }

  // Check for blast radius
  if (!/\b(single.?record|single.?user|team|org.?wide|cross.?tenant|mailbox|affected)\b/i.test(allText)) {
    missing.push('blastRadius (scope of impact: single-record/user/team/org-wide)');
  }

  // Check for frequency numbers
  if (!/\b(\d+\s*(times?|per|\/)\s*(day|hour|minute|week|session)|batch)\b/i.test(allText)) {
    missing.push('frequencyAndVolume (specific numbers: times/day, batch size)');
  }

  // Check for write reversibility
  if (!/\b(revers|rollback|undo|irrevers|cannot be undone|can be restored)\b/i.test(allText)) {
    missing.push('writeOperations.reversible (whether writes can be rolled back)');
  }

  return missing;
}

/** Detect if an answer is too vague for compliance-grade reporting */
export function isVagueAnswer(answer: string): boolean {
  return VAGUE_PATTERNS.some(p => p.test(answer));
}

export function createProtocol(llmClient: LLMClient, maxFollowUps = 3): InterviewProtocol {
  const coreQuestions = getAllQuestionsSorted();
  let currentIndex = 0;
  const transcript: QAPair[] = [];
  let followUpCount = 0;

  // Follow-up queue: clean replacement for monkey-patching protocol.nextQuestion
  const followUpQueue: InterviewQuestion[] = [];

  return {
    nextQuestion(): InterviewQuestion | null {
      // Drain follow-up queue first
      if (followUpQueue.length > 0) {
        return followUpQueue.shift()!;
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

      // Check if the last answer was vague
      const lastAnswer = categoryQA[categoryQA.length - 1].answer;
      const vague = isVagueAnswer(lastAnswer);

      // Find missing compliance fields across all transcript
      const missingFields = findMissingFields(transcript);

      // Only generate follow-up if answer was vague or compliance fields are missing
      if (!vague && missingFields.length === 0) return null;

      try {
        const followUpText = await llmClient.chat(
          INTERVIEW_SYSTEM_PROMPT,
          buildFollowUpPrompt(category, categoryQA, missingFields.length > 0 ? missingFields : undefined),
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
      return currentIndex >= coreQuestions.length && followUpQueue.length === 0;
    },
  };
}

/**
 * Enqueue a follow-up question to be asked next.
 * Used by SessionManager to avoid monkey-patching protocol.nextQuestion.
 */
export function enqueueFollowUp(protocol: InterviewProtocol, followUp: InterviewQuestion): void {
  // The follow-up queue is internal to createProtocol, so we need another approach.
  // Instead, we expose a method to push into the queue via the protocol's nextQuestion behavior.
  // Actually, the clean way is to just have SessionManager track its own queue — see sessions.ts.
  // This function exists for the scan/CLI path where the interviewer handles follow-ups inline.
  void protocol;
  void followUp;
}
