import { describe, it, expect } from 'vitest';
import { renderMarkdownReport } from '../../src/report/templates.js';
import type { AuditReport, SystemAssessment } from '../../src/report/types.js';

const sampleSystem: SystemAssessment = {
  systemId: 'HubSpot CRM, REST API via OAuth2',
  scopesRequested: ['crm.objects.contacts.read', 'crm.objects.contacts.write', 'crm.objects.deals.read', 'crm.objects.deals.write'],
  scopesNeeded: ['crm.objects.contacts.read', 'crm.objects.deals.read'],
  scopesDelta: ['crm.objects.contacts.write', 'crm.objects.deals.write'],
  dataSensitivity: 'PII — customer names, email addresses, phone numbers',
  blastRadius: 'org-wide',
  frequencyAndVolume: '~150 CRM updates/day, batch of 1',
  writeOperations: [
    {
      operation: 'Update invoice status',
      target: 'Invoice records in CRM',
      reversible: true,
      approvalRequired: false,
      volumePerDay: '~150/day',
    },
  ],
};

const sampleReport: AuditReport = {
  summary: 'The agent processes invoices with excessive access to production systems.',
  agentPurpose: 'Invoice processing and CRM updates',
  agentTrigger: 'New invoice arrives in S3 bucket',
  agentOwner: 'Finance Operations team',
  systems: [sampleSystem],
  dataNeeds: [
    { dataType: 'Invoices', system: 'SAP', justification: 'Read for processing' },
  ],
  accessAssessment: {
    claimed: [
      { resource: 'HubSpot CRM', accessLevel: 'crm.objects.contacts.write', justification: 'Requested by agent' },
    ],
    actuallyNeeded: [
      { resource: 'HubSpot CRM', accessLevel: 'crm.objects.contacts.read', justification: 'Minimum needed' },
    ],
    excessive: [
      { resource: 'HubSpot CRM', accessLevel: 'crm.objects.contacts.write', justification: 'Write not needed' },
    ],
    missing: [],
  },
  risks: [
    {
      severity: 'high',
      title: 'Excessive CRM write access',
      description: 'Agent has write access to all CRM objects',
      mitigation: 'Restrict to read-only for contacts',
    },
    {
      severity: 'medium',
      title: 'Broad ERP read',
      description: 'Agent reads all SAP modules, only needs POs',
    },
  ],
  recommendations: [
    'Restrict HubSpot to read-only for contacts and deals',
    'Limit SAP access to PO module only',
  ],
  recommendation: 'APPROVE WITH CONDITIONS',
  overallRiskLevel: 'high',
  transcript: [
    { question: 'What is your purpose?', answer: 'I process invoices', category: 'purpose' },
  ],
  metadata: {
    date: '2026-03-30',
    target: 'http://localhost:4444',
    interviewDuration: 30000,
    questionsAsked: 9,
  },
};

describe('report templates', () => {
  it('generates valid markdown with all new sections', () => {
    const md = renderMarkdownReport(sampleReport);

    expect(md).toContain('# Agent Access Audit Report');
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('## Agent Profile');
    expect(md).toContain('## Systems & Permissions');
    expect(md).toContain('## Write Operations');
    expect(md).toContain('## Risk Assessment');
    expect(md).toContain('## Permissions Delta');
    expect(md).toContain('## Recommendation');
    expect(md).toContain('## Recommendations');
    expect(md).toContain('## Interview Transcript');
  });

  it('includes risk level in header', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('HIGH');
  });

  it('renders per-system compliance table with scopes', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('HubSpot CRM, REST API via OAuth2');
    expect(md).toContain('crm.objects.contacts.read');
    expect(md).toContain('crm.objects.contacts.write');
  });

  it('renders blast radius per system', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('org-wide');
  });

  it('renders data sensitivity per system', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('PII');
  });

  it('renders write operations table', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('Update invoice status');
    expect(md).toContain('Yes'); // reversible
  });

  it('renders permissions delta section', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('## Permissions Delta');
    expect(md).toContain('Excessive');
  });

  it('renders recommendation verdict', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('APPROVE WITH CONDITIONS');
  });

  it('renders risks sorted by severity', () => {
    const md = renderMarkdownReport(sampleReport);
    const highPos = md.indexOf('HIGH');
    const mediumPos = md.indexOf('MEDIUM');
    // HIGH should appear in the risk table before MEDIUM
    expect(highPos).toBeLessThan(mediumPos);
  });

  it('renders agent profile with trigger and owner', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('New invoice arrives in S3 bucket');
    expect(md).toContain('Finance Operations team');
  });

  it('includes self-report disclaimer in footer', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('self-report');
    expect(md).toContain('advisory');
  });

  it('includes Heron attribution in footer', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('Heron');
    expect(md).toContain('github.com/jonydony/Heron');
  });

  it('handles empty systems gracefully', () => {
    const emptyReport: AuditReport = {
      ...sampleReport,
      systems: [],
    };
    const md = renderMarkdownReport(emptyReport);
    expect(md).toContain('No systems were identified');
  });

  it('handles empty write operations', () => {
    const noWritesReport: AuditReport = {
      ...sampleReport,
      systems: [{
        ...sampleSystem,
        writeOperations: [],
      }],
    };
    const md = renderMarkdownReport(noWritesReport);
    expect(md).toContain('No write operations');
  });
});
