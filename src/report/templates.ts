import type { AuditReport, QAPair, DataQuality, Risk, SystemAssessment, WriteOperation } from './types.js';

export function renderMarkdownReport(report: AuditReport): string {
  const sections = [
    renderHeader(report),
    renderScopeAndMethodology(report),
    renderSummary(report),
    renderAgentProfile(report),
    renderFindings(report.risks),
    renderSystems(report.systems),
    renderVerdict(report),
    report.dataQuality ? renderDataQuality(report.dataQuality) : null,
    renderTranscript(report.transcript),
    renderDisclaimer(),
  ];

  return sections.filter(Boolean).join('\n\n---\n\n');
}

// ─── Header ──────────────────────────────────────────────────────────────────

function renderHeader(report: AuditReport): string {
  const riskIcon = report.overallRiskLevel === 'critical' || report.overallRiskLevel === 'high' ? '!!' : '';
  const dqPart = report.dataQuality ? ` | **Data Quality**: ${report.dataQuality.score}/100` : '';
  return `# Agent Access Audit Report

**Generated**: ${report.metadata.date} | **Agent**: ${report.metadata.target} | **Risk Level**: ${report.overallRiskLevel.toUpperCase()} ${riskIcon}${dqPart}`;
}

// ─── Scope & Methodology ────────────────────────────────────────────────────

function renderScopeAndMethodology(report: AuditReport): string {
  return `## Scope & Methodology

**Assessment type**: Automated structured interview

**Method**: Heron conducted a ${report.metadata.questionsAsked}-question interview covering agent purpose, data access, permissions, write operations, and operational frequency. Duration: ${Math.round(report.metadata.interviewDuration / 1000)}s.

**Limitations**: This assessment is based solely on the agent's self-reported information. No runtime analysis, code review, or network traffic inspection was performed. Findings should be verified against actual system configurations.`;
}

// ─── Data Quality Badge ──────────────────────────────────────────────────────

function renderDataQuality(dq: DataQuality): string {
  const provided = dq.fieldsProvided.length;
  const total = provided + dq.fieldsMissing.length;
  const qualityLabel = dq.score >= 70 ? 'Good' : dq.score >= 40 ? 'Partial' : 'Poor';

  const fieldDescriptions: Record<string, string> = {
    systemId: 'External systems connected (name, API type, auth)',
    scopesRequested: 'Permissions/scopes granted to the agent',
    dataSensitivity: 'Data classification (PII, financial, etc.)',
    blastRadius: 'Scope of impact if something goes wrong',
    frequencyAndVolume: 'How often it runs, API calls per run',
    writeOperations: 'What the agent creates, modifies, or deletes',
    reversibility: 'Whether write operations can be undone',
  };

  const rows = [
    ...dq.fieldsProvided.map(f => `| ${f} | ${fieldDescriptions[f] ?? ''} | Provided |`),
    ...dq.fieldsMissing.map(f => `| ${f} | ${fieldDescriptions[f] ?? ''} | **NOT PROVIDED** |`),
  ];

  let warning = '';
  if (dq.repeatedAnswers > 0) {
    warning = `\n\n> **Warning**: ${dq.repeatedAnswers} of ${dq.totalQuestions} answers were repeated/canned responses. Data in this report may be incomplete.`;
  }

  return `## Data Quality: ${qualityLabel} (${provided}/${total} fields) ${warning}

| Field | What it measures | Status |
|-------|-----------------|--------|
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

// ─── Findings ───────────────────────────────────────────────────────────────

function renderFindings(risks: Risk[]): string {
  if (risks.length === 0) {
    return `## Findings

No significant findings were identified.`;
  }

  const sorted = risks
    .sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));

  const rows = sorted.map((r, i) => {
    const id = `HERON-${String(i + 1).padStart(3, '0')}`;
    const mitigation = r.mitigation ? ` ${r.mitigation}` : '';
    return `| ${id} | ${r.severity.toUpperCase()} | ${r.title} | ${r.description}${mitigation} |`;
  }).join('\n');

  return `## Findings

| ID | Severity | Finding | Description |
|----|----------|---------|-------------|
${rows}`;
}

// ─── Verdict (merged Recommendation + Recommendations) ───────────────────────

function renderVerdict(report: AuditReport): string {
  const verdict = report.recommendation ?? 'APPROVE WITH CONDITIONS';
  const recs = report.recommendations;

  let body = `**${verdict}**`;

  if (recs.length > 0) {
    body += '\n\n' + recs.map((r, i) => `${i + 1}. ${r}`).join('\n');
  }

  // Permissions delta — grouped by system
  const excessiveBySystem = new Map<string, string[]>();
  const missingBySystem = new Map<string, string[]>();
  for (const sys of report.systems) {
    // Skip Heron itself if agent reported it as a connected system
    if (/\bheron\b/i.test(sys.systemId)) continue;

    for (const scope of sys.scopesDelta) {
      if (scope !== 'NOT PROVIDED') {
        if (!excessiveBySystem.has(sys.systemId)) excessiveBySystem.set(sys.systemId, []);
        excessiveBySystem.get(sys.systemId)!.push(scope);
      }
    }
    for (const scope of sys.scopesNeeded) {
      if (!sys.scopesRequested.includes(scope) && scope !== 'NOT PROVIDED') {
        if (!missingBySystem.has(sys.systemId)) missingBySystem.set(sys.systemId, []);
        missingBySystem.get(sys.systemId)!.push(scope);
      }
    }
  }

  if (excessiveBySystem.size > 0 || missingBySystem.size > 0) {
    body += '\n\n**Permissions delta**:\n';
    if (excessiveBySystem.size > 0) {
      body += '\n*Excessive (can be revoked):*\n';
      for (const [system, scopes] of excessiveBySystem) {
        body += `- **${system}**: ${scopes.join('; ')}\n`;
      }
    }
    if (missingBySystem.size > 0) {
      body += '\n*Minimum needed:*\n';
      for (const [system, scopes] of missingBySystem) {
        body += `- **${system}**: ${scopes.join('; ')}\n`;
      }
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

// ─── Disclaimer ─────────────────────────────────────────────────────────────

function renderDisclaimer(): string {
  return `---

*This report was generated automatically by [Heron](https://github.com/jonydony/Heron), an open-source AI agent auditor. It is based on the agent's self-reported information obtained through a structured interview. This is not a formal security audit, penetration test, or compliance certification. Claims have not been independently verified against tool manifests, runtime behavior, or system configurations. Findings should be independently verified before making access control decisions.*`;
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
