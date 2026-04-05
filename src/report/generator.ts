import type { AuditReport, DataQuality, QAPair, RegulatoryCompliance, RegulatoryFlag } from './types.js';
import type { InterviewSession } from '../interview/interviewer.js';
import { analyzeTranscript } from '../analysis/analyzer.js';
import { computeRiskScore } from '../analysis/risk-scorer.js';
import { renderMarkdownReport } from './templates.js';
import type { LLMClient } from '../llm/client.js';
import * as logger from '../util/logger.js';

export interface GenerateReportOptions {
  target: string;
  format: 'markdown' | 'json';
}

/**
 * Generates a complete audit report from an interview session.
 * Runs LLM analysis, computes risk score, and formats the output.
 */
export async function generateReport(
  session: InterviewSession,
  llmClient: LLMClient,
  options: GenerateReportOptions,
): Promise<string> {
  // 1. Analyze transcript with LLM
  const analysis = await analyzeTranscript(llmClient, session.transcript);

  // 2. Compute risk score from structured per-system data
  const riskScore = computeRiskScore(analysis.systems, analysis.risks);

  // 3. Compute regulatory flags
  const regulatoryCompliance = computeRegulatoryFlags(analysis, session.transcript);

  // 4. Build report object
  const report: AuditReport = {
    summary: analysis.summary,
    agentPurpose: analysis.agentPurpose,
    agentTrigger: analysis.agentTrigger,
    agentOwner: analysis.agentOwner,
    systems: analysis.systems,
    dataNeeds: analysis.dataNeeds,
    accessAssessment: analysis.accessAssessment,
    risks: analysis.risks,
    recommendations: analysis.recommendations,
    recommendation: analysis.recommendation,
    overallRiskLevel: riskScore.overall,
    transcript: session.transcript,
    dataQuality: computeDataQualityFromTranscript(session.transcript),
    makesDecisionsAboutPeople: analysis.makesDecisionsAboutPeople,
    decisionMakingDetails: analysis.decisionMakingDetails,
    regulatoryCompliance,
    metadata: {
      date: session.startedAt.toISOString().split('T')[0],
      target: options.target,
      interviewDuration: session.completedAt.getTime() - session.startedAt.getTime(),
      questionsAsked: session.questionsAsked,
    },
  };

  // 5. Format output
  if (options.format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  return renderMarkdownReport(report);
}

/** Derive regulatory flags from analysis results and transcript signals */
export function computeRegulatoryFlags(
  analysis: { systems: AuditReport['systems']; makesDecisionsAboutPeople?: boolean; decisionMakingDetails?: string },
  transcript: QAPair[],
): RegulatoryCompliance {
  const eu: RegulatoryFlag[] = [];
  const us: RegulatoryFlag[] = [];
  const uk: RegulatoryFlag[] = [];

  const allText = transcript.map(qa => qa.answer.toLowerCase()).join(' ');
  // Sensitive PII = non-public identifiers, credentials, government IDs
  const hasSensitivePII = /\b(ssn|passport|social.?security|date.?of.?birth|dob|bank.?account|credit.?card|driver.?licen[sc]e|tax.?id|national.?id)\b/i.test(allText);
  // Public PII = names, emails, job titles — still personal data under GDPR but lower risk
  const hasPublicPII = /\b(pii|personal|email|name|phone|address|linkedin|profile|title|company)\b/i.test(allText);
  const hasPII = hasSensitivePII || hasPublicPII;
  const hasFinancial = /\b(financial|bank|credit|invoice|payment|billing)\b/i.test(allText);
  const hasHealth = /\b(health|medical|patient|hipaa|diagnosis|prescription)\b/i.test(allText);
  const decidesAboutPeople = analysis.makesDecisionsAboutPeople === true;
  const hasWriteOps = analysis.systems.some(s => s.writeOperations.length > 0);
  const hasExcessivePerms = analysis.systems.some(s => s.scopesDelta.length > 0);
  const hasIrreversibleWrites = analysis.systems.some(s => s.writeOperations.some(w => !w.reversible));
  const hasOrgBlast = analysis.systems.some(s => s.blastRadius === 'org-wide' || s.blastRadius === 'cross-tenant');

  // ── EU Flags ──────────────────────────────────────────────────────────────

  if (decidesAboutPeople) {
    eu.push({
      framework: 'EU AI Act (Annex III)',
      severity: 'action-required',
      description: 'This agent makes decisions about people — likely classified as HIGH-RISK under EU AI Act. Requires: EU database registration, technical documentation, conformity assessment (CE marking), human oversight, and incident reporting. Deadline: August 2, 2026.',
    });
  } else {
    eu.push({
      framework: 'EU AI Act',
      severity: 'info',
      description: 'No decision-making about people detected. Likely LIMITED or MINIMAL risk under EU AI Act. Transparency obligations may still apply (Article 50) — users must be informed they are interacting with an AI system.',
    });
  }

  if (hasSensitivePII) {
    eu.push({
      framework: 'GDPR',
      severity: 'action-required',
      description: 'Agent processes sensitive personal data (government IDs, financial identifiers, or similar). GDPR applies: ensure lawful basis (Art. 6), conduct Data Protection Impact Assessment (Art. 35), implement data minimization (Art. 25), maintain 72-hour breach notification readiness (Art. 33).',
    });
  } else if (hasPublicPII) {
    eu.push({
      framework: 'GDPR',
      severity: 'warning',
      description: 'Agent processes publicly available personal data (names, titles, profiles). GDPR still applies to public data: ensure lawful basis (Art. 6, likely legitimate interest), document processing activity, respect data subject rights. DPIA may not be required if data is limited to public professional profiles.',
    });
  }

  if (decidesAboutPeople && hasPII) {
    eu.push({
      framework: 'GDPR Article 22',
      severity: hasSensitivePII ? 'action-required' : 'warning',
      description: `Automated decision-making affecting individuals detected. ${hasSensitivePII ? 'Sensitive data involved — strict obligations apply.' : 'Public data only — lower risk, but rights still apply.'} Data subjects have the right not to be subject to solely automated decisions with legal/significant effects. Ensure: human intervention available, right to contest, meaningful explanation of logic.`,
    });
  }

  if (hasExcessivePerms) {
    eu.push({
      framework: 'GDPR Article 25',
      severity: 'warning',
      description: 'Excessive permissions detected. GDPR requires data protection by design and by default — agent should only have permissions necessary for its stated purpose (data minimization principle).',
    });
  }

  // ── US Flags ──────────────────────────────────────────────────────────────

  // SOC 2 mapping
  us.push({
    framework: 'SOC 2',
    severity: 'info',
    description: `SOC 2 control mapping: Agent identity/purpose (CC1), systems accessed (CC6.1), auth methods (CC6.2), permissions (CC6.3), data sensitivity (CC6.7), usage monitoring (CC7.1)${hasWriteOps ? ', write operations (CC8.1)' : ''}${hasExcessivePerms ? '. Excess permissions flagged — CC6.3 least privilege concern' : ''}.`,
  });

  if (decidesAboutPeople) {
    us.push({
      framework: 'Colorado AI Act (SB 24-205)',
      severity: 'action-required',
      description: 'Agent makes consequential decisions about people. Colorado AI Act (effective June 30, 2026) requires: algorithmic discrimination testing, consumer disclosures, meaningful human oversight, and annual compliance reviews.',
    });
    us.push({
      framework: 'NYC Local Law 144',
      severity: 'warning',
      description: 'If used for employment decisions in NYC: annual bias audit required, public disclosure of results, candidate notification before AI assessment. Penalties: $500-$1,500/day.',
    });
  }

  if (hasSensitivePII) {
    us.push({
      framework: 'CCPA/CPRA',
      severity: 'warning',
      description: 'Agent processes sensitive personal information. If California consumers affected: ensure consumer access/deletion rights, opt-out for profiling. ADMT provisions effective January 1, 2027 — risk assessments required.',
    });
  } else if (hasPublicPII && decidesAboutPeople) {
    us.push({
      framework: 'CCPA/CPRA',
      severity: 'info',
      description: 'Agent processes publicly available personal information for decision-making. CCPA may apply if profiling California consumers. ADMT provisions effective January 1, 2027.',
    });
  }

  if (hasHealth) {
    us.push({
      framework: 'HIPAA',
      severity: 'action-required',
      description: 'Health data detected. If a covered entity or business associate: HIPAA compliance mandatory — encryption in transit/at rest, Business Associate Agreement required, minimum necessary standard for data access.',
    });
  }

  if (hasOrgBlast || hasIrreversibleWrites) {
    us.push({
      framework: 'SOC 2 CC7.2 / CC8.1',
      severity: 'warning',
      description: `${hasOrgBlast ? 'Org-wide or cross-tenant blast radius detected. ' : ''}${hasIrreversibleWrites ? 'Irreversible write operations detected. ' : ''}SOC 2 requires anomaly monitoring and change approval workflows for high-impact operations.`,
    });
  }

  // ── UK Flags ──────────────────────────────────────────────────────────────

  if (hasSensitivePII) {
    uk.push({
      framework: 'UK GDPR / DPA 2018',
      severity: 'action-required',
      description: 'Agent processes sensitive personal data. UK GDPR applies: lawful basis required, DPIA for high-risk processing, data minimization, 72-hour breach notification to ICO.',
    });
  } else if (hasPublicPII) {
    uk.push({
      framework: 'UK GDPR / DPA 2018',
      severity: 'warning',
      description: 'Agent processes publicly available personal data. UK GDPR still applies: ensure lawful basis (likely legitimate interest), document processing activities, respect data subject rights. DPIA may not be required for public professional data.',
    });
  }

  if (decidesAboutPeople) {
    uk.push({
      framework: 'UK GDPR Article 22 / ICO AI Toolkit',
      severity: 'action-required',
      description: 'Automated decision-making about people detected. ICO AI and Data Protection Risk Toolkit applies: full accountability assessment, lawfulness/fairness/transparency review, individual rights (explanation, human review, objection).',
    });
  } else {
    uk.push({
      framework: 'ICO AI Risk Toolkit',
      severity: 'info',
      description: 'ICO recommends AI risk assessment for all AI systems processing personal data. Consider: accountability (governance, DPO), lawfulness, data minimization, and individual rights.',
    });
  }

  if (hasExcessivePerms) {
    uk.push({
      framework: 'UK GDPR Article 25',
      severity: 'warning',
      description: 'Excessive permissions detected. UK GDPR data protection by design principle requires permissions limited to what is necessary for the stated purpose.',
    });
  }

  return { eu, us, uk };
}

/** Compute data quality metrics from the interview transcript (CLI path) */
function computeDataQualityFromTranscript(transcript: QAPair[]): DataQuality {
  const totalQuestions = transcript.length;
  const repeatedAnswers = transcript.filter(qa => qa.answer.startsWith('[REPEATED RESPONSE]')).length;
  const greetingCount = transcript.filter(qa =>
    /^hi\b|^hello\b|ready to answer|ready for questions|^i am ready/i.test(qa.answer.trim())
  ).length;
  const uniqueAnswers = totalQuestions - repeatedAnswers - greetingCount;

  const nonRepeatedText = transcript
    .filter(qa => !qa.answer.startsWith('[REPEATED RESPONSE]'))
    .map(qa => qa.answer.toLowerCase())
    .join(' ');

  const fieldChecks: Record<string, RegExp> = {
    systemId: /\b(api|oauth|sdk|via|using|rest|webhook|token)\b/i,
    scopesRequested: /\b(scope|permission|role|\.readonly|\.send|\.modify|\.admin|\.edit|\.file|spreadsheets|drive)\b/i,
    dataSensitivity: /\b(pii|sensitive|confidential|financial|personal|classified|non.?sensitive|credentials?)\b/i,
    blastRadius: /\b(single.?record|single.?user|team|org.?wide|cross.?tenant|one record|one user|affected)\b/i,
    frequencyAndVolume: /\b(\d+\s*(times?|per|\/|calls?|runs?|operations?)\s*(day|hour|minute|week|session|run)|batch|\d+\/day)\b/i,
    writeOperations: /\b(write|create|update|append|send|modify|delete|insert|post)\b/i,
    reversibility: /\b(revers|rollback|undo|irrevers|cannot be undone|can be restored|can be undone)\b/i,
  };

  const fieldsProvided: string[] = [];
  const fieldsMissing: string[] = [];
  for (const [field, pattern] of Object.entries(fieldChecks)) {
    if (pattern.test(nonRepeatedText)) {
      fieldsProvided.push(field);
    } else {
      fieldsMissing.push(field);
    }
  }

  const fieldScore = (fieldsProvided.length / Object.keys(fieldChecks).length) * 100;
  const repeatPenalty = (repeatedAnswers / Math.max(totalQuestions, 1)) * 50;
  const score = Math.max(0, Math.min(100, Math.round(fieldScore - repeatPenalty)));

  return { score, uniqueAnswers, totalQuestions, fieldsProvided, fieldsMissing, repeatedAnswers };
}
