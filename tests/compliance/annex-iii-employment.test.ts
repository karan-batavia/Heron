import { describe, it, expect } from 'vitest';
import { detectSignals, classifyEUAIAct } from '../../src/compliance/mapper.js';
import type { QAPair } from '../../src/report/types.js';

function qa(question: string, answer: string, category: QAPair['category'] = 'purpose'): QAPair {
  return { question, answer, category };
}

describe('Annex III §4 employment gating (AAP-43 P1 #4)', () => {
  it('fires on LinkedIn ICP agent (employment + decidesAboutPeople)', () => {
    const transcript = [qa('q1', 'The agent scans LinkedIn profiles to identify potential hires and ranks candidates for outreach.')];
    const signals = detectSignals([], transcript, true, 'The agent scores candidates for hiring outreach.');
    expect(signals.hasEmploymentDecisions).toBe(true);
    const cls = classifyEUAIAct(signals);
    expect(cls.classification).toBe('high-risk');
    expect(cls.annexIIICategories.some((c) => c.includes('employment'))).toBe(true);
  });

  it('does NOT fire on MVP Edu Content (mentions employer but no decisions)', () => {
    const transcript = [
      qa('q1', 'The agent generates Russian educational content for students. Teachers are sometimes called employers of the platform.'),
    ];
    const signals = detectSignals([], transcript, false);
    // Even though the word "employer" appears, decidesAboutPeople=false gates it off
    expect(signals.hasEmploymentDecisions).toBe(false);
    const cls = classifyEUAIAct(signals);
    expect(cls.annexIIICategories.some((c) => c.includes('employment'))).toBe(false);
  });

  it('does NOT fire on generic retrieval agent with no decisions', () => {
    const transcript = [qa('q1', 'The agent fetches data from the knowledge base for users to read.')];
    const signals = detectSignals([], transcript, false);
    expect(signals.hasEmploymentDecisions).toBe(false);
  });
});
