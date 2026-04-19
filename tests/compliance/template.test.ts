import { describe, it, expect } from 'vitest';
import { MAPPING_VERSION } from '../../src/compliance/types.js';
import { renderStructuredCompliance } from '../../src/report/templates.js';
import type { StructuredCompliance } from '../../src/report/types.js';

const gdprFlag = {
  framework: 'GDPR',
  severity: 'action-required' as const,
  description: 'Personal data processed without explicit consent basis.',
  controlIds: ['Art. 6', 'Art. 13'],
  category: 'privacy' as const,
  tier: 'mandatory' as const,
  mandatoryIn: ['EU', 'UK'],
  frameworkId: 'gdpr',
  triggeredBy: 'sensitive-data',
};

const nistFlag = {
  framework: 'NIST AI RMF',
  severity: 'warning' as const,
  description: 'No documented data minimization procedure.',
  controlIds: ['GOVERN 1.1', 'MAP 1.6'],
  category: 'privacy' as const,
  tier: 'voluntary' as const,
  mandatoryIn: [] as string[],
  frameworkId: 'nist-ai-rmf',
  triggeredBy: 'sensitive-data',
};

const fakeCompliance: StructuredCompliance = {
  mappingVersion: MAPPING_VERSION,
  mandatory: {
    privacy: [gdprFlag],
    ip: [],
    'consumer-protection': [],
    'sector-specific': [],
  },
  voluntary: {
    privacy: [nistFlag],
    ip: [],
    'consumer-protection': [],
    'sector-specific': [],
  },
  frameworksActivated: ['gdpr', 'nist-ai-rmf'],
  all: [gdprFlag, nistFlag],
};

const emptyCompliance: StructuredCompliance = {
  mappingVersion: MAPPING_VERSION,
  mandatory: {
    privacy: [],
    ip: [],
    'consumer-protection': [],
    'sector-specific': [],
  },
  voluntary: {
    privacy: [],
    ip: [],
    'consumer-protection': [],
    'sector-specific': [],
  },
  frameworksActivated: [],
  all: [],
};

describe('Template — AAP-31 structured compliance', () => {
  it('contains Methodology section', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toMatch(/## Regulatory Compliance[\s\S]*### Methodology/);
  });

  it('contains finding-first Compliance Detail section', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toMatch(/### Compliance Detail/);
    // Should show gap labels as H4 headings, not framework names
    expect(md).toMatch(/#### (Excessive permissions|Data handling|Write operation risks|Automated decision-making)/);
  });

  it('shows Affects line with grouped framework controls', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain('**Affects:**');
    // Should contain at least one framework reference
    expect(md).toMatch(/GDPR|EU AI Act|NIST|SOC 2/);
  });

  it('does NOT contain Jurisdictional Appendix or EU/US/UK H3s', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).not.toMatch(/Jurisdictional Appendix/i);
    expect(md).not.toMatch(/^### EU\s*$/m);
    expect(md).not.toMatch(/^### US\s*$/m);
    expect(md).not.toMatch(/^### UK\s*$/m);
  });

  it('Methodology includes MAPPING_VERSION', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain(MAPPING_VERSION);
  });

  it('references framework controls in Affects line (indicative note in Methodology only)', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    // Controls show in "Affects:" line, grouped by framework
    expect(md).toMatch(/GDPR \(Art\. 6/);
    // indicative mapping disclaimer lives in Methodology, not per-line
    expect(md).toContain('Control mappings are indicative');
  });

  it('renders Applicability Summary table with mandatory and voluntary sections', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain('### Applicability Summary');
    expect(md).toContain('| Framework | Status | Gaps Found |');
    expect(md).toContain('**Mandatory Law**');
    expect(md).toContain('**Voluntary Frameworks**');
  });

  it('emits fallback text when no compliance gaps exist', () => {
    const md = renderStructuredCompliance(emptyCompliance);
    expect(md).toMatch(/No compliance gaps identified/);
  });

  it('framework name appears in Affects line', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain('GDPR');
  });

  it('NIST appears in Affects line or summary table', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain('NIST');
  });
});
