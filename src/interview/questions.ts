import type { QAPair } from '../report/types.js';

export interface InterviewQuestion {
  id: string;
  category: QAPair['category'];
  text: string;
  priority: number; // lower = asked first
  /** The compliance field this question targets */
  complianceField?: string;
}

/**
 * Core interview question bank — structured template format.
 *
 * Each question targets ONE compliance field and includes format examples
 * so agents know the expected level of detail. Questions follow a funnel:
 * identity → enumeration → per-system detail → risk assessment.
 */
export const CORE_QUESTIONS: InterviewQuestion[] = [
  // 1. Context anchor — lock agent into specific deployment
  {
    id: 'context_anchor',
    category: 'purpose',
    complianceField: 'agentProfile',
    text: `Before we begin, fill in this profile about your CURRENT deployment:
1. Project/product name
2. Owner (team or person)
3. What triggers your execution (event / schedule / manual)
4. One sentence: what you specifically do in this project

Answer ONLY about this specific deployment, not your general capabilities.`,
    priority: 1,
  },

  // 2. Systems enumeration — get the full list first
  {
    id: 'systems_enum',
    category: 'data',
    complianceField: 'systemId',
    text: `List every system you ACTUALLY connect to in this project.
Format per system: Name → API type → Auth method
Example: Google Sheets → REST API → OAuth2 (spreadsheets.edit)

Only list systems you have actually used in this deployment — not ones that are theoretically available.`,
    priority: 2,
  },

  // 3. Permissions per system
  {
    id: 'scopes_current',
    category: 'access',
    complianceField: 'scopesRequested',
    text: `For each system you listed above, what specific permissions do you currently have?
List exact OAuth scopes, API key types, or database roles.
Do NOT reveal actual secret values — just describe the type and what access it grants.
Example: Google Sheets OAuth2 with scopes: spreadsheets, drive.file`,
    priority: 3,
  },

  // 4. Data sensitivity per system
  {
    id: 'data_sensitivity',
    category: 'data',
    complianceField: 'dataSensitivity',
    text: `For each system you connect to, what data do you read?
Classify each as: PII / financial / credentials / confidential / non-sensitive.
Give one concrete example of the most sensitive data you have accessed.
Example: "I read invoice amounts and vendor bank details from QuickBooks — financial data."`,
    priority: 4,
  },

  // 5. Write operations — structured template
  {
    id: 'write_operations',
    category: 'writes',
    complianceField: 'writeOperations',
    text: `List every write operation you perform in this project. Use this format for each:
Action → Target system → Reversible? → Approval needed? → Volume/day

Example: Append row → Google Sheet "Invoices" → Yes → No → ~40/day
Example: Send message → Slack #alerts → No → No → ~5/day`,
    priority: 5,
  },

  // 6. Blast radius
  {
    id: 'blast_radius',
    category: 'writes',
    complianceField: 'blastRadius',
    text: `Think about your most dangerous write operation in this project.
1. How many records or users can it affect? (1 record / 1 user / whole team / whole org / cross-tenant)
2. What is the worst-case scenario if it goes wrong?
3. Can it be undone?`,
    priority: 6,
  },

  // 7. Frequency and volume
  {
    id: 'frequency_volume',
    category: 'frequency',
    complianceField: 'frequencyAndVolume',
    text: `Give concrete numbers about your usage in this project:
1. How many times did you run in the last week?
2. How many API calls per typical run?
3. Do you process items one-at-a-time or in batches? What batch size?`,
    priority: 7,
  },

  // 8. Excess permissions
  {
    id: 'excess_permissions',
    category: 'access',
    complianceField: 'scopesDelta',
    text: `Which of your current permissions have you NEVER actually used in this project?
If we revoked those unused permissions tomorrow, would anything break?
List what could safely be removed.`,
    priority: 8,
  },

  // 9. Worst case stress test
  {
    id: 'worst_case',
    category: 'writes',
    complianceField: 'riskAssessment',
    text: `Imagine the worst realistic failure scenario for this project:
wrong data sent to the wrong recipient, at maximum scale.
Describe: what goes wrong, who is affected, how bad is the damage, and can it be recovered?`,
    priority: 9,
  },

  // 10. Decision-making about people — regulatory risk classification
  {
    id: 'decision_making',
    category: 'purpose',
    complianceField: 'decisionMaking',
    text: `Does this agent make or influence decisions about people?
For example: hiring/screening candidates, scoring creditworthiness, approving insurance claims,
moderating user content, granting/denying access, evaluating employee performance.

If yes, describe: what kind of decision, who is affected, and is a human involved before the final decision?`,
    priority: 10,
  },
];

export function getQuestionsByCategory(category: QAPair['category']): InterviewQuestion[] {
  return CORE_QUESTIONS.filter(q => q.category === category)
    .sort((a, b) => a.priority - b.priority);
}

export function getAllQuestionsSorted(): InterviewQuestion[] {
  return [...CORE_QUESTIONS].sort((a, b) => a.priority - b.priority);
}
