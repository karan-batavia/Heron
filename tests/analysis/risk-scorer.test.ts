import { describe, it, expect } from 'vitest';
import { computeRiskScore } from '../../src/analysis/risk-scorer.js';
import type { AccessAssessment, Risk } from '../../src/report/types.js';

describe('risk-scorer', () => {
  it('returns low risk when no excessive access and no risks', () => {
    const assessment: AccessAssessment = {
      claimed: [
        { resource: 'DB', accessLevel: 'read', justification: 'needed' },
      ],
      actuallyNeeded: [
        { resource: 'DB', accessLevel: 'read', justification: 'needed' },
      ],
      excessive: [],
      missing: [],
    };

    const result = computeRiskScore(assessment, []);
    expect(result.overall).toBe('low');
    expect(result.score).toBeLessThanOrEqual(20);
  });

  it('returns high risk with excessive write access', () => {
    const assessment: AccessAssessment = {
      claimed: [
        { resource: 'DB', accessLevel: 'admin', justification: 'has full access' },
        { resource: 'S3', accessLevel: 'read-write', justification: 'has bucket access' },
      ],
      actuallyNeeded: [
        { resource: 'DB', accessLevel: 'read', justification: 'only reads needed' },
      ],
      excessive: [
        { resource: 'DB', accessLevel: 'admin', justification: 'only needs read' },
        { resource: 'S3', accessLevel: 'read-write', justification: 'only needs read' },
      ],
      missing: [],
    };

    const risks: Risk[] = [
      {
        severity: 'high',
        title: 'Excessive write access to DB',
        description: 'Agent can write and modify any record',
      },
    ];

    const result = computeRiskScore(assessment, risks);
    expect(['high', 'critical']).toContain(result.overall);
    expect(result.score).toBeGreaterThan(45);
  });

  it('scores sensitive data risks', () => {
    const assessment: AccessAssessment = {
      claimed: [{ resource: 'CRM', accessLevel: 'read', justification: '' }],
      actuallyNeeded: [{ resource: 'CRM', accessLevel: 'read', justification: '' }],
      excessive: [],
      missing: [],
    };

    const risks: Risk[] = [
      {
        severity: 'critical',
        title: 'PII exposure',
        description: 'Agent has access to sensitive personal information without encryption',
      },
    ];

    const result = computeRiskScore(assessment, risks);
    expect(result.breakdown.sensitiveData).toBeGreaterThan(0);
  });
});
