import { describe, it, expect } from 'vitest';
import { getAllQuestionsSorted, getQuestionsByCategory, CORE_QUESTIONS } from '../../src/interview/questions.js';

describe('questions', () => {
  it('has questions for all categories', () => {
    const categories = new Set(CORE_QUESTIONS.map(q => q.category));
    expect(categories).toContain('purpose');
    expect(categories).toContain('data');
    expect(categories).toContain('frequency');
    expect(categories).toContain('access');
    expect(categories).toContain('writes');
  });

  it('getAllQuestionsSorted returns questions in priority order', () => {
    const questions = getAllQuestionsSorted();
    for (let i = 1; i < questions.length; i++) {
      expect(questions[i].priority).toBeGreaterThanOrEqual(questions[i - 1].priority);
    }
  });

  it('getQuestionsByCategory filters correctly', () => {
    const purposeQuestions = getQuestionsByCategory('purpose');
    expect(purposeQuestions.length).toBeGreaterThan(0);
    expect(purposeQuestions.every(q => q.category === 'purpose')).toBe(true);
  });

  it('each question has unique id', () => {
    const ids = CORE_QUESTIONS.map(q => q.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
