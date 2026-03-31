import type { AuditReport, QAPair, DataQuality, Risk, SystemAssessment, WriteOperation } from './types.js';

export function renderMarkdownReport(report: AuditReport): string {
  const sections = [
    renderHeader(report),
    renderSummary(report),
    renderAgentProfile(report),
    renderRisks(report.risks),
    renderSystems(report.systems),
    renderVerdict(report),
    report.dataQuality ? renderDataQuality(report.dataQuality) : null,
    renderTranscript(report.transcript),
    renderFooter(),
  ];

  return sections.filter(Boolean).join('\n\n---\n\n');
}

// ─── Header ──────────────────────────────────────────────────────────────────

function renderHeader(report: AuditReport): string {
  const riskIcon = report.overallRiskLevel === 'critical' || report.overallRiskLevel === 'high' ? '!!' : '';
  return `# Agent Access Audit Report

**Generated**: ${report.metadata.date} | **Agent**: ${report.metadata.target} | **Risk Level**: ${report.overallRiskLevel.toUpperCase()} ${riskIcon}
**Questions Asked**: ${report.metadata.questionsAsked} | **Duration**: ${Math.round(report.metadata.interviewDuration / 1000)}s${report.dataQuality ? ` | **Data Quality**: ${report.dataQuality.score}/100` : ''}`;
}

// ─── Data Quality Badge ──────────────────────────────────────────────────────

function renderDataQuality(dq: DataQuality): string {
  const provided = dq.fieldsProvided.length;
  const total = provided + dq.fieldsMissing.length;
  const qualityLabel = dq.score >= 70 ? 'Good' : dq.score >= 40 ? 'Partial' : 'Poor';

  const rows = [
    ...dq.fieldsProvided.map(f => `| ${f} | Provided |`),
    ...dq.fieldsMissing.map(f => `| ${f} | **NOT PROVIDED** |`),
  ];

  let warning = '';
  if (dq.repeatedAnswers > 0) {
    warning = `\n\n> **Warning**: ${dq.repeatedAnswers} of ${dq.totalQuestions} answers were repeated/canned responses. Data in this report may be incomplete.`;
  }

  return `## Data Quality: ${qualityLabel} (${provided}/${total} fields) ${warning}

| Compliance Field | Status |
|-----------------|--------|
${rows.join('\n')}`;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function renderSummary(report: AuditReport): string {
  return `## Executive Summary

${report.summary}`;
}

// ─── Agent Profile ───────────────────────────────────────────────────────────

function renderAgentProfile(report: AuditReport): string {
  const lines = [`- **Purpose**: ${report.agentPurpose}`];
  if (report.agentTrigger) lines.push(`- **Trigger**: ${report.agentTrigger}`);
  if (report.agentOwner && report.agentOwner !== 'NOT PROVIDED') {
    lines.push(`- **Owner**: ${report.agentOwner}`);
  }

  // Frequency from first system if available
  const freq = report.systems[0]?.frequencyAndVolume;
  if (freq && freq !== 'NOT PROVIDED') lines.push(`- **Frequency**: ${freq}`);

  return `## Agent Profile

${lines.join('\n')}`;
}

// ─── Per-System Cards ────────────────────────────────────────────────────────

function renderSystems(systems: SystemAssessment[]): string {
  if (systems.length === 0) {
    return `## Systems & Access

No systems were identified in the interview.`;
  }

  const cards = systems.map(renderSystemCard).join('\n\n');

  return `## Systems & Access

${cards}`;
}

function renderSystemCard(sys: SystemAssessment): string {
  const rows: string[] = [];

  // Scopes
  const scopes = sys.scopesRequested.filter(s => s !== 'NOT PROVIDED');
  rows.push(`| **Scopes granted** | ${scopes.length > 0 ? scopes.join(', ') : '*NOT PROVIDED*'} |`);

  const needed = sys.scopesNeeded.filter(s => s !== 'NOT PROVIDED');
  if (needed.length > 0) {
    rows.push(`| **Scopes needed** | ${needed.join(', ')} |`);
  }

  const excessive = sys.scopesDelta;
  if (excessive.length > 0) {
    rows.push(`| **Excessive** | ${excessive.join(', ')} |`);
  }

  // Data sensitivity
  if (sys.dataSensitivity && sys.dataSensitivity !== 'NOT PROVIDED') {
    rows.push(`| **Data** | ${sys.dataSensitivity} |`);
  }

  // Blast radius
  rows.push(`| **Blast radius** | ${sys.blastRadius} |`);

  // Frequency
  if (sys.frequencyAndVolume && sys.frequencyAndVolume !== 'NOT PROVIDED') {
    rows.push(`| **Frequency** | ${sys.frequencyAndVolume} |`);
  }

  // Write operations — inline in card
  if (sys.writeOperations.length > 0) {
    const writesSummary = sys.writeOperations.map(w => {
      const rev = w.reversible ? 'reversible' : '**irreversible**';
      return `${w.operation} → ${w.target} (${rev}, ${w.volumePerDay})`;
    }).join('; ');
    rows.push(`| **Writes** | ${writesSummary} |`);
  }

  return `### ${sys.systemId}

| | |
|---|---|
${rows.join('\n')}`;
}

// ─── Risks ───────────────────────────────────────────────────────────────────

function renderRisks(risks: Risk[]): string {
  if (risks.length === 0) {
    return `## Risks

No significant risks were identified.`;
  }

  const sorted = risks
    .sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));

  const items = sorted.map(r => {
    const sev = r.severity.toUpperCase();
    const mitigation = r.mitigation ? ` **Fix**: ${r.mitigation}` : '';
    return `- **${sev}**: ${r.title} — ${r.description}${mitigation}`;
  }).join('\n');

  return `## Risks

${items}`;
}

// ─── Verdict (merged Recommendation + Recommendations) ───────────────────────

function renderVerdict(report: AuditReport): string {
  const verdict = report.recommendation ?? 'APPROVE WITH CONDITIONS';
  const recs = report.recommendations;

  let body = `**${verdict}**`;

  if (recs.length > 0) {
    body += '\n\n' + recs.map((r, i) => `${i + 1}. ${r}`).join('\n');
  }

  // Permissions delta
  const excessive: string[] = [];
  const missing: string[] = [];
  for (const sys of report.systems) {
    for (const scope of sys.scopesDelta) {
      if (scope !== 'NOT PROVIDED') {
        excessive.push(`${sys.systemId}: ${scope}`);
      }
    }
    for (const scope of sys.scopesNeeded) {
      if (!sys.scopesRequested.includes(scope) && scope !== 'NOT PROVIDED') {
        missing.push(`${sys.systemId}: ${scope}`);
      }
    }
  }

  if (excessive.length > 0 || missing.length > 0) {
    body += '\n\n**Permissions delta**:\n';
    if (excessive.length > 0) {
      body += `- Excessive: ${excessive.join(', ')}\n`;
    }
    if (missing.length > 0) {
      body += `- Missing: ${missing.join(', ')}\n`;
    }
  }

  return `## Verdict & Recommendations

${body}`;
}

// ─── Transcript ──────────────────────────────────────────────────────────────

function renderTranscript(transcript: QAPair[]): string {
  const items = transcript
    .map((qa, i) => `### Q${i + 1} [${qa.category}]\n\n**Q:** ${qa.question}\n\n**A:** ${qa.answer}`)
    .join('\n\n');

  return `## Interview Transcript

<details>
<summary>Full transcript (${transcript.length} questions)</summary>

${items}

</details>`;
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function renderFooter(): string {
  return `*Generated by [Heron](https://github.com/jonydony/Heron) — open-source agent checkpoint*

*Note: This report is based on agent self-report during a structured interview. Claims have not been independently verified against tool manifests or runtime behavior. Treat as advisory.*`;
}

function severityOrder(severity: string): number {
  switch (severity) {
    case 'critical': return 4;
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 0;
  }
}
