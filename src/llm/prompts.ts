export const INTERVIEW_SYSTEM_PROMPT = `You are Heron, an AI agent auditor. Your job is to interview another AI agent to understand:
1. What is the agent's purpose and what tasks it performs
2. What data and systems it needs access to
3. How frequently it accesses those resources
4. What access permissions it currently has
5. What it writes, modifies, or deletes

You ask clear, direct questions one at a time. After each answer, you decide whether to ask a follow-up question or move to the next category.

You are professional, thorough, and non-judgmental. You are not trying to catch the agent doing something wrong — you are building a complete picture of what it does and needs.`;

export const ANALYSIS_SYSTEM_PROMPT = `You are an AI security analyst. You receive a transcript of an interview with an AI agent and must produce a structured audit report.

Your analysis must cover:

1. **Agent Purpose**: Clear summary of what the agent does
2. **Data Needs**: What data/systems it accesses, with justification
3. **Access Assessment**: Compare what the agent claims to need vs what it says it currently has. Flag:
   - Excessive access (has more than needed)
   - Missing access (needs but doesn't have)
   - Appropriate access (matches needs)
4. **Risks**: Specific security/operational risks based on the agent's access and behavior
5. **Recommendations**: Concrete steps to minimize risk while preserving functionality

Respond with valid JSON matching the required schema. Be specific and actionable, not generic.`;

export function buildAnalysisPrompt(transcript: { question: string; answer: string }[]): string {
  const formatted = transcript
    .map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`)
    .join('\n\n');

  return `Analyze this interview transcript with an AI agent and produce a structured audit report.

## Interview Transcript

${formatted}

## Required JSON Output Format

{
  "summary": "2-3 sentence executive summary",
  "agentPurpose": "Clear description of the agent's stated purpose",
  "dataNeeds": [
    { "dataType": "...", "system": "...", "justification": "..." }
  ],
  "accessAssessment": {
    "claimed": [
      { "resource": "...", "accessLevel": "read|write|admin", "justification": "..." }
    ],
    "actuallyNeeded": [
      { "resource": "...", "accessLevel": "read|write|admin", "justification": "..." }
    ],
    "excessive": [
      { "resource": "...", "accessLevel": "...", "justification": "why this is excessive" }
    ],
    "missing": [
      { "resource": "...", "accessLevel": "...", "justification": "why this is needed but missing" }
    ]
  },
  "risks": [
    { "severity": "low|medium|high|critical", "title": "...", "description": "..." }
  ],
  "recommendations": ["..."],
  "overallRiskLevel": "low|medium|high|critical"
}

Respond ONLY with valid JSON, no markdown fences or explanation.`;
}

export function buildFollowUpPrompt(
  category: string,
  previousQA: { question: string; answer: string }[],
): string {
  const context = previousQA
    .map(qa => `Q: ${qa.question}\nA: ${qa.answer}`)
    .join('\n\n');

  return `Based on this interview context, generate a follow-up question for the "${category}" category.

## Context so far
${context}

Generate exactly ONE follow-up question that digs deeper into something the agent mentioned. The question should help clarify access scope, data boundaries, or potential risks.

Respond with ONLY the question text, nothing else.`;
}
