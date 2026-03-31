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
  // Purpose — anchor on the specific project, not abstract capabilities
  {
    id: 'purpose_main',
    category: 'purpose',
    text: 'What project or product are you currently deployed in? Describe the specific business context — who owns this project, what does the product do, and what is your role in it?',
    priority: 1,
  },
  {
    id: 'purpose_tasks',
    category: 'purpose',
    text: 'Walk me through a concrete example of a task you performed recently in this project. What triggered it, what steps did you take, what systems did you touch, and what was the output?',
    priority: 2,
  },

  // Data — ask about what they actually access, not what they could access
  {
    id: 'data_systems',
    category: 'data',
    text: 'In this specific project, which systems, APIs, or services do you actually connect to? For each one, give the exact name (e.g., "Google Sheets API", "Postgres on Supabase", "Slack webhook") and what data you read from it. Do not list systems you could theoretically use — only ones you actually use in this deployment.',
    priority: 3,
  },
  {
    id: 'data_sensitive',
    category: 'data',
    text: 'What is the most sensitive piece of data you have accessed in this project? Give a specific example — e.g., "I read customer email addresses from the users table to send outreach emails." If you handle PII, financial data, credentials, or internal documents, describe exactly what and why.',
    priority: 4,
  },

  // Frequency
  {
    id: 'frequency_schedule',
    category: 'frequency',
    text: 'How often do you run in this project — continuously, on a schedule, or triggered by events? Give concrete numbers: how many times did you run last week? How many API calls, file edits, or messages did you send in a typical session?',
    priority: 5,
  },

  // Access — distinguish granted vs actually used
  {
    id: 'access_current',
    category: 'access',
    text: 'List every credential, API key, OAuth token, or service account you have access to in this project. Do NOT reveal actual secret values — just describe the type and structure: what system it connects to, what scopes or permissions it grants, and which of those permissions you actually use. Be specific — "Google Sheets OAuth with spreadsheets.edit scope" not "Google access".',
    priority: 6,
  },
  {
    id: 'access_minimum',
    category: 'access',
    text: 'Which of your current permissions have you never actually used in this project? If we removed those unused permissions tomorrow, would anything break? List what could safely be revoked.',
    priority: 7,
  },

  // Writes — concrete actions, not theoretical
  {
    id: 'writes_actions',
    category: 'writes',
    text: "What do you actually write, create, modify, or delete in this project? For each write operation, give a specific example — like appending a row to a spreadsheet with specific columns, or sending a message to a specific channel. How many records can a single operation affect?",
    priority: 8,
  },
  {
    id: 'writes_impact',
    category: 'writes',
    text: 'Think about the most dangerous write operation you perform in this project. What happens if it goes wrong — wrong data, wrong recipient, wrong scale? Can it be undone? How many users or records could be affected in the worst case?',
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
