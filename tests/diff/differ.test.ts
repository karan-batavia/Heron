import { describe, it, expect, vi } from 'vitest';
import { diffReports } from '../../src/diff/differ.js';
import type { LLMClient } from '../../src/llm/client.js';

const VALID_DIFF_MARKDOWN = `# Report Comparison

**Old:** sess_old (2026-04-10, MEDIUM)
**New:** sess_new (2026-04-22, LOW) — improved

## Summary

| Resolved | Added | Severity changes | Systems +/− |
|----------|-------|------------------|-------------|
|    1     |   0   |        1         |    +1 / 0   |

Overall: improved.

## Resolved

- **[HIGH] Local HTTP worker has no built-in authentication** — no longer present.

## Added

_(none)_

## Severity changes

- **Broad write access to Google Sheets queue**: HIGH → MEDIUM.

## Systems

### Added
- Notion → REST API → API key

### Removed
_(none)_

### Scopes changed
- Google Sheets: removed \`spreadsheets.readonly\`.
`;

describe('diffReports', () => {
  it('returns LLM output as-is when it passes sanity check', async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue(VALID_DIFF_MARKDOWN),
    };

    const result = await diffReports('OLD REPORT TEXT', 'NEW REPORT TEXT', mockLLM);

    expect(result).toBe(VALID_DIFF_MARKDOWN.trim());
    expect(mockLLM.chat).toHaveBeenCalledTimes(1);
  });

  it('strips markdown code fences from LLM response', async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue('```markdown\n' + VALID_DIFF_MARKDOWN + '\n```'),
    };

    const result = await diffReports('OLD', 'NEW', mockLLM);
    expect(result).toBe(VALID_DIFF_MARKDOWN.trim());
  });

  it('retries once when the first response fails the sanity check', async () => {
    let call = 0;
    const mockLLM: LLMClient = {
      chat: vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) return ''; // empty response fails sanity check
        return VALID_DIFF_MARKDOWN;
      }),
    };

    const result = await diffReports('OLD', 'NEW', mockLLM);
    expect(call).toBe(2);
    expect(result).toContain('## Summary');
  });

  it('retries when response lacks expected headings', async () => {
    let call = 0;
    const mockLLM: LLMClient = {
      chat: vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) return 'I am sorry, I cannot do this.';
        return VALID_DIFF_MARKDOWN;
      }),
    };

    const result = await diffReports('OLD', 'NEW', mockLLM);
    expect(call).toBe(2);
    expect(result).toContain('## Resolved');
  });

  it('throws after double failure (no silent fallback)', async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue('nope, not doing it'),
    };

    await expect(diffReports('OLD', 'NEW', mockLLM)).rejects.toThrow(
      /Diff generation failed/i,
    );
    expect(mockLLM.chat).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown LLM error as a failed attempt and retries', async () => {
    let call = 0;
    const mockLLM: LLMClient = {
      chat: vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) throw new Error('network blip');
        return VALID_DIFF_MARKDOWN;
      }),
    };

    const result = await diffReports('OLD', 'NEW', mockLLM);
    expect(call).toBe(2);
    expect(result).toContain('## Summary');
  });

  it('passes the diff prompt to the LLM (old and new report texts both included)', async () => {
    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue(VALID_DIFF_MARKDOWN),
    };

    await diffReports('MY_OLD_MARKER', 'MY_NEW_MARKER', mockLLM);

    const [systemPrompt, userPrompt] = (mockLLM.chat as any).mock.calls[0];
    expect(systemPrompt).toMatch(/compare two AI-agent audit reports/i);
    expect(userPrompt).toContain('MY_OLD_MARKER');
    expect(userPrompt).toContain('MY_NEW_MARKER');
  });
});
