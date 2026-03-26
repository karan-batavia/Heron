import type { QAPair } from '../report/types.js';

export interface InterviewQuestion {
  id: string;
  category: QAPair['category'];
  text: string;
  priority: number; // lower = asked first
}

/**
 * Core interview question bank.
 * Questions are organized by category and asked in priority order.
 */
export const CORE_QUESTIONS: InterviewQuestion[] = [
  // Purpose
  {
    id: 'purpose_main',
    category: 'purpose',
    text: 'Describe your main purpose. What were you created to do? What problem do you solve for your users?',
    priority: 1,
  },
  {
    id: 'purpose_tasks',
    category: 'purpose',
    text: 'List the specific tasks you perform on a regular basis. Be as concrete as possible — what exactly do you do step by step?',
    priority: 2,
  },

  // Data
  {
    id: 'data_systems',
    category: 'data',
    text: 'What systems, databases, APIs, or services do you connect to or read data from? List each one and explain what data you read from it.',
    priority: 3,
  },
  {
    id: 'data_sensitive',
    category: 'data',
    text: 'Do you handle any sensitive data — personal information, financial records, credentials, internal documents, or anything that would be considered confidential? If yes, describe what and why.',
    priority: 4,
  },

  // Frequency
  {
    id: 'frequency_schedule',
    category: 'frequency',
    text: 'How often do you run or get invoked? Is it continuous, scheduled (e.g., every hour, daily), or triggered by events? How many operations do you typically perform per day or per session?',
    priority: 5,
  },

  // Access
  {
    id: 'access_current',
    category: 'access',
    text: 'What access permissions do you currently have? List each system or API and your level of access (read-only, read-write, admin, full access). Include API keys, OAuth scopes, database roles, or any credentials you use.',
    priority: 6,
  },
  {
    id: 'access_minimum',
    category: 'access',
    text: 'If you could have only the minimum access needed to do your job, what would that look like? Which of your current permissions could be removed without breaking your core functionality?',
    priority: 7,
  },

  // Writes
  {
    id: 'writes_actions',
    category: 'writes',
    text: 'What do you write, create, modify, or delete? For each action, describe: what system, what data, what scope (e.g., specific records, entire tables, specific fields).',
    priority: 8,
  },
  {
    id: 'writes_impact',
    category: 'writes',
    text: 'What would happen if one of your write operations went wrong? Could data be lost, corrupted, or exposed? Is there a rollback mechanism? What is the worst-case scenario?',
    priority: 9,
  },
];

export function getQuestionsByCategory(category: QAPair['category']): InterviewQuestion[] {
  return CORE_QUESTIONS.filter(q => q.category === category)
    .sort((a, b) => a.priority - b.priority);
}

export function getAllQuestionsSorted(): InterviewQuestion[] {
  return [...CORE_QUESTIONS].sort((a, b) => a.priority - b.priority);
}
