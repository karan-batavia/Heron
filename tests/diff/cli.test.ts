import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDiffCommand } from '../../src/commands/diff.js';
import * as llmModule from '../../src/llm/client.js';

const CANNED_DIFF = `# Report Comparison

**Old:** sess_old (2026-04-10, MEDIUM)
**New:** sess_new (2026-04-22, LOW) — improved

## Summary

| Resolved | Added | Severity changes | Systems +/− |
|----------|-------|------------------|-------------|
|    1     |   0   |        1         |    +1 / 0   |

## Resolved

- Local HTTP worker has no built-in authentication — fixed

## Added

_(none)_

## Severity changes

- Broad write access to Google Sheets queue: HIGH → MEDIUM

## Systems

### Added
- Notion

### Removed
_(none)_

### Scopes changed
- Google Sheets: removed spreadsheets.readonly
`;

describe('runDiffCommand', () => {
  let tempDir: string;
  const oldFixture = join(process.cwd(), 'tests/diff/fixtures/report-old.md');
  const newFixture = join(process.cwd(), 'tests/diff/fixtures/report-new.md');

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'heron-diff-test-'));
    vi.spyOn(llmModule, 'createLLMClient').mockResolvedValue({
      chat: vi.fn().mockResolvedValue(CANNED_DIFF),
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes diff to default path in reportDir', async () => {
    await runDiffCommand({
      oldPath: oldFixture,
      newPath: newFixture,
      reportDir: tempDir,
      llmKey: 'sk-ant-fake',
    });

    const expectedPath = join(tempDir, 'diff-report-old-report-new.md');
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath, 'utf-8')).toBe(CANNED_DIFF.trim());
    expect(llmModule.createLLMClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-ant-fake' }),
    );
  });

  it('respects explicit -o output path', async () => {
    const outputPath = join(tempDir, 'my-custom.md');
    await runDiffCommand({
      oldPath: oldFixture,
      newPath: newFixture,
      outputPath,
      llmKey: 'sk-ant-fake',
    });

    expect(existsSync(outputPath)).toBe(true);
    expect(readFileSync(outputPath, 'utf-8')).toBe(CANNED_DIFF.trim());
  });

  it('throws a clear error when the old file is missing', async () => {
    await expect(
      runDiffCommand({
        oldPath: join(tempDir, 'does-not-exist.md'),
        newPath: newFixture,
        reportDir: tempDir,
        llmKey: 'sk-ant-fake',
      }),
    ).rejects.toThrow(/file not found/i);
  });

  it('throws a clear error when the new file is missing', async () => {
    await expect(
      runDiffCommand({
        oldPath: oldFixture,
        newPath: join(tempDir, 'does-not-exist.md'),
        reportDir: tempDir,
        llmKey: 'sk-ant-fake',
      }),
    ).rejects.toThrow(/file not found/i);
  });
});
