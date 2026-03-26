import { describe, it, expect } from 'vitest';
import { renderMarkdownReport } from '../../src/report/templates.js';
import type { AuditReport } from '../../src/report/types.js';

describe('report templates', () => {
  const sampleReport: AuditReport = {
    summary: 'The agent processes invoices with excessive access to production systems.',
    agentPurpose: 'Invoice processing and CRM updates',
    dataNeeds: [
      { dataType: 'Invoices', system: 'SAP', justification: 'Read for processing' },
      { dataType: 'Contacts', system: 'HubSpot', justification: 'Match customers' },
    ],
    accessAssessment: {
      claimed: [
        { resource: 'SAP', accessLevel: 'full read', justification: 'Service account' },
        { resource: 'HubSpot', accessLevel: 'admin', justification: 'Admin API key' },
      ],
      actuallyNeeded: [
        { resource: 'SAP', accessLevel: 'read PO module', justification: 'Only needs POs' },
        { resource: 'HubSpot', accessLevel: 'read-write invoices', justification: 'Update status' },
      ],
      excessive: [
        { resource: 'SAP', accessLevel: 'full read', justification: 'Only needs PO module' },
        { resource: 'HubSpot', accessLevel: 'admin', justification: 'Only needs invoice object' },
      ],
      missing: [],
    },
    risks: [
      {
        severity: 'high',
        title: 'Excessive CRM access',
        description: 'Agent has admin access to all HubSpot objects',
      },
      {
        severity: 'medium',
        title: 'Broad ERP read',
        description: 'Agent reads all SAP modules, only needs Purchase Orders',
      },
    ],
    recommendations: [
      'Restrict HubSpot to Invoice and Contact objects only',
      'Limit SAP access to PO and Vendor Master modules',
    ],
    overallRiskLevel: 'high',
    transcript: [
      {
        question: 'What is your purpose?',
        answer: 'I process invoices',
        category: 'purpose',
      },
    ],
    metadata: {
      date: '2026-03-25',
      target: 'http://localhost:4444',
      interviewDuration: 30000,
      questionsAsked: 9,
    },
  };

  it('generates valid markdown with all sections', () => {
    const md = renderMarkdownReport(sampleReport);

    expect(md).toContain('# Agent Audit Report');
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('## Agent Purpose');
    expect(md).toContain('## Data Needs');
    expect(md).toContain('## Access Assessment');
    expect(md).toContain('## Risks');
    expect(md).toContain('## Recommendations');
    expect(md).toContain('## Interview Transcript');
  });

  it('includes risk level in header', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('HIGH');
  });

  it('renders data needs table', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('| Invoices | SAP |');
    expect(md).toContain('| Contacts | HubSpot |');
  });

  it('marks excessive access', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('Excessive');
  });

  it('lists risks by severity', () => {
    const md = renderMarkdownReport(sampleReport);
    // HIGH should appear before MEDIUM
    const highPos = md.indexOf('[HIGH]');
    const mediumPos = md.indexOf('[MEDIUM]');
    expect(highPos).toBeLessThan(mediumPos);
  });

  it('includes Heron attribution in footer', () => {
    const md = renderMarkdownReport(sampleReport);
    expect(md).toContain('Heron');
    expect(md).toContain('github.com/jonydony/Heron');
  });
});
