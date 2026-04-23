# Report Comparison — Design Spec

**Linear:** [AAP-32](https://linear.app/theona/issue/AAP-32/report-comparison-delta-between-two-audit-versions)
**Date:** 2026-04-23
**Status:** Design approved, pending implementation plan

---

## Problem

A user runs `heron scan` (or the server flow) twice against the same AI agent — for example, once in April, then again in May after fixing some issues. They want to see **what changed** between those two audits:

- Which findings were resolved?
- Which new findings appeared?
- Did severity levels change (e.g. a HIGH downgraded to MEDIUM)?
- Were new systems added, or removed?
- Did the overall risk level improve or get worse?

Today, users have two markdown reports side-by-side and have to diff them by eye. That doesn't scale.

---

## Scope

### In scope (MVP)

1. **CLI:** `heron diff <old.md> <new.md>` — prints a markdown delta.
2. **Web:** Upload button on the session report page that accepts a previous markdown report and renders the diff.
3. **LLM-based comparison** — one model call per diff, reads both full markdown reports, returns a structured delta.

### Explicitly out of scope (future work)

- Auto-detection of "previous report" (e.g. `scan --compare-to-previous`) — belongs to a later task.
- URL / remote fetch of reports.
- CI gating via exit codes (easy to add later on top of MVP).
- Tracking the staged-rollout lifecycle (read-only → HITL → write) mentioned in AAP-32 — requires data model changes (agent operation modes aren't in `AuditReport` today), punt to a follow-up.
- Multi-report trend charts / time series.
- Persistent storage of uploads in web mode (uploads are ephemeral per server lifetime).
- String-matching fallback when no LLM key — comparison without LLM is not useful, so we match the `scan` behavior and require a key.

---

## User experience

### CLI

```
heron diff reports/sess_abc.md reports/sess_xyz.md
```

Behavior mirrors `heron scan`: do the work, save the result to disk, print a short summary of where it went.

**Stdout output (short, like `scan`):**

```
  Heron Report Diff

  Old:   reports/sess_abc.md  (2026-04-10, MEDIUM)
  New:   reports/sess_xyz.md  (2026-04-22, LOW)
  Diff:  reports/diff-sess_abc-sess_xyz.md
```

The "Old" and "New" metadata (date + overall risk level) come from the first line of each Heron report via a simple regex (`**Generated**: <date>` and `**Risk Level**: <level>`). No content parsing — just header reads.

**File saved to disk** (default): `reports/diff-<oldBasename>-<newBasename>.md`, containing the full markdown diff produced by the LLM. Basenames come from input filenames with `.md` stripped.

Flags:
- `-o <path>` — override the default save path.
- `--report-dir <dir>` — override the default report directory (same flag as `scan`, defaults to `./reports`).
- `--llm-provider`, `--llm-model`, `--llm-key` — same as `scan`.

Exit codes: `0` on success. CI gating is a later-stage feature.

Error cases:
- Missing file → `Error: file not found: <path>` → exit 1
- Non-Heron markdown / garbage input → LLM still attempts; if the response fails the sanity check twice (original + one retry), exit 1 with a clear message
- No LLM key → same error as `scan` → exit 1

### Web UI — session page

On `/sessions/:id` (the session page that already renders the current report), below the existing Report section, add a new block:

```
## Compare to previous report

[ 📁 Upload previous report (.md) ]   [or drag-and-drop here]
```

If a diff for this session already exists on disk (`reports/<sessionId>-diff.md`), the block instead shows:

```
## Comparison

This session has been compared against a previous report.

[ View diff ]   [ Replace — upload a different previous report ]
```

**Upload flow:**
1. User uploads a `.md` file through the button or drag-and-drop.
2. Browser POSTs to `/api/sessions/:id/compare` with the markdown body.
3. Server calls the diff logic (same code path as CLI), writes the result to `reports/<sessionId>-diff.md` (overwrites any previous diff for this session — user confirmed this is acceptable).
4. Server responds with a 303 redirect to `/sessions/:id/compare`.
5. That page reads `reports/<sessionId>-diff.md` and renders it as HTML using the existing `markdownToHtml` helper. Includes a "← Back to session" link.

**Upload size cap:** 128 KB per upload (reports are typically 20–40 KB; cap gives headroom without letting someone DoS the server).

### Web UI — landing page

The sessions table on the landing page gains a new column "Compare" (added between "Risk" and "Started"). For each row:

- If `reports/<sessionId>-diff.md` exists on disk → the cell shows a `compare` link to `/sessions/:id/compare`.
- Otherwise → the cell is empty (just `—`).

```
  SESSION           STATUS        QUESTIONS  RISK      COMPARE    STARTED
  sess_8f0...521d   complete            13   MEDIUM    compare    2026-04-20
  sess_eb1...40cb   interviewing         2   —         —          2026-04-20
```

The existence check is a cheap `fs.existsSync(reports/<id>-diff.md)` per row at render time. Self-healing: delete the file, the link disappears on next load. Survives server restarts (unlike in-memory storage).

As soon as a diff is saved (at the moment the user uploads a previous report on the session page), the link appears — next reload of the landing page shows it.

**Trust model:** reports and diffs live in the same `reportDir` (default `./reports`). Localhost dev tool — no auth. Same trust model the server uses today for reports.

---

## How it works (architecture)

### Data flow

```
old.md ─┐
        ├──► diffReports(oldMd, newMd, llmClient) ──► diff markdown ──► output
new.md ─┘                 │
                          ▼
                   LLM (one chat call)
                   system prompt: "you are a diff engine, return markdown"
                   user prompt: old + new markdown + target output format
                   response: markdown diff
```

### Modules

```
src/
  diff/
    differ.ts        # diffReports(oldMd, newMd, llmClient) → string (markdown)
  commands/
    diff.ts          # CLI handler (reads files, wires up LLM client, prints output)
  llm/
    prompts.ts       # (existing file) add DIFF_SYSTEM_PROMPT and buildDiffPrompt

tests/
  diff/
    differ.test.ts   # mock LLM, verify sanity check + retry behavior
    cli.test.ts      # integration test for `heron diff` subcommand (mocked LLM)
    fixtures/
      report-old.md  # handcrafted small Heron report
      report-new.md  # same agent, some findings resolved, some added
```

Changes to existing files:
- `bin/heron.ts` — register `diff` subcommand.
- `src/server/index.ts` — add `POST /api/sessions/:id/compare` and `GET /sessions/:id/compare` handlers; add upload block to the session page HTML; add "Compare" column to the landing-page sessions table.
- `src/llm/prompts.ts` — add diff prompt constants.

No changes to `AuditReport` schema. No changes to `scan` or `serve`. No Zod schema for diff output, no render layer — the LLM produces the final markdown directly. Diff output is saved to disk alongside existing `.md` reports.

### Persistence

Diffs are saved to disk in the same `reportDir` as regular reports:

- **CLI** (`heron diff old.md new.md`) → `reports/diff-<oldBasename>-<newBasename>.md`. Not tied to a server session.
- **Web** (upload on session page) → `reports/<sessionId>-diff.md`. Tied to a session; new upload for the same session overwrites the previous diff (user confirmed this is acceptable, same overwrite semantics as `scan` reports today).

Both paths call the same `diffReports(oldMd, newMd, llmClient)` function and write the returned markdown to disk. No in-memory diff storage — reads go through the filesystem (landing-page column, session page "has diff?" check, `/sessions/:id/compare` render).

### LLM prompt strategy

**System prompt** (pinned, short): "You compare two AI-agent audit reports and return a markdown diff. Preserve exact finding titles from the inputs. Only report changes you can justify from the text — don't invent findings. Produce well-structured markdown with clear section headings."

**User prompt:**
```
Compare these two audit reports for the same AI agent and return a markdown diff
describing what changed.

=== OLD REPORT ===
<full markdown of old report>

=== NEW REPORT ===
<full markdown of new report>

Your output must be markdown with exactly these top-level sections (use `##` headings):
- Summary (a one-row table: Resolved | Added | Severity changes | Systems +/−, plus a line
  stating the overall risk direction: improved / worsened / unchanged)
- Resolved (bullet list of findings from OLD that are no longer in NEW; include severity)
- Added (bullet list of findings in NEW that weren't in OLD; include severity)
- Severity changes (bullet list of findings that appear in both but with different severity)
- Systems (subsections: Added / Removed / Scopes changed)

Rules:
- A finding is "resolved" if it's in OLD and the NEW report clearly doesn't contain an
  equivalent issue.
- A finding is "added" if it's in NEW and wasn't in OLD.
- "Severity changes" means the same semantic finding appears in both with a different
  severity level. Do NOT list it in both Resolved and Added.
- Use the exact finding titles from the source reports (don't paraphrase).
- If a section has nothing to report, still include the heading with "_(none)_".
- Start the output with a short header block naming both reports (dates and overall risk).
```

**Sanity check on response** (not schema validation — just enough to catch garbage):
- Non-empty after trimming.
- Contains at least one of the expected headings (`## Summary`, `## Resolved`, `## Added`).

If sanity check fails, retry once with the same prompt (existing `analyzer.ts` pattern). If the retry also fails, surface a clear error to the user — no silent fallback.

### Output format

There is no intermediate data structure. `diffReports()` returns the markdown string returned by the LLM (after sanity check and fence stripping). The CLI prints it. The web handler stores it and renders it through the existing `markdownToHtml` helper.

This means no `types.ts`, no `templates.ts`, no snapshot-against-ReportDiff tests — the LLM controls formatting end-to-end, constrained by the section structure required in the prompt.

---

## Testing strategy

1. **`differ.test.ts`** — uses a mock `LLMClient`:
   - Happy path: mock returns well-formed diff markdown (with expected headings) → assert `diffReports` returns it unchanged (after fence stripping).
   - Sanity-check retry: first mock call returns an empty string or text without any expected headings, second returns valid markdown → assert retry happened and final result is correct.
   - Double failure: both mock calls return garbage → assert the function throws a clear error (no silent fallback).
   - Fence stripping: mock wraps output in ```` ```markdown ... ``` ```` → assert fences are stripped.

2. **CLI integration test** — `tests/diff/cli.test.ts`:
   - Uses two fixture markdown reports from `tests/diff/fixtures/`.
   - Runs the CLI via a test harness (existing pattern in `tests/integration/`).
   - Mocks the LLM client to return a canned diff markdown.
   - Asserts stdout equals the canned markdown.

3. **Server endpoint test** — `tests/server/compare.test.ts`:
   - POST a markdown body to `/api/sessions/:id/compare` with a fake session and mocked LLM.
   - Assert the endpoint writes `reports/<id>-diff.md` and returns a 303 redirect to `/sessions/:id/compare`.
   - GET the compare page and assert the file contents are rendered into HTML.
   - GET the landing page and assert the sessions table has a `compare` link for this session.

Existing patterns followed: Vitest, LLM client mocking style from `tests/analysis/`, server test style from `tests/server/`.

---

## Open questions / assumptions

- **Language of the report matters?** Heron reports are English today. If the LLM sees a future localized report, the prompt should still work (LLM handles multilingual). Not a blocker.
- **Very long reports?** Two 40 KB reports ≈ 20 K tokens together — well within any modern context window. Not a concern for MVP.
- **Session page already has polling logic** for status updates — the upload button must not interfere. Upload form is a plain HTML form post; existing polling only reads `/api/sessions/:id` and doesn't touch the new compare endpoint. Safe.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| LLM hallucinates a resolved/added finding that isn't there | System prompt explicitly forbids invention; prompt instructs model to quote exact titles. We document in the rendered output that this is an LLM-assisted comparison, not a ground truth. |
| LLM returns malformed output (empty, off-topic, missing sections) | Sanity check (non-empty + contains at least one expected heading) + one retry + clear error on double failure. Same pattern as `analyzer.ts`. |
| User uploads a non-Heron markdown file | LLM will produce low-quality output that likely fails the sanity check → retry → clear error. |
| `reportDir` disk space | Diffs are regular markdown files (~5–20 KB each). Overwrite-per-session means max 1 diff per session. No new unbounded growth beyond what `scan` reports already cause. Uploads capped at 128 KB before they hit the LLM. |

---

## What's not in this spec (intentionally)

- Implementation order / task breakdown — that's the job of the writing-plans skill, which runs next.
- Exact copy/UI strings beyond what's needed to convey the UX.
- Whether to add a "Download diff" button in the web UI — nice-to-have, can be added later if users ask for it.
