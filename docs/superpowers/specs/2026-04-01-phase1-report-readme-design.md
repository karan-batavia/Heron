# Phase 1: Report Compliance Shell + README Rewrite

## Context

Heron is preparing for open-source launch. Two gaps remain before release:

1. **Report format** doesn't match what CISO/security teams expect. Current report has good content but lacks standard compliance framing (scope, methodology, disclaimer, data classification).
2. **README** needs rewrite to follow best OSS practices (hook → proof → quick start pattern, like gstack).

Target audience: CISO / Security teams who evaluate AI agents before granting production access.

## Part 1: Report — Compliance Shell

### Problem

Current report sections: Header → Executive Summary → Agent Purpose → Data Needs → Access Assessment → Risks → Recommendations → Transcript → Footer.

What CISO teams expect but is missing:
- **Scope & Methodology** — what was assessed, how, what are the limitations
- **Auditor Statement** — disclaimer that this is automated, not a formal audit
- **Data Classification** — PII/PHI/financial/credentials tagging on data needs
- **Standard terminology** — "Findings" instead of "Risks", "Remediation Plan" instead of "Recommendations"
- **Finding IDs** — each risk should have a unique ID (e.g., HERON-001) for tracking

### Design

#### New report section order

```
1. Header (simplified)
2. Scope & Methodology (NEW)
3. Executive Summary
4. Agent Purpose
5. Data Inventory (renamed from "Data Needs", with classification column)
6. Access Assessment (unchanged logic)
7. Findings (renamed from "Risks", with IDs)
8. Remediation Plan (renamed from "Recommendations")
9. Interview Transcript (unchanged, behind <details>)
10. Disclaimer (NEW, replaces Footer)
```

#### Changes to `src/report/types.ts`

Add `dataClassification` to `DataNeed`:
```typescript
export interface DataNeed {
  dataType: string;
  system: string;
  justification: string;
  classification?: 'PII' | 'PHI' | 'financial' | 'credentials' | 'internal' | 'public';
}
```

No other type changes needed — the new sections (Scope, Disclaimer) are static text generated from metadata.

#### Changes to `src/report/templates.ts`

**Header** — remove `questionsAsked` and `interviewDuration`, keep only:
```markdown
# Agent Access Audit Report

**Date**: 2026-03-26
**Subject**: [agent target URL or name]
**Overall Risk**: HIGH
```

**Scope & Methodology** (new section):
```markdown
## Scope & Methodology

**Assessment type**: Automated structured interview
**Method**: Heron conducted a [N]-question interview covering purpose, data access, permissions, write operations, and operational frequency.
**Limitations**: This assessment is based solely on the agent's self-reported information. No runtime analysis, code review, or network traffic inspection was performed. Findings should be verified against actual system configurations.
```

**Data Inventory** (renamed, with classification):
```markdown
## Data Inventory

| Data Type | System | Classification | Justification |
|-----------|--------|---------------|---------------|
| Customer emails | HubSpot | PII | ... |
```

**Findings** (renamed from Risks, with IDs):
```markdown
## Findings

| ID | Severity | Finding | Description |
|----|----------|---------|-------------|
| HERON-001 | CRITICAL | Full Stripe API access | Agent could create charges... |
| HERON-002 | HIGH | Excessive CRM access | Agent can modify any record... |
```

**Remediation Plan** (renamed from Recommendations):
```markdown
## Remediation Plan

| # | Finding | Action | Priority |
|---|---------|--------|----------|
| 1 | HERON-001 | Use Stripe read-only API key | Immediate |
| 2 | HERON-002 | Restrict HubSpot to Invoice object | High |
```

**Disclaimer** (replaces footer):
```markdown
---
*This report was generated automatically by [Heron](https://github.com/jonydony/Heron), an open-source AI agent auditor. It is based on the agent's self-reported information obtained through a structured interview. This is not a formal security audit, penetration test, or compliance certification. Findings should be independently verified before making access control decisions.*
```

#### Changes to `src/llm/prompts.ts`

Update `ANALYSIS_SYSTEM_PROMPT` and `buildAnalysisPrompt` to:
- Request `classification` field in `dataNeeds` output
- Use "ONLY use data from transcript, write NOT PROVIDED otherwise" anti-hallucination rule (may already exist based on status doc, verify)

#### Changes to `src/server/index.ts`

Update the HTML dashboard report rendering to match new section names. The dashboard uses `markdownToHtml` — section renames should flow through automatically if the markdown parser handles generic headers.

### What NOT to change

- Interview questions (questions.ts) — stay the same
- Risk scoring algorithm (risk-scorer.ts) — stay the same
- Session management — stay the same
- OpenAI-compatible endpoint — stay the same

---

## Part 2: README Rewrite

### Problem

Current README is functional but doesn't follow the hook → proof → quick start pattern that top OSS projects use. It needs to sell the value proposition faster and look more professional.

### Design

New structure (following gstack model):

```markdown
# Heron

> "You wouldn't give a contractor your house keys without checking their ID.
>  Why give an AI agent production access without an audit?"

## What is Heron?

[1-2 sentences: open-source tool that interviews AI agents about their access
and generates compliance-grade audit reports. No SDK, no code changes.]

[ASCII diagram: Agent → Heron → Report — already exists, keep it]

## Quick Start

### Option 1: Use the hosted version (fastest)
Point your agent at: https://heron-open-source-production.up.railway.app/v1/chat/completions
[Quick Start prompt — already on landing page]

### Option 2: Self-hosted
```bash
npx heron-ai serve
```

### Option 3: CLI scan
```bash
npx heron-ai scan --target http://your-agent/v1/chat/completions
```

## Example Report

[Condensed example showing new format: Scope, Summary, Findings table, Remediation]

## How It Works

[Keep existing 4-step table — it's good]

## Two Modes

[Keep existing serve/scan table]

## Use Cases

[Keep existing — Security team, Team lead, Compliance]

## LLM Provider

[Keep existing auto-detect section]

## Reference

[Keep existing CLI reference in <details>]

## Architecture

[Keep existing]

## Development

[Keep existing]

## Contributing

[Add: issues, PRs welcome, link to LICENSE]

## License

MIT
```

### Key changes from current README:
1. **Add hook quote** at top
2. **Add hosted option** as fastest path (Railway URL)
3. **Reorder** to put Quick Start before How It Works
4. **Update Example Report** to show new format
5. **Add Contributing section** (minimal)
6. **Remove redundancy** — the prompt template is in Quick Start and doesn't need to be repeated

---

## Files to Modify

| File | Change |
|------|--------|
| `src/report/types.ts` | Add `classification` to `DataNeed` |
| `src/report/templates.ts` | New section order, renames, Scope & Methodology, Disclaimer |
| `src/llm/prompts.ts` | Add `classification` to analysis schema, anti-hallucination rule |
| `README.md` | Full rewrite following new structure |
| `src/server/index.ts` | Update example report in dashboard if it references old section names |

## Verification

1. Run `npm test` — all existing tests should pass
2. Start server locally (`npx tsx bin/heron.ts serve`)
3. Run a test interview against the server
4. Verify new report format renders correctly in dashboard
5. Verify markdown download has correct sections
6. Read README on GitHub and check rendering
