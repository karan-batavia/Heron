import { describe, it, expect } from 'vitest';
import { MAPPING_VERSION } from '../../src/compliance/types.js';
import { renderStructuredCompliance } from '../../src/report/templates.js';
import type { StructuredCompliance } from '../../src/report/types.js';

const fakeCompliance: StructuredCompliance = {
  mappingVersion: MAPPING_VERSION,
  mandatory: {
    privacy: [
      {
        framework: 'GDPR',
        severity: 'action-required',
        description: 'Personal data processed without explicit consent basis.',
        controlIds: ['GDPR Art. 6', 'GDPR Art. 13'],
        category: 'privacy',
        tier: 'mandatory',
        mandatoryIn: ['EU', 'UK'],
      },
    ],
    ip: [],
    'consumer-protection': [],
    'sector-specific': [],
  },
  voluntary: {
    privacy: [
      {
        framework: 'NIST AI RMF',
        severity: 'warning',
        description: 'No documented data minimization procedure.',
        controlIds: ['GOVERN 1.1', 'MAP 1.6'],
        category: 'privacy',
        tier: 'voluntary',
        mandatoryIn: [],
      },
    ],
    ip: [],
    'consumer-protection': [],
    'sector-specific': [],
  },
  frameworksActivated: ['gdpr', 'nist-ai-rmf'],
  all: [],
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

  it('contains Mandatory Law section with H4 categories', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toMatch(/### Mandatory Law/);
    // Privacy category should be visible since the fixture has a GDPR flag there
    expect(md).toMatch(/#### Privacy/);
  });

  it('contains Voluntary Frameworks section', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toMatch(/### Voluntary Frameworks/);
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

  it('renders flag with controlIds and indicative mapping qualifier', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain('GDPR Art. 6');
    expect(md).toContain('*(indicative mapping)*');
  });

  it('emits fallback text when a tier has no flags', () => {
    const md = renderStructuredCompliance(emptyCompliance);
    expect(md).toMatch(/No mandatory obligations identified/);
    expect(md).toMatch(/No voluntary obligations identified/);
  });

  it('framework name appears in mandatory tier output', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain('**GDPR**');
  });

  it('voluntary framework name appears in voluntary tier output', () => {
    const md = renderStructuredCompliance(fakeCompliance);
    expect(md).toContain('**NIST AI RMF**');
  });
});
