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

// ─── Decision Impact Classification ────────────────────────────────────────

type DecisionImpact = 'high' | 'medium' | 'unclear' | 'none';

/**
 * Classify the impact level of decisions about people.
 * High: hiring, credit, insurance, medical, legal — has legal/significant effects
 * Medium: scoring leads, ranking, recommending, moderating — influences but no legal effect
 * Unclear: agent says it decides about people, but we can't determine impact level
 */
function classifyDecisionImpact(
  decidesAboutPeople: boolean,
  details?: string,
): DecisionImpact {
  if (!decidesAboutPeople) return 'none';
  if (!details || details === 'NOT PROVIDED' || details.trim().length < 10) return 'unclear';

  const text = details.toLowerCase();

  // High-impact: legal/significant effects on individuals
  const highImpact = /\b(hir(e|ing)|recruit|screen.?candidate|reject|deny|approv(e|al|ing).*(loan|credit|mortgage|claim|application)|terminat|fir(e|ing)|credit.?scor|insurance.?claim|diagnos|prescri|legal.?decision|sentenc|parole|bail|evict|expel|suspend|disqualif|ban\b|block.?user|delist)\b/i;
  if (highImpact.test(text)) return 'high';

  // Medium-impact: influences outcomes but no legal/binding effect
  const mediumImpact = /\b(scor(e|ing)|rank|filter|recommend|prioriti[sz]|moderate|flag|qualif(y|ied)|match|sort|categori[sz]|segment|lead|prospect|outreach|target|personali[sz])\b/i;
  if (mediumImpact.test(text)) return 'medium';

  return 'unclear';
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

  // ── Signal detection ────────────────────────────────────────────────────

  // Sensitive PII = non-public identifiers, government IDs
  const hasSensitivePII = /\b(ssn|passport|social.?security|date.?of.?birth|dob|bank.?account|credit.?card|driver.?licen[sc]e|tax.?id|national.?id)\b/i.test(allText);
  // Public PII = names, emails, job titles — still personal data under GDPR but lower risk
  const hasPublicPII = /\b(pii|personal|email|name|phone|address|linkedin|profile|title|company)\b/i.test(allText);
  const hasPII = hasSensitivePII || hasPublicPII;

  // Health: require medical-specific terms (not just "health" which matches too broadly)
  const hasMedicalTerms = /\b(medical|patient|hipaa|diagnosis|prescription|clinical|ehr|emr|phi\b|protected.?health)\b/i.test(allText);
  const hasHealthInContext = /\b(health)\b/i.test(allText)
    && !/health.?check|health.?endpoint|health.?status|health.?ping|health(y|ier)/i.test(allText)
    && /\b(data|record|information|system|care|provider)\b/i.test(allText);
  const hasHealth = hasMedicalTerms || hasHealthInContext;

  // Filter out interview/orchestration platforms from signal detection
  const businessSystems = analysis.systems.filter(s => {
    const id = s.systemId.toLowerCase();
    return !/\bheron\b/.test(id)
      && !/internal\s*(orchestrat|api|platform)/.test(id)
      && !/interview\s*(platform|endpoint|api)/.test(id)
      && !/audit\s*(platform|endpoint|api)/.test(id);
  });

  const decidesAboutPeople = analysis.makesDecisionsAboutPeople === true;
  const decisionImpact = classifyDecisionImpact(decidesAboutPeople, analysis.decisionMakingDetails);
  const hasWriteOps = businessSystems.some(s => s.writeOperations.length > 0);
  const hasExcessivePerms = businessSystems.some(s => s.scopesDelta.length > 0);
  const hasIrreversibleWrites = businessSystems.some(s => s.writeOperations.some(w => !w.reversible));
  const hasOrgBlast = businessSystems.some(s => s.blastRadius === 'org-wide' || s.blastRadius === 'cross-tenant');
  // Read-only agents with org blast are less risky than write agents with org blast
  const hasOrgBlastWithWrites = hasOrgBlast && hasWriteOps;

  // ── EU Flags ──────────────────────────────────────────────────────────────

  if (decisionImpact === 'high') {
    eu.push({
      framework: 'EU AI Act (Annex III)',
      severity: 'action-required',
      description: 'Agent makes high-impact decisions about people (hiring, credit, insurance, or similar). Classified as HIGH-RISK under EU AI Act. Requires: EU database registration, conformity assessment, human oversight, incident reporting. Deadline: August 2, 2026.',
    });
  } else if (decisionImpact === 'medium') {
    eu.push({
      framework: 'EU AI Act',
      severity: 'info',
      description: 'Agent influences outcomes for people (scoring, ranking, filtering) but does not make binding decisions with legal effects. Likely LIMITED risk under EU AI Act. Transparency obligations apply (Article 50) — users must be informed they interact with an AI system.',
    });
  } else if (decisionImpact === 'unclear') {
    eu.push({
      framework: 'EU AI Act',
      severity: 'clarification-needed',
      description: 'Agent reports making decisions about people, but the impact level is unclear. Clarify: does this agent make decisions with legal or similarly significant effects (hiring, credit, insurance)? If yes → HIGH-RISK classification. If it only scores/ranks/recommends → likely LIMITED risk.',
    });
  } else {
    eu.push({
      framework: 'EU AI Act',
      severity: 'info',
      description: 'No decision-making about people detected. Likely LIMITED or MINIMAL risk. Transparency obligations may still apply (Article 50).',
    });
  }

  if (hasSensitivePII) {
    eu.push({
      framework: 'GDPR',
      severity: 'action-required',
      description: 'Agent processes sensitive personal data (government IDs, financial identifiers). Ensure lawful basis (Art. 6), conduct DPIA (Art. 35), implement data minimization (Art. 25), maintain 72-hour breach notification readiness (Art. 33).',
    });
  } else if (hasPublicPII) {
    eu.push({
      framework: 'GDPR',
      severity: 'info',
      description: 'Agent processes publicly available personal data (names, titles, profiles). GDPR applies: lawful basis likely legitimate interest (Art. 6). DPIA not required for public professional profiles.',
    });
  }

  if (decisionImpact === 'high' && hasPII) {
    eu.push({
      framework: 'GDPR Article 22',
      severity: 'action-required',
      description: 'High-impact automated decision-making about individuals. Data subjects have the right not to be subject to solely automated decisions with legal/significant effects. Ensure: human intervention, right to contest, explanation of logic.',
    });
  } else if (decisionImpact === 'medium' && hasPII) {
    eu.push({
      framework: 'GDPR Article 22',
      severity: 'info',
      description: 'Agent influences decisions about people but without binding legal effects (scoring, ranking). Article 22 may not apply directly, but transparency and data subject rights should be maintained.',
    });
  }

  if (hasExcessivePerms) {
    eu.push({
      framework: 'GDPR Article 25',
      severity: 'warning',
      description: 'Agent holds more permissions than its stated purpose requires. Narrow scopes to the minimum needed — GDPR requires data protection by design and by default (data minimization principle).',
    });
  }

  // ── US Flags ──────────────────────────────────────────────────────────────

  // SOC 2 mapping
  us.push({
    framework: 'SOC 2',
    severity: 'info',
    description: `SOC 2 control mapping: Agent identity (CC1), system access (CC6.1), auth (CC6.2), permissions (CC6.3), data sensitivity (CC6.7)${hasWriteOps ? ', write operations (CC8.1)' : ''}${hasExcessivePerms ? '. Least privilege violation at CC6.3 — narrow scopes to minimum needed' : ''}.`,
  });

  if (decisionImpact === 'high') {
    // Colorado AI Act — only for consequential decisions in defined domains
    us.push({
      framework: 'Colorado AI Act (SB 24-205)',
      severity: 'action-required',
      description: 'Agent makes consequential decisions about people in a regulated domain. Requires: algorithmic discrimination testing, consumer disclosures, human oversight, annual compliance reviews. Effective June 30, 2026.',
    });
    // NYC LL144 — only for employment
    const details = (analysis.decisionMakingDetails ?? '').toLowerCase();
    if (/\b(hir|recruit|employ|candidate|resume|applicant)\b/.test(details)) {
      us.push({
        framework: 'NYC Local Law 144',
        severity: 'warning',
        description: 'Employment-related decisions detected. If used in NYC: annual bias audit, public disclosure of results, candidate notification before AI assessment required. Penalties: $500–$1,500/day.',
      });
    }
  } else if (decisionImpact === 'medium') {
    // Lead scoring, recommendations — Colorado doesn't apply to sales outreach
    // No Colorado or LL144 flag
  } else if (decisionImpact === 'unclear') {
    us.push({
      framework: 'Colorado AI Act (SB 24-205)',
      severity: 'clarification-needed',
      description: 'Agent makes decisions about people, but unclear if they fall into regulated domains (employment, credit, insurance, housing, education, healthcare, legal). Clarify the decision type to determine if Colorado AI Act applies.',
    });
  }

  if (hasSensitivePII) {
    us.push({
      framework: 'CCPA/CPRA',
      severity: 'warning',
      description: 'Agent processes sensitive personal information. If California consumers affected: ensure access/deletion rights, opt-out for profiling. ADMT provisions effective January 1, 2027.',
    });
  }

  if (hasHealth) {
    us.push({
      framework: 'HIPAA',
      severity: 'clarification-needed',
      description: 'Health-related data detected. HIPAA applies only if the organization is a covered entity or business associate. Clarify: is this a healthcare provider, health plan, or clearinghouse? If not, HIPAA likely does not apply, but state health privacy laws may.',
    });
  }

  if (hasOrgBlastWithWrites || hasIrreversibleWrites) {
    us.push({
      framework: 'SOC 2 CC7.2 / CC8.1',
      severity: 'warning',
      description: `${hasOrgBlastWithWrites ? 'Org-wide blast radius with write access. ' : ''}${hasIrreversibleWrites ? 'Irreversible write operations detected. ' : ''}SOC 2 requires anomaly monitoring and change approval workflows for high-impact operations.`,
    });
  }

  // ── UK Flags ──────────────────────────────────────────────────────────────

  if (hasSensitivePII) {
    uk.push({
      framework: 'UK GDPR / DPA 2018',
      severity: 'action-required',
      description: 'Agent processes sensitive personal data. Lawful basis required, DPIA for high-risk processing, data minimization, 72-hour breach notification to ICO.',
    });
  } else if (hasPublicPII) {
    uk.push({
      framework: 'UK GDPR / DPA 2018',
      severity: 'info',
      description: 'Agent processes publicly available personal data. UK GDPR applies: lawful basis likely legitimate interest. DPIA not required for public professional data.',
    });
  }

  if (decisionImpact === 'high') {
    uk.push({
      framework: 'UK GDPR Article 22 / ICO AI Toolkit',
      severity: 'action-required',
      description: 'High-impact automated decision-making about people. ICO AI Toolkit requires: accountability assessment, lawfulness/fairness/transparency review, individual rights (explanation, human review, objection).',
    });
  } else if (decisionImpact === 'medium') {
    uk.push({
      framework: 'ICO AI Risk Toolkit',
      severity: 'info',
      description: 'Agent influences outcomes for people but without binding decisions. ICO recommends documenting AI use, maintaining transparency, and respecting data subject rights.',
    });
  } else if (decisionImpact === 'unclear') {
    uk.push({
      framework: 'ICO AI Risk Toolkit',
      severity: 'clarification-needed',
      description: 'Agent reports making decisions about people but impact level is unclear. Clarify the nature of decisions to determine if full ICO AI accountability framework applies.',
    });
  } else if (hasPublicPII) {
    uk.push({
      framework: 'ICO AI Risk Toolkit',
      severity: 'info',
      description: 'ICO recommends AI risk assessment for systems processing personal data. Consider: accountability, lawfulness, data minimization, individual rights.',
    });
  }

  if (hasExcessivePerms) {
    uk.push({
      framework: 'UK GDPR Article 25',
      severity: 'warning',
      description: 'Agent holds more permissions than its stated purpose requires. Narrow scopes to the minimum needed — UK GDPR data protection by design principle.',
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
