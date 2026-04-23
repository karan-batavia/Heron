# Report Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `heron diff old.md new.md` CLI subcommand and a web upload flow on the session page that compares two Heron audit reports via one LLM call and saves the diff to disk.

**Architecture:** The LLM produces the final markdown diff directly — no intermediate JSON, no Zod schema, no render layer. A single function `diffReports(oldMd, newMd, llmClient)` lives in `src/diff/differ.ts` and is called by both the CLI handler (`src/commands/diff.ts`) and the server upload endpoint (`POST /api/sessions/:id/compare`). Diffs are persisted as regular markdown files in `reportDir`; the landing page surfaces them via a `Compare` column by checking file existence.

**Tech Stack:** TypeScript, Node 20+, commander, vitest, existing `LLMClient` (`src/llm/client.ts`), existing server (Node `http`), existing `markdownToHtml` helper.

**Spec:** `docs/superpowers/specs/2026-04-23-report-comparison-design.md` (commit `855a083`)

---

## File structure

### New files

- `src/diff/differ.ts` — core `diffReports(oldMd, newMd, llmClient)` function, sanity check, retry.
- `src/commands/diff.ts` — CLI command handler: reads files, creates LLM client, calls `diffReports`, saves to disk, prints summary.
- `tests/diff/differ.test.ts` — unit tests for differ with a mocked `LLMClient`.
- `tests/diff/cli.test.ts` — integration test that runs the CLI through an in-process handler with a mocked LLM.
- `tests/diff/fixtures/report-old.md` — a handcrafted short Heron-style audit report (the "older" one).
- `tests/diff/fixtures/report-new.md` — a handcrafted short Heron-style audit report (the "newer" one, same agent).
- `tests/server/compare.test.ts` — endpoint + page tests.

### Modified files

- `src/llm/prompts.ts` — append `DIFF_SYSTEM_PROMPT` constant and `buildDiffPrompt(old, new)` function.
- `bin/heron.ts` — register `diff` subcommand; add `'diff'` to the `hasSubcommand` allow-list.
- `src/server/sessions.ts` — add methods `compareWithUpload`, `hasDiff`, `getDiffContent` on `SessionManager`; add `import { diffReports }` and fs helpers.
- `src/server/index.ts` — add `POST /api/sessions/:id/compare` handler, `GET /sessions/:id/compare` page handler, upload block on the session page, `Compare` column on the landing page, `hasDiff` field on `/api/sessions` JSON response.

---

## Task 1: Add diff prompt constants to `src/llm/prompts.ts`

**Files:**
- Modify: `src/llm/prompts.ts` (append at end of file)

- [ ] **Step 1: Append prompt constant and builder**

Append at the end of `src/llm/prompts.ts`:

```ts

// ─── Diff (AAP-32) ──────────────────────────────────────────────────────────

export const DIFF_SYSTEM_PROMPT = `You compare two AI-agent audit reports and return a markdown diff. Preserve exact finding titles from the inputs. Only report changes you can justify from the text — don't invent findings. Produce well-structured markdown with clear section headings.`;

export function buildDiffPrompt(oldReport: string, newReport: string): string {
  return `Compare these two audit reports for the same AI agent and return a markdown diff describing what changed.

=== OLD REPORT ===
${oldReport}

=== NEW REPORT ===
${newReport}

Your output must be markdown with exactly these top-level sections (use \`##\` headings):
- Summary (a one-row table: Resolved | Added | Severity changes | Systems +/−, plus a line stating the overall risk direction: improved / worsened / unchanged)
- Resolved (bullet list of findings from OLD that are no longer in NEW; include severity)
- Added (bullet list of findings in NEW that weren't in OLD; include severity)
- Severity changes (bullet list of findings that appear in both but with different severity)
- Systems (subsections: Added / Removed / Scopes changed)

Rules:
- A finding is "resolved" if it's in OLD and the NEW report clearly doesn't contain an equivalent issue.
- A finding is "added" if it's in NEW and wasn't in OLD.
- "Severity changes" means the same semantic finding appears in both with a different severity level. Do NOT list it in both Resolved and Added.
- Use the exact finding titles from the source reports (don't paraphrase).
- If a section has nothing to report, still include the heading with "_(none)_".
- Start the output with a short header block naming both reports (dates and overall risk).`;
}
```

- [ ] **Step 2: Verify the file still compiles**

Run: `npm run lint`
Expected: PASS (no TS errors). If this fails, check that the appended block is at the end of the file and doesn't conflict with existing exports.

- [ ] **Step 3: Commit**

```bash
git add src/llm/prompts.ts
git commit -m "feat(diff): add DIFF_SYSTEM_PROMPT and buildDiffPrompt (AAP-32)"
```

---

## Task 2: Create test fixture reports

**Files:**
- Create: `tests/diff/fixtures/report-old.md`
- Create: `tests/diff/fixtures/report-new.md`

These are realistic-looking small Heron reports. They're NOT used by the differ itself (the differ takes any string); they give us stable inputs for the CLI test. Content is intentionally brief.

- [ ] **Step 1: Create `tests/diff/fixtures/report-old.md`**

```markdown
# Agent Access Audit Report

**Generated**: 2026-04-10 | **Agent**: session:sess_old_abc | **Risk Level**: MEDIUM

---

## Executive Summary

| Risk | Systems | Findings |
|------|---------|----------|
| **MEDIUM** | 2 | 2 High |

Agent processes lesson content and uploads to Wellkid.

---

## Findings

| ID | Severity | Finding | Description | Recommendation |
|----|----------|---------|-------------|----------------|
| HERON-001 | HIGH | Broad write access to Google Sheets queue | The agent can write status, dates, and links to any row. | Reduce to single-row scope. |
| HERON-002 | HIGH | Local HTTP worker has no built-in authentication | FastAPI worker exposes endpoints with no auth. | Bind to localhost and add auth. |

---

## Systems & Access

### Google Sheets → Google Sheets API → OAuth2 — Risk: MEDIUM

| | |
|---|---|
| **Scopes granted** | https://www.googleapis.com/auth/spreadsheets, https://www.googleapis.com/auth/spreadsheets.readonly |
| **Blast radius** | team-scope |

### Local content worker → local HTTP API → no auth — Risk: HIGH

| | |
|---|---|
| **Blast radius** | single-record |
```

- [ ] **Step 2: Create `tests/diff/fixtures/report-new.md`**

```markdown
# Agent Access Audit Report

**Generated**: 2026-04-22 | **Agent**: session:sess_new_xyz | **Risk Level**: LOW

---

## Executive Summary

| Risk | Systems | Findings |
|------|---------|----------|
| **LOW** | 3 | 1 Medium |

Agent processes lesson content and uploads to Wellkid. Auth added to local worker.

---

## Findings

| ID | Severity | Finding | Description | Recommendation |
|----|----------|---------|-------------|----------------|
| HERON-001 | MEDIUM | Broad write access to Google Sheets queue | The agent can write status, dates, and links to any row. | Reduce to single-row scope. |

---

## Systems & Access

### Google Sheets → Google Sheets API → OAuth2 — Risk: LOW

| | |
|---|---|
| **Scopes granted** | https://www.googleapis.com/auth/spreadsheets |
| **Blast radius** | single-record |

### Local content worker → local HTTP API → Bearer token — Risk: LOW

| | |
|---|---|
| **Blast radius** | single-record |

### Notion → REST API → API key — Risk: LOW

| | |
|---|---|
| **Blast radius** | single-user |
```

- [ ] **Step 3: Commit**

```bash
git add tests/diff/fixtures/report-old.md tests/diff/fixtures/report-new.md
git commit -m "test(diff): add fixture reports for diff tests (AAP-32)"
```

---

## Task 3: Implement `diffReports` with failing tests first

**Files:**
- Create: `src/diff/differ.ts`
- Create: `tests/diff/differ.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/diff/differ.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/diff/differ.test.ts`
Expected: FAIL — cannot find module `../../src/diff/differ.js`. All 7 test cases fail with resolution error. Good.

- [ ] **Step 3: Create the `src/diff/differ.ts` implementation**

Create `src/diff/differ.ts`:

```ts
import type { LLMClient } from '../llm/client.js';
import { DIFF_SYSTEM_PROMPT, buildDiffPrompt } from '../llm/prompts.js';
import * as logger from '../util/logger.js';

/** Headings that a well-formed diff must contain at least one of. */
const EXPECTED_HEADINGS = ['## Summary', '## Resolved', '## Added'];

/**
 * Compare two Heron audit reports (markdown) via one LLM call and return the
 * LLM's markdown diff. Retries once on sanity-check failure or thrown error.
 * Throws after double failure — no silent fallback (matches `analyzer.ts`
 * behavior rationale for a user-facing operation).
 */
export async function diffReports(
  oldReport: string,
  newReport: string,
  llmClient: LLMClient,
): Promise<string> {
  const userPrompt = buildDiffPrompt(oldReport, newReport);

  // Attempt 1
  let result = await tryDiff(llmClient, userPrompt);

  // Attempt 2 (retry) if first failed
  if (!result) {
    logger.warn('First diff attempt failed sanity check, retrying...');
    result = await tryDiff(llmClient, userPrompt);
  }

  if (!result) {
    throw new Error(
      'Diff generation failed: the LLM did not return well-formed diff markdown after two attempts. ' +
        'The reports may be empty, non-Heron, or the LLM is misbehaving.',
    );
  }

  return result;
}

async function tryDiff(llmClient: LLMClient, userPrompt: string): Promise<string | null> {
  try {
    const response = await llmClient.chat(DIFF_SYSTEM_PROMPT, userPrompt);
    const stripped = stripFences(response);
    if (!passesSanityCheck(stripped)) return null;
    return stripped;
  } catch (e) {
    logger.warn(`Diff attempt failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Strip surrounding ``` or ```markdown fences, trim whitespace. */
function stripFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:markdown|md)?\n?/, '').replace(/\n?```$/, '');
  }
  return t.trim();
}

function passesSanityCheck(text: string): boolean {
  if (!text) return false;
  return EXPECTED_HEADINGS.some((h) => text.includes(h));
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- tests/diff/differ.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/diff/differ.ts tests/diff/differ.test.ts
git commit -m "feat(diff): implement diffReports with LLM-based comparison (AAP-32)"
```

---

## Task 4: CLI command `heron diff`

**Files:**
- Create: `src/commands/diff.ts`
- Modify: `bin/heron.ts`
- Create: `tests/diff/cli.test.ts`

### 4a: Write the failing CLI integration test

- [ ] **Step 1: Write the failing test**

Create `tests/diff/cli.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/diff/cli.test.ts`
Expected: FAIL — cannot find module `../../src/commands/diff.js`.

### 4b: Implement the CLI handler

- [ ] **Step 3: Create `src/commands/diff.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createLLMClient } from '../llm/client.js';
import { diffReports } from '../diff/differ.js';
import type { LLMConfig } from '../config/schema.js';
import * as logger from '../util/logger.js';

export interface DiffCommandOptions {
  oldPath: string;
  newPath: string;
  /** -o flag. If set, diff is written here. */
  outputPath?: string;
  /** --report-dir flag. Defaults to ./reports. Ignored if outputPath is set. */
  reportDir?: string;
  llmProvider?: string;
  llmModel?: string;
  llmKey?: string;
}

/**
 * CLI handler for `heron diff <old> <new>`. Reads both reports, generates a
 * markdown diff via the LLM, writes it to disk, and prints a short summary.
 */
export async function runDiffCommand(opts: DiffCommandOptions): Promise<void> {
  // 1. Check both input files exist.
  if (!existsSync(opts.oldPath)) {
    throw new Error(`file not found: ${opts.oldPath}`);
  }
  if (!existsSync(opts.newPath)) {
    throw new Error(`file not found: ${opts.newPath}`);
  }

  // 2. Read both reports.
  const oldReport = readFileSync(opts.oldPath, 'utf-8');
  const newReport = readFileSync(opts.newPath, 'utf-8');

  // 3. Extract metadata from report headers for stdout summary.
  const oldMeta = extractReportMeta(oldReport);
  const newMeta = extractReportMeta(newReport);

  // 4. Decide save path.
  const reportDir = opts.reportDir ?? './reports';
  const defaultName = `diff-${stripMdExt(basename(opts.oldPath))}-${stripMdExt(basename(opts.newPath))}.md`;
  const savePath = opts.outputPath ?? `${reportDir}/${defaultName}`;

  // 5. Create LLM client (same flow as `scan`).
  const llmConfig: LLMConfig = {
    provider: (opts.llmProvider as 'anthropic' | 'openai' | 'gemini') ?? 'anthropic',
    model: opts.llmModel,
    apiKey: opts.llmKey,
  };
  const llmClient = await createLLMClient(llmConfig);

  // 6. Run the diff.
  logger.raw('');
  logger.raw(`  \x1b[1mHeron Report Diff\x1b[0m`);
  logger.raw('');
  logger.raw(`  \x1b[33m⏳ Comparing reports...\x1b[0m`);
  const diff = await diffReports(oldReport, newReport, llmClient);

  // 7. Write to disk (mkdirp the directory).
  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(savePath, diff, 'utf-8');

  // 8. Print the summary.
  logger.raw('');
  logger.raw(`  Old:   ${opts.oldPath}  (${oldMeta.date}, ${oldMeta.risk})`);
  logger.raw(`  New:   ${opts.newPath}  (${newMeta.date}, ${newMeta.risk})`);
  logger.raw(`  Diff:  ${savePath}`);
  logger.raw('');
}

interface ReportMeta {
  date: string;
  risk: string;
}

/** Extract `**Generated**: <date>` and `**Risk Level**: <level>` from a Heron report header. */
function extractReportMeta(report: string): ReportMeta {
  const dateMatch = report.match(/\*\*Generated\*\*:\s*([^\s|]+)/);
  const riskMatch = report.match(/\*\*Risk Level\*\*:\s*(\w+)/i);
  return {
    date: dateMatch?.[1] ?? 'unknown',
    risk: riskMatch?.[1]?.toUpperCase() ?? 'unknown',
  };
}

function stripMdExt(name: string): string {
  return name.replace(/\.md$/i, '');
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test -- tests/diff/cli.test.ts`
Expected: PASS — all 4 tests green. The file-not-found tests should hit the existsSync checks before reaching the mocked LLM.

### 4c: Register the `diff` subcommand

- [ ] **Step 5: Modify `bin/heron.ts` — register `diff` subcommand**

In `bin/heron.ts`, find the `install-skill` registration block (starts with `// ─── install-skill: install Claude Code skill ───`). **Immediately before** it, insert:

```ts
// ─── diff: compare two audit reports ────────────────────────────────────

program
  .command('diff')
  .description('Compare two Heron audit reports and produce a markdown delta')
  .argument('<old>', 'Path to the older report markdown')
  .argument('<new>', 'Path to the newer report markdown')
  .option('--llm-provider <provider>', 'LLM provider: anthropic, openai, or gemini (auto-detected from key)')
  .option('--llm-model <model>', 'LLM model (auto-selected per provider)')
  .option('--llm-key <key>', 'LLM API key (or set HERON_LLM_API_KEY)')
  .option('-o, --output <path>', 'Save diff to this path (overrides default)')
  .option('--report-dir <dir>', 'Directory to save diff when -o not used', './reports')
  .action(async (oldPath: string, newPath: string, opts) => {
    try {
      const { runDiffCommand } = await import('../src/commands/diff.js');
      await runDiffCommand({
        oldPath,
        newPath,
        outputPath: opts.output,
        reportDir: opts.reportDir,
        llmProvider: opts.llmProvider,
        llmModel: opts.llmModel,
        llmKey: opts.llmKey,
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });
```

- [ ] **Step 6: Add `'diff'` to the `hasSubcommand` allow-list**

Find this line in `bin/heron.ts`:

```ts
const hasSubcommand = args.length > 0 && ['scan', 'serve', 'install-skill', 'help', '--help', '-h', '--version', '-V'].includes(args[0]);
```

Replace with:

```ts
const hasSubcommand = args.length > 0 && ['scan', 'serve', 'install-skill', 'diff', 'help', '--help', '-h', '--version', '-V'].includes(args[0]);
```

- [ ] **Step 7: Smoke-test the CLI wiring**

Run: `npm run dev -- diff --help`
Expected: commander prints the `diff` command's help with `<old>`, `<new>`, and the options described above.

- [ ] **Step 8: Commit**

```bash
git add src/commands/diff.ts tests/diff/cli.test.ts bin/heron.ts
git commit -m "feat(cli): add \`heron diff\` subcommand (AAP-32)"
```

---

## Task 5: `SessionManager` — add diff methods

We add three small methods on `SessionManager`:
- `compareWithUpload(sessionId, uploadedMd)` — runs the diff, writes file, returns the markdown.
- `hasDiff(sessionId)` — `fs.existsSync` check, used by the landing page.
- `getDiffContent(sessionId)` — reads the diff file, used by the compare page.

**Files:**
- Modify: `src/server/sessions.ts`

- [ ] **Step 1: Add imports**

At the top of `src/server/sessions.ts`, near the existing imports, add:

```ts
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { diffReports } from '../diff/differ.js';
```

- [ ] **Step 2: Add the three methods to `SessionManager`**

Inside the `SessionManager` class (place them after `listSessions()` and before the `private getNextQuestion` block):

```ts
  /**
   * Diff an uploaded markdown report against this session's current report.
   * Writes `${reportDir}/${sessionId}-diff.md` and returns the diff markdown.
   * Overwrites any previous diff for this session.
   */
  async compareWithUpload(sessionId: string, uploadedMd: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.status !== 'complete' || !session.report) {
      throw new Error(
        `Session ${sessionId} has no report yet (status: ${session.status})`,
      );
    }
    if (!this.reportDir) {
      throw new Error('Server has no reportDir configured; cannot save diff');
    }

    const diff = await diffReports(uploadedMd, session.report, this.llmClient);

    mkdirSync(this.reportDir, { recursive: true });
    const diffPath = `${this.reportDir}/${sessionId}-diff.md`;
    writeFileSync(diffPath, diff, 'utf-8');

    return diff;
  }

  /** Cheap existence check used by landing page + session page. */
  hasDiff(sessionId: string): boolean {
    if (!this.reportDir) return false;
    return existsSync(`${this.reportDir}/${sessionId}-diff.md`);
  }

  /** Read the saved diff markdown for a session, or null if none. */
  getDiffContent(sessionId: string): string | null {
    if (!this.reportDir) return null;
    const path = `${this.reportDir}/${sessionId}-diff.md`;
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8');
  }
```

- [ ] **Step 3: Verify type-check passes**

Run: `npm run lint`
Expected: PASS. If TypeScript complains about `this.llmClient` being private but accessed by a new method, that's fine because we're inside the same class.

- [ ] **Step 4: Commit**

```bash
git add src/server/sessions.ts
git commit -m "feat(server): SessionManager.compareWithUpload + hasDiff + getDiffContent (AAP-32)"
```

---

## Task 6: Server endpoints — POST compare + GET compare page

**Files:**
- Modify: `src/server/index.ts` (refactor `startServer` to return the `http.Server`, add the two new handlers)
- Create: `tests/server/compare.test.ts`

### 6a: Refactor `startServer` to return the server instance

Tests need to `close()` the server between runs. Today `startServer` returns `Promise<void>` and the `http.Server` is trapped inside the function. Widen the return type — callers who ignore it (e.g. `bin/heron.ts`) are unaffected.

- [ ] **Step 1: Change `startServer` return type and resolve with the server**

In `src/server/index.ts`, find:

```ts
export async function startServer(config: ServerConfig): Promise<void> {
```

Replace with:

```ts
export async function startServer(config: ServerConfig): Promise<import('node:http').Server> {
```

Then find the `server.listen(config.port, config.host, () => {` block at the bottom. Wrap it in a Promise that resolves with the server once listening:

Before:
```ts
  server.listen(config.port, config.host, () => {
    const baseUrl = `http://localhost:${config.port}`;
    logger.raw('');
    logger.raw(`  \x1b[1mHeron Server\x1b[0m`);
    // ... all the logging ...
    logger.success('Ready — waiting for agents to connect...');
    logger.raw('');
  });
}
```

After:
```ts
  return new Promise<import('node:http').Server>((resolve) => {
    server.listen(config.port, config.host, () => {
      const baseUrl = `http://localhost:${config.port}`;
      logger.raw('');
      logger.raw(`  \x1b[1mHeron Server\x1b[0m`);
      // ... keep all existing logging lines exactly as they are ...
      logger.success('Ready — waiting for agents to connect...');
      logger.raw('');
      resolve(server);
    });
  });
}
```

(Only two changes: wrap with `return new Promise(...)` and add `resolve(server)` at the end of the listen callback. All existing logging stays put.)

- [ ] **Step 2: Verify the existing callers still work**

Run: `npm run lint`
Expected: PASS. `bin/heron.ts` calls `await startServer(...)` and ignores the return value — unaffected.

### 6b: Write failing server endpoint tests

- [ ] **Step 3: Write the failing test**

Create `tests/server/compare.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server, AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { startServer } from '../../src/server/index.js';
import type { LLMClient } from '../../src/llm/client.js';
import * as llmModule from '../../src/llm/client.js';

const MOCK_DIFF = `# Report Comparison

## Summary

| Resolved | Added | Severity changes | Systems +/− |
|----------|-------|------------------|-------------|
|    0     |   0   |        0         |     0 / 0   |

## Resolved
_(none)_

## Added
_(none)_
`;

describe('compare endpoints', () => {
  let tempDir: string;
  let baseUrl: string;
  let server: Server | null = null;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'heron-compare-test-'));

    const mockLLM: LLMClient = {
      chat: vi.fn().mockResolvedValue(MOCK_DIFF),
    };
    vi.spyOn(llmModule, 'createLLMClient').mockResolvedValue(mockLLM);

    const port = await getFreePort();
    server = await startServer({
      port,
      host: '127.0.0.1',
      llm: { provider: 'anthropic', apiKey: 'sk-ant-fake' },
      maxFollowUps: 0,
      reportDir: tempDir,
    });
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
    }
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('POST /api/sessions/:id/compare writes diff file and returns 303 redirect', async () => {
    const sessionId = await runSessionToCompletion(baseUrl);

    const resp = await fetch(`${baseUrl}/api/sessions/${sessionId}/compare`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'text/markdown' },
      body: 'pretend old report',
    });

    expect(resp.status).toBe(303);
    expect(resp.headers.get('location')).toBe(`/sessions/${sessionId}/compare`);

    const diffPath = join(tempDir, `${sessionId}-diff.md`);
    expect(existsSync(diffPath)).toBe(true);
    expect(readFileSync(diffPath, 'utf-8')).toBe(MOCK_DIFF.trim());
  });

  it('GET /sessions/:id/compare renders saved diff as HTML', async () => {
    const sessionId = await runSessionToCompletion(baseUrl);
    const diffPath = join(tempDir, `${sessionId}-diff.md`);
    writeFileSync(diffPath, '## Summary\n\nHello diff.\n', 'utf-8');

    const resp = await fetch(`${baseUrl}/sessions/${sessionId}/compare`);
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain('<h2>Summary</h2>');
    expect(html).toContain('Hello diff.');
    expect(html).toContain(`/sessions/${sessionId}`); // back link
  });

  it('GET /sessions/:id/compare returns 404 when no diff exists', async () => {
    const sessionId = await runSessionToCompletion(baseUrl);
    const resp = await fetch(`${baseUrl}/sessions/${sessionId}/compare`);
    expect(resp.status).toBe(404);
  });

  it('POST /api/sessions/:id/compare returns 413 for oversize bodies', async () => {
    const sessionId = await runSessionToCompletion(baseUrl);
    const huge = 'x'.repeat(200 * 1024); // 200 KB > 128 KB cap
    const resp = await fetch(`${baseUrl}/api/sessions/${sessionId}/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: huge,
    });
    expect(resp.status).toBe(413);
  });
});

// ──── Helpers ────

/** Pick a free TCP port by asking the OS for one via a throwaway listener. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

/**
 * Drives the existing `/v1/chat/completions` flow to completion so that
 * `session.report` is populated. The mocked LLM returns the same canned
 * markdown for every call — fine, because we only need status === 'complete'
 * and a non-null session.report for `compareWithUpload` to work.
 */
async function runSessionToCompletion(baseUrl: string): Promise<string> {
  let sessionId: string | undefined;
  for (let i = 0; i < 40; i++) {
    const body: Record<string, unknown> = {
      model: 'any',
      messages: [{ role: 'user', content: `answer ${i}` }],
    };
    if (sessionId) body.heron_session_id = sessionId;

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await resp.json()) as {
      heron_session_id: string;
      heron_status?: string;
    };
    sessionId = data.heron_session_id;
    if (data.heron_status === 'complete') break;
  }
  if (!sessionId) throw new Error('could not complete session');

  // Wait up to ~3s for background analysis to finish.
  for (let i = 0; i < 30; i++) {
    const s = (await fetch(`${baseUrl}/api/sessions/${sessionId}`).then((r) => r.json())) as {
      status: string;
    };
    if (s.status === 'complete') return sessionId;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('session did not reach complete');
}
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `npm test -- tests/server/compare.test.ts`
Expected: FAIL — at minimum, `POST /api/sessions/:id/compare` returns 404 because the endpoint doesn't exist yet. Some tests may succeed accidentally (e.g. 404 GET) — that's fine, we'll rerun after the implementation.

### 6c: Implement the endpoints

- [ ] **Step 5: Add the POST and GET route registrations in `src/server/index.ts`**

In `src/server/index.ts`, find the section that routes URL paths (starts near `const url = new URL(req.url ?? '/', ...)` in the `createServer` callback). **After** the `const reportMatch` block (around line 66) and **before** the `/favicon.svg` block, insert:

```ts
      // REST: POST compare (upload previous report for diff)
      const postCompareMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/compare$/);
      if (postCompareMatch && req.method === 'POST') {
        await handlePostCompare(req, res, sessions, postCompareMatch[1]);
        return;
      }

      // HTML: compare page (rendered diff)
      const comparePageMatch = url.pathname.match(/^\/sessions\/([^/]+)\/compare$/);
      if (comparePageMatch && req.method === 'GET') {
        await handleComparePage(res, sessions, comparePageMatch[1]);
        return;
      }
```

- [ ] **Step 6: Add the handler implementations at the bottom of `src/server/index.ts`**

At the bottom of `src/server/index.ts` (just before the `escapeHtml` helper), insert:

```ts
// ─── Compare handlers (AAP-32) ────────────────────────────────────────────

const MAX_COMPARE_BODY_BYTES = 128 * 1024;

async function handlePostCompare(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionManager,
  sessionId: string,
): Promise<void> {
  // Stream-read the body with size cap.
  const chunks: Buffer[] = [];
  let total = 0;
  let oversize = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_COMPARE_BODY_BYTES) {
      oversize = true;
      break;
    }
    chunks.push(buf);
  }
  if (oversize) {
    json(res, 413, { error: `Upload exceeds ${MAX_COMPARE_BODY_BYTES} byte limit` });
    return;
  }

  const uploaded = Buffer.concat(chunks).toString('utf-8');
  if (!uploaded.trim()) {
    json(res, 400, { error: 'Empty upload' });
    return;
  }

  try {
    await sessions.compareWithUpload(sessionId, uploaded);
    res.writeHead(303, { Location: `/sessions/${sessionId}/compare` });
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Compare failed for ${sessionId}: ${msg}`);
    json(res, 500, { error: msg });
  }
}

async function handleComparePage(
  res: ServerResponse,
  sessions: SessionManager,
  sessionId: string,
): Promise<void> {
  const diff = sessions.getDiffContent(sessionId);
  if (!diff) {
    json(res, 404, {
      error: 'No diff exists for this session. Upload a previous report first.',
    });
    return;
  }

  const html = `<!DOCTYPE html>
<html>
<head><title>Diff — ${sessionId}</title>${FAVICON_LINK}
<style>${SHARED_CSS}</style>
</head>
<body>
  <div class="header">${HERON_LOGO}<h1>Heron</h1></div>
  <p style="margin: 0 0 24px 0;"><a href="/sessions/${sessionId}">&larr; Back to session ${sessionId}</a></p>
  <h2>Report Comparison</h2>
  <div class="report-rendered">${markdownToHtml(diff)}</div>
  <div class="footer">Powered by <a href="https://github.com/theonaai/Heron">Heron</a> &mdash; open-source agent checkpoint</div>
</body>
</html>`;

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(html);
}
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- tests/server/compare.test.ts`
Expected: PASS — all 4 tests green.

**If a test fails with "session did not reach complete":** the existing `/v1/chat/completions` flow uses the real interview protocol; with `maxFollowUps: 0` in the test setup and a mocked LLM returning the same string every time, the 13-question interview should finish in ~13 iterations. If it hangs, check that `maxFollowUps: 0` is passed in `startTestServer`.

- [ ] **Step 8: Commit**

```bash
git add tests/server/compare.test.ts src/server/index.ts
git commit -m "feat(server): POST /api/sessions/:id/compare + GET compare page (AAP-32)"
```

---

## Task 7: Session page — upload block

**Files:**
- Modify: `src/server/index.ts` (inside `handleSessionPage`)

- [ ] **Step 1: Locate the session page render**

Find the function `async function handleSessionPage(...)` in `src/server/index.ts`. Inside it, after the `reportSection` variable is computed and before the final `const html = ...`, there's a line that injects `<div id="report-section">${reportSection}</div>` into the template.

- [ ] **Step 2: Compute a `compareSection` variable**

**Immediately after** the `reportSection` assignment (there's a `?:` chain producing it), add:

```ts
  const compareSection = session.status === 'complete' && session.report
    ? sessions.hasDiff(id)
      ? `<h2>Comparison</h2>
         <p>This session has been compared against a previous report.</p>
         <div class="report-actions">
           <a href="/sessions/${id}/compare" class="btn">View diff</a>
           <button onclick="document.getElementById('compare-upload').click()" class="btn btn-outline">Replace — upload a different previous report</button>
         </div>
         <input type="file" id="compare-upload" accept=".md,.markdown,text/markdown" style="display:none" onchange="uploadCompare(this)">`
      : `<h2>Compare to previous report</h2>
         <p>Upload an older Heron audit report (markdown) to see what changed.</p>
         <div class="report-actions">
           <button onclick="document.getElementById('compare-upload').click()" class="btn">📁 Upload previous report (.md)</button>
         </div>
         <input type="file" id="compare-upload" accept=".md,.markdown,text/markdown" style="display:none" onchange="uploadCompare(this)">`
    : '';
```

- [ ] **Step 3: Render the `compareSection` in the page template**

Find the line `<div id="report-section">${reportSection}</div>` inside the html template string. **Immediately after it**, insert:

```html
  <div id="compare-section">${compareSection}</div>
```

- [ ] **Step 4: Add the upload JS to the page**

The session page has an existing `<script>` block that polls when the session is still active. Below the closing `</script>` of that polling script (or if no polling script was emitted, before `</body>`), insert an unconditional inline script:

Find this line (the polling script block):
```ts
  ${session.status === 'interviewing' || session.status === 'analyzing' ? `<script>
```

And the end of it `</script>` closes just before `</body>`. **Immediately before** `</body>`, add a separate conditional script for the upload handler (active only when there's a report to compare):

```ts
  ${session.status === 'complete' ? `<script>
  function uploadCompare(input) {
    var file = input.files[0];
    if (!file) return;
    if (file.size > 128 * 1024) {
      alert('File too large (max 128 KB)');
      input.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e) {
      fetch('/api/sessions/${id}/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'text/markdown' },
        body: e.target.result,
      }).then(function(r) {
        if (r.redirected) { window.location = r.url; return; }
        if (r.ok) { window.location = '/sessions/${id}/compare'; return; }
        return r.json().then(function(d) { alert('Upload failed: ' + (d.error || 'unknown')); });
      }).catch(function(err) { alert('Upload error: ' + err.message); });
    };
    reader.readAsText(file);
  }
  </script>` : ''}
```

- [ ] **Step 5: Smoke-test manually**

Run: `npm run dev -- serve` (or `npm run build && node dist/bin/heron.js serve`), then in a browser:

1. Open `http://localhost:3700` — no sessions yet, that's fine.
2. In another terminal, hit `POST http://localhost:3700/v1/chat/completions` a few times (or use the copy-paste prompt from the landing page) to create a completed session. Easier: pre-create a completed session using the session-flow test approach.
3. Visit `http://localhost:3700/sessions/<id>` — you should see the "Compare to previous report" block under the report.
4. Click the upload button, select any `.md` file.
5. Page should navigate to `http://localhost:3700/sessions/<id>/compare` with the rendered diff.

If you don't have time to smoke-test interactively, the unit tests from Task 6 already validate the HTTP behavior.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(server): upload block on session page for diff (AAP-32)"
```

---

## Task 8: Landing page — `Compare` column

**Files:**
- Modify: `src/server/index.ts` (inside `handleLanding` and `handleListSessions`)

### 8a: Add `hasDiff` to the sessions JSON

- [ ] **Step 1: Update `handleListSessions`**

Find `handleListSessions` in `src/server/index.ts`. Change the `list` map to include `hasDiff`:

Before:
```ts
  const list = sessions.listSessions().map(s => ({
    id: s.id,
    status: s.status,
    questionsAsked: s.questionsAsked,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    riskLevel: s.reportJson?.overallRiskLevel ?? null,
  }));
```

After:
```ts
  const list = sessions.listSessions().map(s => ({
    id: s.id,
    status: s.status,
    questionsAsked: s.questionsAsked,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    riskLevel: s.reportJson?.overallRiskLevel ?? null,
    hasDiff: sessions.hasDiff(s.id),
  }));
```

### 8b: Add the `Compare` column to the rendered HTML table

- [ ] **Step 2: Update the table header**

In `handleLanding`, find:

```html
<thead><tr><th>Session</th><th>Status</th><th>Questions</th><th>Risk</th><th>Started</th></tr></thead>
```

Replace with:

```html
<thead><tr><th>Session</th><th>Status</th><th>Questions</th><th>Risk</th><th>Compare</th><th>Started</th></tr></thead>
```

- [ ] **Step 3: Update the row template**

In `handleLanding`, find the `${activeSessions.map(s => ...).join('')}` block. Its current template is:

```html
<tr data-id="${s.id}">
  <td><a href="/sessions/${s.id}"><code>${s.id}</code></a></td>
  <td><span class="badge badge-${s.status}">${s.status}</span></td>
  <td>${s.questionsAsked}</td>
  <td>${s.reportJson?.overallRiskLevel ? `<span class="risk risk-${s.reportJson.overallRiskLevel}">${s.reportJson.overallRiskLevel.toUpperCase()}</span>` : '—'}</td>
  <td>${s.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
</tr>
```

Replace with:

```html
<tr data-id="${s.id}">
  <td><a href="/sessions/${s.id}"><code>${s.id}</code></a></td>
  <td><span class="badge badge-${s.status}">${s.status}</span></td>
  <td>${s.questionsAsked}</td>
  <td>${s.reportJson?.overallRiskLevel ? `<span class="risk risk-${s.reportJson.overallRiskLevel}">${s.reportJson.overallRiskLevel.toUpperCase()}</span>` : '—'}</td>
  <td>${sessions.hasDiff(s.id) ? `<a href="/sessions/${s.id}/compare">compare</a>` : '—'}</td>
  <td>${s.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
</tr>
```

### 8c: Update the polling script that rebuilds rows

- [ ] **Step 4: Update the polling script (initial row construction)**

In the polling script at the bottom of `handleLanding`, find:

```js
row.innerHTML = '<td><a href="/sessions/' + s.id + '"><code>' + s.id + '</code></a></td><td></td><td></td><td></td><td></td>';
```

(Note the 5 empty `<td>` cells.) Replace with 6 empty cells:

```js
row.innerHTML = '<td><a href="/sessions/' + s.id + '"><code>' + s.id + '</code></a></td><td></td><td></td><td></td><td></td><td></td>';
```

- [ ] **Step 5: Update the polling script (cell updates)**

Right below the row-creation block, find the `cells[...]` update block. Current code:

```js
cells[1].innerHTML = '<span class="badge badge-' + s.status + '">' + s.status + '</span>';
cells[2].textContent = s.questionsAsked;
cells[3].innerHTML = s.riskLevel ? '<span class="risk risk-' + s.riskLevel + '">' + s.riskLevel.toUpperCase() + '</span>' : '\u2014';
cells[4].textContent = s.createdAt.slice(0,19).replace('T',' ');
```

Replace with:

```js
cells[1].innerHTML = '<span class="badge badge-' + s.status + '">' + s.status + '</span>';
cells[2].textContent = s.questionsAsked;
cells[3].innerHTML = s.riskLevel ? '<span class="risk risk-' + s.riskLevel + '">' + s.riskLevel.toUpperCase() + '</span>' : '\u2014';
cells[4].innerHTML = s.hasDiff ? '<a href="/sessions/' + s.id + '/compare">compare</a>' : '\u2014';
cells[5].textContent = s.createdAt.slice(0,19).replace('T',' ');
```

(Note: the original code has `\\u2014` inside a template literal. If you see a double-escape, match the existing escaping style when you edit.)

### 8d: Add a landing-page test

- [ ] **Step 6: Extend the test file with a landing-page check**

In `tests/server/compare.test.ts`, add a new test inside the existing `describe` block:

```ts
  it('landing page shows compare link for sessions with a diff on disk', async () => {
    const sessionId = await runSessionToCompletion(baseUrl);
    // Pre-place a diff file.
    writeFileSync(join(tempDir, `${sessionId}-diff.md`), '## Summary\n\n_(none)_', 'utf-8');

    const resp = await fetch(`${baseUrl}/`);
    const html = await resp.text();

    expect(html).toContain('<th>Compare</th>');
    expect(html).toContain(`<a href="/sessions/${sessionId}/compare">compare</a>`);
  });

  it('landing page JSON includes hasDiff for each session', async () => {
    const sessionId = await runSessionToCompletion(baseUrl);
    writeFileSync(join(tempDir, `${sessionId}-diff.md`), 'x', 'utf-8');

    const resp = await fetch(`${baseUrl}/api/sessions`);
    const data = (await resp.json()) as { sessions: Array<{ id: string; hasDiff: boolean }> };
    const s = data.sessions.find((x) => x.id === sessionId);
    expect(s).toBeDefined();
    expect(s!.hasDiff).toBe(true);
  });
```

- [ ] **Step 7: Run all compare tests**

Run: `npm test -- tests/server/compare.test.ts`
Expected: PASS — 6 tests total.

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions in existing tests.

- [ ] **Step 9: Commit**

```bash
git add src/server/index.ts tests/server/compare.test.ts
git commit -m "feat(server): Compare column on landing page (AAP-32)"
```

---

## Task 9: Final verification

**Files:**
- No file changes; run checks only.

- [ ] **Step 1: TypeScript compile**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: End-to-end CLI smoke**

With a real API key in `HERON_LLM_API_KEY`:

Run: `npm run dev -- diff tests/diff/fixtures/report-old.md tests/diff/fixtures/report-new.md --report-dir /tmp/heron-smoke`
Expected: stdout prints Old/New/Diff paths; `/tmp/heron-smoke/diff-report-old-report-new.md` exists and contains a markdown diff with `## Summary`, `## Resolved`, etc.

If you don't have a key handy, skip — the test suite already exercises the flow with a mocked LLM.

- [ ] **Step 4: End-to-end server smoke**

Run: `npm run dev -- serve --report-dir /tmp/heron-smoke`

In a browser:
1. Go through the copy-paste prompt to complete a session.
2. Open the session page; you should see the upload block.
3. Upload any Heron report (e.g. one of the fixtures); after a few seconds you should land on the compare page.
4. Go back to `/`; the sessions table should show a `compare` link in the Compare column.

Skip if no API key — tests cover this path.

- [ ] **Step 5: Final commit (only if there are uncommitted changes)**

```bash
git status
# If nothing to commit, skip.
# Otherwise, commit any leftover tweaks:
git add .
git commit -m "chore(diff): wrap up AAP-32"
```

---

## Out of scope (explicitly not in this plan)

These items are deferred to follow-up work; do NOT pull them into this plan:

- `scan --compare-to-previous` auto-detection.
- URL / remote fetch of reports for diffing.
- CI gating / non-zero exit codes based on "new findings" count.
- Staged-rollout lifecycle tracking (requires `AuditReport` schema changes).
- Multi-report trend charts.
- "Download diff" button in the web UI.
- Drag-and-drop upload target (the hidden file input suffices for MVP).
