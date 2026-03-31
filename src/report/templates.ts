import type { AuditReport, QAPair, DataNeed, Risk, SystemAssessment, WriteOperation } from './types.js';

export function renderMarkdownReport(report: AuditReport): string {
  const sections = [
    renderHeader(report),
    renderSummary(report),
    renderAgentProfile(report),
    renderSystemsAndPermissions(report.systems),
    renderWriteOperations(report.systems),
    renderRisks(report.risks),
    renderPermissionsDelta(report.systems),
    renderRecommendation(report),
    renderRecommendations(report.recommendations),
    renderTranscript(report.transcript),
    renderFooter(),
  ];

  return sections.join('\n\n---\n\n');
}

function renderHeader(report: AuditReport): string {
  const riskIcon = report.overallRiskLevel === 'critical' || report.overallRiskLevel === 'high' ? '!!' : '';
  return `# Agent Access Audit Report

**Generated**: ${report.metadata.date} | **Agent**: ${report.metadata.target} | **Risk Level**: ${report.overallRiskLevel.toUpperCase()} ${riskIcon}
**Questions Asked**: ${report.metadata.questionsAsked} | **Duration**: ${Math.round(report.metadata.interviewDuration / 1000)}s`;
}

function renderSummary(report: AuditReport): string {
  return `## Executive Summary

${report.summary}`;
}

function renderAgentProfile(report: AuditReport): string {
  const lines = [`- **Purpose**: ${report.agentPurpose}`];
  if (report.agentTrigger) lines.push(`- **Trigger**: ${report.agentTrigger}`);
  if (report.agentOwner) lines.push(`- **Owner**: ${report.agentOwner}`);

  // Frequency from first system if available
  const freq = report.systems[0]?.frequencyAndVolume;
  if (freq) lines.push(`- **Frequency**: ${freq}`);

  return `## Agent Profile

${lines.join('\n')}`;
}

function renderSystemsAndPermissions(systems: SystemAssessment[]): string {
  if (systems.length === 0) {
    return `## Systems & Permissions

No systems were identified.`;
  }

  const rows = systems.map(sys => {
    const requested = sys.scopesRequested.join(', ') || '—';
    const needed = sys.scopesNeeded.join(', ') || '—';
    const delta = sys.scopesDelta.length > 0 ? sys.scopesDelta.join(', ') : 'None';
    return `| ${sys.systemId} | ${requested} | ${needed} | ${delta} | ${sys.dataSensitivity} | ${sys.blastRadius} |`;
  }).join('\n');

  return `## Systems & Permissions

| System | Scopes Requested | Scopes Needed | Excessive | Data Sensitivity | Blast Radius |
|--------|-----------------|---------------|-----------|-----------------|--------------|
${rows}`;
}

function renderWriteOperations(systems: SystemAssessment[]): string {
  const allWrites: (WriteOperation & { system: string })[] = [];
  for (const sys of systems) {
    for (const w of sys.writeOperations) {
      allWrites.push({ ...w, system: sys.systemId });
    }
  }

  if (allWrites.length === 0) {
    return `## Write Operations

No write operations were identified.`;
  }

  const rows = allWrites.map(w =>
    `| ${w.operation} | ${w.system} — ${w.target} | ${w.reversible ? 'Yes' : 'No'} | ${w.approvalRequired ? 'Yes' : 'No'} | ${w.volumePerDay} |`
  ).join('\n');

  return `## Write Operations

| Operation | Target | Reversible? | Approval Required? | Volume/Day |
|-----------|--------|-------------|-------------------|------------|
${rows}`;
}

function renderRisks(risks: Risk[]): string {
  if (risks.length === 0) {
    return `## Risk Assessment

No significant risks were identified.`;
  }

  const rows = risks
    .sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity))
    .map(r => {
      const mitigation = r.mitigation ?? '—';
      return `| ${r.title} | ${r.severity.toUpperCase()} | ${r.description} | ${mitigation} |`;
    })
    .join('\n');

  return `## Risk Assessment

| Risk | Severity | Description | Mitigation |
|------|----------|-------------|------------|
${rows}`;
}

function renderPermissionsDelta(systems: SystemAssessment[]): string {
  const excessive: string[] = [];
  const missing: string[] = [];

  for (const sys of systems) {
    for (const scope of sys.scopesDelta) {
      excessive.push(`${sys.systemId}: ${scope}`);
    }
    // Scopes needed but not in requested
    for (const scope of sys.scopesNeeded) {
      if (!sys.scopesRequested.includes(scope)) {
        missing.push(`${sys.systemId}: ${scope}`);
      }
    }
  }

  const excessiveText = excessive.length > 0
    ? excessive.map(e => `- ${e}`).join('\n')
    : 'None identified';

  const missingText = missing.length > 0
    ? missing.map(m => `- ${m}`).join('\n')
    : 'None identified';

  return `## Permissions Delta

**Excessive** (scopes requested but not needed):
${excessiveText}

**Missing** (needed but not requested — agent may fail):
${missingText}`;
}

function renderRecommendation(report: AuditReport): string {
  if (!report.recommendation) return '';

  return `## Recommendation

**${report.recommendation}**${
    report.recommendation === 'APPROVE WITH CONDITIONS'
      ? '\n\nConditions:\n' + report.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : ''
  }`;
}

function renderRecommendations(recommendations: string[]): string {
  if (recommendations.length === 0) {
    return `## Recommendations

No specific recommendations.`;
  }

  const items = recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n');

  return `## Recommendations

${items}`;
}

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
