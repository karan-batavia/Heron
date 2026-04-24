import { describe, it, expect } from 'vitest';
import {
  isProvided,
  scrubUnprovided,
  renderFieldOrUnknown,
  UNKNOWN_PLACEHOLDER,
} from '../../src/util/provided.js';

describe('isProvided (AAP-43 P0 #2)', () => {
  it.each([
    ['NOT PROVIDED', false],
    ['NOT_PROVIDED', false],
    ['not provided', false],
    ['  not provided  ', false],
    ['N/A', false],
    ['Unknown', false],
    ['', false],
    [null, false],
    [undefined, false],
    ['Google Sheets', true],
    ['some real data', true],
    ['   actual content   ', true],
  ])('%s → %s', (input, expected) => {
    expect(isProvided(input as string | null | undefined)).toBe(expected);
  });
});

describe('scrubUnprovided', () => {
  it('returns undefined for sentinel', () => {
    expect(scrubUnprovided('NOT PROVIDED')).toBeUndefined();
    expect(scrubUnprovided('   n/a   ')).toBeUndefined();
  });
  it('trims and returns real values', () => {
    expect(scrubUnprovided('  hello  ')).toBe('hello');
  });
});

describe('renderFieldOrUnknown', () => {
  it('renders the placeholder for missing values', () => {
    expect(renderFieldOrUnknown('NOT PROVIDED')).toBe(UNKNOWN_PLACEHOLDER);
    expect(renderFieldOrUnknown(undefined)).toBe(UNKNOWN_PLACEHOLDER);
  });
  it('returns the value when present', () => {
    expect(renderFieldOrUnknown('real data')).toBe('real data');
  });
});
