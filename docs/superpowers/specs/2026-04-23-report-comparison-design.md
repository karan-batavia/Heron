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

Prints to stdout:

```
# Report Comparison

**Old:** sess_abc (2026-04-10) — risk: MEDIUM
**New:** sess_xyz (2026-04-22) — risk: LOW ✓ improved

## Summary

| Resolved | Added | Severity changes | Systems +/− |
|----------|-------|------------------|-------------|
|    2     |   1   |        1         |    +1 / −0  |

## Resolved (2)

- **[HIGH] Broad write access to Google Sheets queue** — no longer present
- **[CRITICAL] Local HTTP worker has no built-in authentication** — no longer present

## Added (1)

- **[MEDIUM] Telegram notifications may expose internal links** — new in this audit

## Severity changes (1)

- **Broad Google Drive write access**: HIGH → MEDIUM

## Systems

**Added:**
- Notion → REST API → API key

**Removed:**
_(none)_

**Scopes changed:**
- Google Sheets: removed `spreadsheets.readonly` (least-privilege improvement)
```

Flags:
- `-o <path>` — write to file instead of stdout
- `-f markdown|json` — output format (markdown default, JSON for tooling)
- `--llm-provider`, `--llm-model`, `--llm-key` — same as `scan`

Exit codes: `0` always (diff is informational, not a gate). CI gating is a later-stage feature.

Error cases:
- Missing file → `Error: file not found: <path>` → exit 1
- Invalid markdown (doesn't look like a Heron report) → LLM will still try; if the model returns a clearly bogus response, Zod validation catches it → exit 1 with a helpful message
- No LLM key → same error as `scan` → exit 1

### Web UI

On `/sessions/:id` (the session page that already renders the current report), below the existing Report section, add a new block:

```
## Compare to previous report

[ 📁 Upload previous report (.md) ]   [or drag-and-drop here]
```

Flow:
1. User uploads a `.md` file.
2. Browser POSTs to `/api/sessions/:id/compare` with the markdown body.
3. Server calls the diff logic (same code path as CLI), stores the resulting `ReportDiff` in memory keyed by session id.
4. Server responds with a redirect to `/sessions/:id/compare`.
5. That page renders the diff as HTML using the existing `markdownToHtml` helper.

**Trust model:** the upload is stored in memory only, scoped to the server's lifetime, keyed to the session id. No persistent storage, no auth — matches the current server's trust model (localhost dev tool). Uploads are capped at 128 KB (reports are typically 20–40 KB; cap gives headroom without letting someone DoS the server).

---

## How it works (architecture)

### Data flow

```
old.md ─┐
        ├──► diffReports(old, new, llmClient) ──► ReportDiff ──► renderDiffMarkdown ──► output
new.md ─┘                 │
                          ▼
                   LLM (one chat call)
                   system prompt: "you are a diff engine"
                   user prompt: old + new markdown
                   response: structured JSON matching reportDiffSchema
```

### Modules

```
src/
  diff/
    types.ts       # Zod schema for ReportDiff (LLM output shape)
    differ.ts      # diffReports(oldMd, newMd, llmClient) → ReportDiff
    templates.ts   # renderDiffMarkdown(diff) → string
  commands/
    diff.ts        # CLI handler (reads files, wires up LLM client, prints output)
  llm/
    prompts.ts     # (existing file) add DIFF_SYSTEM_PROMPT and buildDiffPrompt

tests/
  diff/
    differ.test.ts      # mock LLM, verify parse + Zod validation + retry behavior
    templates.test.ts   # snapshot test against fixture ReportDiff objects
    cli.test.ts         # integration test for `heron diff` subcommand (mocked LLM)
    fixtures/
      report-old.md     # handcrafted small Heron report
      report-new.md     # same agent, some findings resolved, some added
```

Changes to existing files:
- `bin/heron.ts` — register `diff` subcommand.
- `src/server/index.ts` — add `POST /api/sessions/:id/compare` and `GET /sessions/:id/compare` page handlers; add upload button to the existing session page HTML.
- `src/server/sessions.ts` — add a Map<sessionId, ReportDiff> for storing uploads in memory.
- `src/llm/prompts.ts` — add diff prompt constants.

No changes to persistence. No changes to `AuditReport` schema. No changes to `scan` or `serve`.

### LLM prompt strategy

**System prompt** (pinned, short): "You compare two AI-agent audit reports and return a structured JSON diff. Preserve exact finding titles from the inputs. Only report changes you can justify from the text — don't invent findings."

**User prompt:**
```
Compare these two audit reports for the same AI agent and return the JSON diff.

=== OLD REPORT ===
<full markdown of old report>

=== NEW REPORT ===
<full markdown of new report>

Return JSON matching this schema:
{
  "old": {"date": string, "target": string, "overallRiskLevel": "low"|"medium"|"high"|"critical"},
  "new": {"date": string, "target": string, "overallRiskLevel": "low"|"medium"|"high"|"critical"},
  "overallRiskDirection": "improved"|"worsened"|"unchanged",
  "resolved": [{"title": string, "severity": ..., "description": string}],
  "added":    [{"title": string, "severity": ..., "description": string}],
  "severityChanged": [{"title": string, "oldSeverity": ..., "newSeverity": ..., "direction": "up"|"down"}],
  "systemsAdded": [string],
  "systemsRemoved": [string],
  "scopesChanged": [{"systemId": string, "added": [string], "removed": [string]}]
}

Rules:
- A finding is "resolved" if it's in OLD and the NEW report clearly doesn't contain an equivalent issue.
- A finding is "added" if it's in NEW and wasn't in OLD.
- "severityChanged" means the same semantic finding appears in both with a different severity level. Do NOT list it in both resolved+added.
- Use the exact finding titles from the source reports in your output (don't paraphrase).
```

We follow the existing analyzer pattern in `src/analysis/analyzer.ts`:
- `temperature=0` via the LLM client default.
- Strip markdown fences in the response before parsing.
- Retry once on parse failure.
- No fallback — if both attempts fail, surface the error with a helpful message.

### Data model

```ts
// src/diff/types.ts
import { z } from 'zod';
import { severitySchema } from '../report/types.js';

const riskSummarySchema = z.object({
  title: z.string(),
  severity: severitySchema,
  description: z.string(),
});

const scopesChangedSchema = z.object({
  systemId: z.string(),
  added: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
});

export const reportDiffSchema = z.object({
  old: z.object({
    date: z.string(),
    target: z.string(),
    overallRiskLevel: severitySchema,
  }),
  new: z.object({
    date: z.string(),
    target: z.string(),
    overallRiskLevel: severitySchema,
  }),
  overallRiskDirection: z.enum(['improved', 'worsened', 'unchanged']),
  resolved: z.array(riskSummarySchema).default([]),
  added: z.array(riskSummarySchema).default([]),
  severityChanged: z.array(z.object({
    title: z.string(),
    oldSeverity: severitySchema,
    newSeverity: severitySchema,
    direction: z.enum(['up', 'down']),
  })).default([]),
  systemsAdded: z.array(z.string()).default([]),
  systemsRemoved: z.array(z.string()).default([]),
  scopesChanged: z.array(scopesChangedSchema).default([]),
});

export type ReportDiff = z.infer<typeof reportDiffSchema>;
```

Any additional counts (e.g. the summary row) are derived in `templates.ts` at render time, not stored.

---

## Testing strategy

1. **`differ.test.ts`** — uses a mock `LLMClient`:
   - Happy path: mock returns valid JSON → assert the parsed `ReportDiff` matches.
   - Parse failure + retry: first mock call returns garbage, second returns valid → assert retry happened and final result is correct.
   - Double failure: both mock calls return garbage → assert the function throws a clear error (no silent fallback).
   - Zod schema rejection: mock returns JSON with wrong shape → throws.

2. **`templates.test.ts`** — snapshot tests:
   - Handcrafted `ReportDiff` objects covering all output branches (resolved/added/severity-changed, systems added/removed/scope-changed, overall direction up/down/same).
   - Snapshot the rendered markdown.

3. **CLI integration test** — `tests/diff/cli.test.ts`:
   - Uses two fixture markdown reports from `tests/diff/fixtures/`.
   - Runs the CLI via a test harness (existing pattern in `tests/integration/`).
   - Mocks the LLM client to return a known `ReportDiff`.
   - Asserts stdout matches expected markdown.

4. **Server endpoint test** — `tests/server/compare.test.ts`:
   - POST a markdown body to `/api/sessions/:id/compare` with a fake session.
   - Assert the endpoint returns 303 redirect.
   - GET the compare page and assert the diff is rendered.

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
| LLM returns malformed JSON | One retry + Zod validation + clear error on double failure. Same pattern as `analyzer.ts`. |
| User uploads a non-Heron markdown file | LLM will produce a low-quality or schema-invalid response → Zod catches it → clear error. |
| Server memory fills up with uploads | Uploads are keyed by session id, only one per session (new upload overwrites). Capped at 128 KB each. |

---

## What's not in this spec (intentionally)

- Implementation order / task breakdown — that's the job of the writing-plans skill, which runs next.
- Exact copy/UI strings beyond what's needed to convey the UX.
- Whether to add a "Download diff" button in the web UI — nice-to-have, can be added later if users ask for it.
