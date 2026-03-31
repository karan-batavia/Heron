import type { QAPair } from '../report/types.js';
import type { LLMClient } from '../llm/client.js';
import { getAllQuestionsSorted, type InterviewQuestion } from './questions.js';
import { INTERVIEW_SYSTEM_PROMPT, buildFollowUpPrompt, COMPLIANCE_FIELD_CHECKLIST } from '../llm/prompts.js';

export interface InterviewProtocol {
  /** Get the next question to ask, or null if interview is complete */
  nextQuestion(): InterviewQuestion | null;

  /** Record an answer. Returns false if answer was skipped (greeting/repeat). */
  recordAnswer(question: InterviewQuestion, answer: string): boolean;

  /** Generate a follow-up question based on context and missing compliance fields */
  generateFollowUp(category: QAPair['category']): Promise<InterviewQuestion | null>;

  /** Get the full transcript so far */
  getTranscript(): QAPair[];

  /** Check if the interview is complete */
  isComplete(): boolean;
}

// ─── Greeting detection ──────────────────────────────────────────────────────

const GREETING_PATTERNS = [
  /^hi\b/i,
  /^hello\b/i,
  /^hey\b/i,
  /ready to answer/i,
  /ready for questions/i,
  /^i am ready/i,
  /^i'm ready/i,
  /let'?s begin/i,
  /let'?s start/i,
  /^greetings/i,
];

/** Detect if an answer is just a greeting with no substantive content */
export function isGreeting(answer: string): boolean {
  const trimmed = answer.trim();
  // Short answers that match greeting patterns
  if (trimmed.length > 200) return false; // Long answers aren't greetings
  return GREETING_PATTERNS.some(p => p.test(trimmed));
}

// ─── Vagueness detection ─────────────────────────────────────────────────────

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
  // Hedging language — agent describes theoretical capabilities, not actual behavior
  /\bi may (also )?(read|write|access|connect|use|modify|create|delete)\b/i,
  /\bwhen enabled\b/i,
  /\bif the task (requires|involves|needs)\b/i,
  /\bwhen (available|needed|required|the workflow)\b/i,
  /\b(can include|could include|may include)\b/i,
  /\baccess is (environment|session|task).dependent\b/i,
  /\bdepending on (the )?task\b/i,
  /\bconnectors? (are |is )?enabled\b/i,
  // Generic tool descriptions instead of specific project usage
  /\b(local workspace|active workspace|working directory)\b/i,
  /\bconnected (development )?tools\b/i,
];

/** Detect if an answer is too vague for compliance-grade reporting */
export function isVagueAnswer(answer: string): boolean {
  return VAGUE_PATTERNS.some(p => p.test(answer));
}

// ─── Repeated answer detection ───────────────────────────────────────────────

/** Normalize answer text for comparison (trim, lowercase, collapse whitespace) */
function normalizeForComparison(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Check if an answer is a repeat of a previous answer */
function isRepeatedAnswer(answer: string, transcript: QAPair[]): boolean {
  if (transcript.length === 0) return false;
  const normalized = normalizeForComparison(answer);
  // Check for exact or near-exact repeats
  return transcript.some(qa => {
    const prevNormalized = normalizeForComparison(qa.answer);
    // Exact match or >90% overlap (handles minor variations)
    return normalized === prevNormalized ||
      (normalized.length > 50 && prevNormalized.includes(normalized.slice(0, normalized.length * 0.9 | 0)));
  });
}

// ─── Missing compliance fields ───────────────────────────────────────────────

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

// ─── Protocol factory ────────────────────────────────────────────────────────

export function createProtocol(llmClient: LLMClient, maxFollowUps = 6): InterviewProtocol {
  const coreQuestions = getAllQuestionsSorted();
  let currentIndex = 0;
  const transcript: QAPair[] = [];
  let globalFollowUpCount = 0;
  const followUpCountPerQuestion = new Map<string, number>();
  let repeatedAnswerCount = 0;

  // Follow-up queue
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

    recordAnswer(question: InterviewQuestion, answer: string): boolean {
      // Skip greetings — don't record them as answers
      if (transcript.length === 0 && isGreeting(answer)) {
        // Rewind: the question will be asked again
        if (currentIndex > 0) currentIndex--;
        return false;
      }

      // Detect repeated/canned answers
      if (isRepeatedAnswer(answer, transcript)) {
        repeatedAnswerCount++;
        // Still record it (for transparency in transcript) but mark the category
        transcript.push({
          question: question.text,
          answer: `[REPEATED RESPONSE] ${answer}`,
          category: question.category,
        });
        // After 3+ repeats, stop generating follow-ups — agent is stuck
        return true;
      }

      transcript.push({
        question: question.text,
        answer,
        category: question.category,
      });
      return true;
    },

    async generateFollowUp(category: QAPair['category']): Promise<InterviewQuestion | null> {
      // Global cap
      if (globalFollowUpCount >= maxFollowUps) return null;

      // Per-question cap (2 follow-ups per core question)
      const lastCoreQ = coreQuestions.find(q =>
        q.category === category && transcript.some(t => t.question === q.text)
      );
      if (lastCoreQ) {
        const count = followUpCountPerQuestion.get(lastCoreQ.id) ?? 0;
        if (count >= 2) return null;
      }

      // Don't follow up if agent is repeating canned responses
      if (repeatedAnswerCount >= 3) return null;

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

        globalFollowUpCount++;
        if (lastCoreQ) {
          followUpCountPerQuestion.set(lastCoreQ.id, (followUpCountPerQuestion.get(lastCoreQ.id) ?? 0) + 1);
        }

        const followUp: InterviewQuestion = {
          id: `followup_${category}_${globalFollowUpCount}`,
          category,
          text: followUpText.trim(),
          priority: 100 + globalFollowUpCount,
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
