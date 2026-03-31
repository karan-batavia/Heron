# Heron v2 — Status Report (2026-03-31)

## What we built

Heron is an open-source agent access auditor. It interviews AI agents about their specific deployment — what systems they connect to, what data they handle, what permissions they have — and generates a compliance-grade audit report.

### Architecture
- **Interview protocol**: 9 structured template questions (one per compliance field), funnel order from identity to risk assessment
- **LLM analysis**: Transcript → GPT-5.4-mini → structured JSON → Zod validation → report
- **Server**: OpenAI-compatible `/v1/chat/completions` endpoint, agents connect as if talking to an LLM
- **Dashboard**: Session list, per-session report with data quality badge, download as markdown

## Testing results

### Agents tested

| Agent | Sessions | Data Quality | Risk | Analysis | Notes |
|-------|----------|-------------|------|----------|-------|
| **Theona** (LinkedIn ICP scanner) | 2 complete | 82/100 | MEDIUM | OK | Excellent answers. OAuth scopes, PII classification, blast radius all provided. Initially refused (prompt injection detection), then cooperated with Quick Start prompt. |
| **Codex** (OpenAI, code review agent) | 2 complete | 100/100 | MEDIUM | OK | Gave detailed deployment-specific answers about Google Sheets, Drive, Gemini, Gamma, Telegram integrations. |

### Bugs found and fixed

| Bug | Cause | Fix |
|-----|-------|-----|
| **Session leak** — each retry created a new session | No session reuse when ID provided with empty messages | Reuse existing session when valid ID comes in |
| **Download button broken** | Missing `Content-Disposition: attachment` header | Added header |
| **Q1 records greeting as answer** | "Hi, I am ready" stored as real data | Greeting detection + re-ask Q1 |
| **LLM analysis hallucinated** OAuth scopes, volumes | No anti-hallucination rules in prompt | Added "ONLY use data from transcript, write NOT PROVIDED otherwise" |
| **Report unreadable** — 6-column tables | Markdown tables too wide | Replaced with per-system cards |
| **Duplicate sections** — Recommendation + Recommendations | Two separate render functions | Merged into "Verdict & Recommendations" |
| **Agent gives canned/repeated answers** | Codex script repeated same phrase 8/12 times | Repeat detection + [REPEATED RESPONSE] tag |
| **500 error on report generation** | LLM analysis blocked the HTTP response, Railway timeout | Made analysis async (background), return "Interview complete" immediately |
| **Analysis JSON parse failures** | gpt-4o-mini couldn't produce valid JSON, strict Zod rejected partial matches | Forgiving Zod (normalize severity/blast radius), extract JSON from mixed text, switched to gpt-5.4-mini |
| **Blockquote not rendering** | `markdownToHtml` didn't handle `>` | Added blockquote, unordered list, italic rendering |
| **"Unknown — analysis failed" fake system** | Fallback created a fake SystemAssessment | Fallback now shows empty systems list + useful summary |
| **max_tokens truncating analysis** | 8192 token output limit, JSON cut mid-response | Raised to 65536 (Anthropic/Gemini), unlimited (OpenAI) |
| **Risks "Fix:" detached from bullet** | Nested list item not rendered correctly | Made mitigation inline |
| **Permissions delta shows NOT PROVIDED** | LLM writes "NOT PROVIDED" as a scope entry | Filter out NOT PROVIDED from delta display |

### Known issues (not yet fixed)

| Issue | Impact | Proposed fix |
|-------|--------|-------------|
| **Codex creates 3+ sessions per interview** | Orphaned "interviewing" sessions on dashboard | Codex retries on empty response/timeout and creates new session each time. Need: (a) better error responses so Codex doesn't retry, (b) session cleanup for stale sessions |
| **Q1 re-asked as Q2** | Wasted question slot, [REPEATED RESPONSE] tag | Greeting detection works but agent gives same answer again. Consider not re-asking Q1 — just use the greeting as intro and start from Q2 |
| **400 errors from OpenAI** | First analysis attempt fails, retry succeeds | Transient OpenAI API issue. Retry already handles it. Could add better request sanitization. |

## Section order (current)

1. Executive Summary
2. Agent Profile
3. Risks
4. Systems & Access (per-system cards)
5. Verdict & Recommendations
6. Data Quality
7. Interview Transcript (collapsed)
8. Footer

## Codex session creation issue — analysis

From Codex logs, the retry pattern is:
1. Codex sends first request → gets session ID + Q1
2. Shell quoting issue or empty response → Codex thinks it failed
3. Codex creates new session instead of retrying on same session
4. Repeated 2-3 times before stabilizing

Root causes:
- Codex wraps API calls in shell scripts with fragile quoting
- When a response is empty or slow, Codex restarts with a fresh `POST` (no session ID)
- Each fresh POST = new session

Potential fixes:
- Return more explicit error messages (not just empty body)
- Add session TTL/cleanup (auto-delete sessions with <3 questions after 10 min)
- Make the Quick Start prompt tell the agent to always reuse the same session ID
