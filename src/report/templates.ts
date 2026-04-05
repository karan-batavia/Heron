import type { AuditReport, QAPair, DataQuality, Risk, SystemAssessment, WriteOperation, RegulatoryCompliance, RegulatoryFlag } from './types.js';

export function renderMarkdownReport(report: AuditReport): string {
  const sections = [
    renderHeader(report),
    renderScopeAndMethodology(report),
    renderSummary(report),
    renderAgentProfile(report),
    renderFindings(report.risks),
    renderSystems(report.systems),
    renderPositiveFindings(report),
    renderVerdict(report),
    report.regulatoryCompliance ? renderRegulatoryCompliance(report.regulatoryCompliance) : null,
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

  // Regulatory one-liner
  let regLine = '';
  if (report.regulatoryCompliance) {
    const rc = report.regulatoryCompliance;
    const regParts: string[] = [];
    const summarizeJurisdiction = (flags: RegulatoryFlag[]): string => {
      if (flags.some(f => f.severity === 'action-required')) return 'Action Required';
      if (flags.some(f => f.severity === 'warning')) return 'Review';
      return 'Clear';
    };
    regParts.push(`EU: ${summarizeJurisdiction(rc.eu)}`);
    regParts.push(`US: ${summarizeJurisdiction(rc.us)}`);
    regParts.push(`UK: ${summarizeJurisdiction(rc.uk)}`);
    regLine = `\n**Regulatory**: ${regParts.join(' | ')}`;
  }

  return `# Agent Access Audit Report

**Generated**: ${report.metadata.date} | **Agent**: ${report.metadata.target} | **Risk Level**: ${report.overallRiskLevel.toUpperCase()} ${riskIcon}${dqPart}${regLine}`;
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
  // Dashboard: finding counts by severity
  const allRisks = report.risks;
  const countBySeverity = (sev: string) => allRisks.filter(r => r.severity === sev).length;
  const critical = countBySeverity('critical');
  const high = countBySeverity('high');
  const medium = countBySeverity('medium');
  const low = countBySeverity('low');

  // +1 for the standard "self-reported" finding (always medium)
  const findingsParts: string[] = [];
  if (critical > 0) findingsParts.push(`${critical} Critical`);
  if (high > 0) findingsParts.push(`${high} High`);
  findingsParts.push(`${medium + 1} Medium`); // +1 for standard finding
  if (low > 0) findingsParts.push(`${low} Low`);

  const systemCount = report.systems.filter(s => !/\bheron\b/i.test(s.systemId)).length;

  const dashboard = `| Risk | Systems | Findings |
|------|---------|----------|
| **${report.overallRiskLevel.toUpperCase()}** | ${systemCount} | ${findingsParts.join(', ')} |`;

  return `## Executive Summary

${dashboard}

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
  // Filter out Heron itself — agent sometimes reports the interview endpoint as a system
  const businessSystems = systems.filter(s => !/\bheron\b/i.test(s.systemId));

  if (businessSystems.length === 0) {
    return `## Systems & Access

No systems were identified in the interview.`;
  }

  const cards = businessSystems.map(renderSystemCard).join('\n\n');

  return `## Systems & Access

${cards}`;
}

function computeSystemRisk(sys: SystemAssessment): string {
  let score = 0;
  // Blast radius
  const brScores: Record<string, number> = { 'single-record': 0, 'single-user': 1, 'team-scope': 2, 'org-wide': 3, 'cross-tenant': 4 };
  score += brScores[sys.blastRadius] ?? 1;
  // Excessive scopes
  if (sys.scopesDelta.length > 0) score += 1;
  // Irreversible writes
  if (sys.writeOperations.some(w => !w.reversible)) score += 2;
  // Data sensitivity
  if (/pii|personal|health|financial|credit/i.test(sys.dataSensitivity)) score += 1;

  if (score >= 5) return 'HIGH';
  if (score >= 3) return 'MEDIUM';
  return 'LOW';
}

function renderSystemCard(sys: SystemAssessment): string {
  const rows: string[] = [];
  const risk = computeSystemRisk(sys);

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

  return `### ${sys.systemId} — Risk: ${risk}

| | |
|---|---|
${rows.join('\n')}`;
}

// ─── Findings ───────────────────────────────────────────────────────────────

function renderFindings(risks: Risk[]): string {
  // Standard findings that always appear in self-reported interviews
  const standardFindings: Risk[] = [
    {
      severity: 'medium',
      title: 'Self-reported evidence only',
      description: 'All data in this report is based on the agent\'s self-reported answers. Claims have not been verified against tool manifests, runtime behavior, or system configurations.',
      mitigation: 'Verify key claims (scopes, data access, write operations) against actual system configurations before granting production access.',
    },
  ];

  const allRisks = [...standardFindings, ...risks];

  const sorted = allRisks
    .sort((a, b) => severityOrder(b.severity) - severityOrder(a.severity));

  const rows = sorted.map((r, i) => {
    const id = `HERON-${String(i + 1).padStart(3, '0')}`;
    const remediation = r.mitigation ?? '—';
    return `| ${id} | ${r.severity.toUpperCase()} | ${r.title} | ${r.description} | ${remediation} |`;
  }).join('\n');

  return `## Findings

| ID | Severity | Finding | Description | Recommendation |
|----|----------|---------|-------------|----------------|
${rows}`;
}

// ─── Positive Findings ─────────────────────────────────────────────────────

function renderPositiveFindings(report: AuditReport): string {
  const positives: string[] = [];
  const systems = report.systems.filter(s => !/\bheron\b/i.test(s.systemId));

  // All writes reversible
  const allWrites = systems.flatMap(s => s.writeOperations);
  if (allWrites.length > 0 && allWrites.every(w => w.reversible)) {
    positives.push('All write operations are reversible');
  }

  // No excessive scopes
  const totalExcessive = systems.reduce((n, s) => n + s.scopesDelta.length, 0);
  if (totalExcessive === 0 && systems.length > 0) {
    positives.push('No excessive permissions detected — follows least-privilege principle');
  }

  // Limited blast radius
  if (systems.length > 0 && systems.every(s => s.blastRadius === 'single-user' || s.blastRadius === 'single-record')) {
    positives.push('Blast radius limited to single user/record');
  }

  // Approval required on writes
  if (allWrites.length > 0 && allWrites.some(w => w.approvalRequired)) {
    positives.push('Some write operations require approval before execution');
  }

  // Low frequency
  const freqText = systems.map(s => s.frequencyAndVolume).join(' ');
  if (/\b(1|2|once|twice)\b.*\b(week|month)\b/i.test(freqText)) {
    positives.push('Low execution frequency reduces operational risk');
  }

  // No decisions about people
  if (report.makesDecisionsAboutPeople === false) {
    positives.push('Does not make automated decisions about people');
  }

  if (positives.length === 0) return '';

  return `## What's Working Well

${positives.map(p => `- ✓ ${p}`).join('\n')}`;
}

// ─── Verdict (merged Recommendation + Recommendations) ───────────────────────

function renderVerdict(report: AuditReport): string {
  // Never allow bare APPROVE for self-reported interview — always at least "WITH CONDITIONS"
  let verdict = report.recommendation ?? 'APPROVE WITH CONDITIONS';
  if (verdict === 'APPROVE') {
    verdict = 'APPROVE WITH CONDITIONS';
  }
  const recs = report.recommendations;

  // Ensure standard condition is always present
  const standardCondition = 'Verify self-reported claims against actual system configurations before granting production access';
  const allRecs = recs.some(r => /verify.*self.reported|verify.*claim/i.test(r))
    ? recs
    : [standardCondition, ...recs];

  let body = `**${verdict}**`;

  if (allRecs.length > 0) {
    body += '\n\n' + allRecs.map((r, i) => `${i + 1}. ${r}`).join('\n');
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

// ─── Regulatory Compliance ──────────────────────────────────────────────────

function renderRegulatoryCompliance(compliance: RegulatoryCompliance): string {
  const renderFlags = (flags: RegulatoryFlag[]): string => {
    if (flags.length === 0) return 'No specific flags identified.';
    return flags.map(f => {
      const label = f.severity === 'action-required' ? ' `ACTION REQUIRED`' : f.severity === 'warning' ? ' `REVIEW`' : '';
      return `- **${f.framework}**${label}\n  ${f.description}`;
    }).join('\n\n');
  };

  return `## Regulatory Compliance

> This section highlights potential regulatory implications based on interview data. It is advisory — consult qualified legal counsel for compliance decisions.

### EU (EU AI Act + GDPR)

${renderFlags(compliance.eu)}

### US (SOC 2 + State AI Laws)

${renderFlags(compliance.us)}

### UK (UK GDPR + ICO Guidance)

${renderFlags(compliance.uk)}`;
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
