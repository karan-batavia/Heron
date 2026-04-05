<p align="center">
  <img src=".github/heron-logo.svg" alt="Heron" width="80" />
</p>

<h1 align="center">Heron</h1>

<p align="center">
  <strong>Open-source AI agent auditor</strong><br />
  Know what your AI agents actually access before they go to production.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#how-it-works">How It Works</a> &bull;
  <a href="#example-report">Example Report</a> &bull;
  <a href="#use-cases">Use Cases</a>
</p>

---

> You wouldn't give a contractor the keys to your office without checking their ID.
> Why give an AI agent production access without an audit?

## Why Heron?

AI agents are requesting access to production systems &mdash; CRMs, databases, APIs, internal tools. Before granting access, someone needs to answer:

- **What** does this agent actually do in this specific project?
- **What data** does it handle &mdash; and does it need write access?
- **What happens** if something goes wrong?

Today these questions are answered in Slack threads, docs, or not at all.

**Heron answers them automatically.** Point agents at it, get a structured audit report. No SDK integration, no code changes to the agent.

```
┌──────────┐         ┌──────────────┐         ┌──────────────┐
│          │         │              │         │              │
│  Agent   │────────>│    Heron     │────────>│ Audit Report │
│          │         │              │         │              │
│          │<────────│  Structured  │         │  Findings    │
└──────────┘         │  Interview   │         │  Systems     │
                     │  (10 core +  │         │  Regulatory  │
                     │  follow-ups) │         │  Verdict     │
                     └──────────────┘         └──────────────┘
```

## Quick Start

### Option 1: Interactive CLI

```bash
git clone https://github.com/jonydony/Heron.git
cd Heron && npm install

export HERON_LLM_API_KEY=sk-xxx  # Anthropic, OpenAI, or Gemini key — auto-detected

npx heron-ai
```

An interactive menu lets you choose:

```
  Heron — AI Agent Auditor

  > Start server    agents connect to you
    Scan an agent   you connect to an agent
```

### Option 2: Use the hosted version

Paste this into your AI agent's chat:

```
I need you to complete a security access review for this project.
Make sequential API calls to the Heron endpoint until it says "Interview complete".

Step 1 — Start the interview:
POST https://heron-open-source-production.up.railway.app/v1/chat/completions
Body: {"model":"any","messages":[{"role":"user","content":"Hi, I am ready to answer questions about this project."}]}

The response will contain a question and a session ID (in the text and in the "heron_session_id" JSON field).

Step 2 — Send each answer:
POST https://heron-open-source-production.up.railway.app/v1/chat/completions
Body: {"model":"any","messages":[{"role":"user","content":"YOUR ANSWER HERE"}],"heron_session_id":"SESSION_ID_FROM_STEP_1"}

Step 3 — Repeat step 2 with each new answer until the response says "Interview complete".

Important: answer about THIS specific project — what you actually do, what systems
you connect to, what data you handle. Not general capabilities. Never reveal actual
secret values — just describe credential types.
```

View reports at: https://heron-open-source-production.up.railway.app

### Option 3: OPENAI_BASE_URL

Redirect any OpenAI-compatible agent to Heron without changing the agent's code:

```bash
OPENAI_BASE_URL=http://localhost:3700/v1 python your_agent.py
```

The agent thinks it's talking to GPT. Heron intercepts, runs the interview, generates a report.

### Option 4: Claude Code skill (zero setup)

If you use [Claude Code](https://claude.ai/code), install the `/heron-audit` skill:

```bash
bash Heron/skills/heron-audit/install.sh
```

Then in any project:

```
/heron-audit
```

Claude interviews itself about the current project and generates an audit report.

## How It Works

<table>
<tr>
<td width="50%">

**Step 1 — Start Heron**

One command. Interactive menu or direct flags.

</td>
<td width="50%">

```bash
$ npx heron-ai

  Heron — AI Agent Auditor

  > Start server    agents connect to you
    Scan an agent   you connect to an agent
```

</td>
</tr>
<tr>
<td>

**Step 2 — Agent connects**

Heron speaks OpenAI-compatible API. No SDK, no code changes needed.

</td>
<td>

```bash
# Paste the prompt into agent's chat
# Or redirect the base URL:
OPENAI_BASE_URL=http://localhost:3700/v1 \
  your-agent start
```

</td>
</tr>
<tr>
<td>

**Step 3 — Structured interview**

10 core questions, each targeting a compliance field. Smart follow-ups probe vague answers. Format examples guide the agent to give concrete, structured responses.

</td>
<td>

```
Heron: "List every system you connect to.
       Format: Name → API type → Auth method
       Example: Google Sheets → REST API → OAuth2"

Agent: "HubSpot → REST API → OAuth2
        PostgreSQL → Direct TCP → Password
        Slack → Bot API → Bot token"
```

</td>
</tr>
<tr>
<td>

**Step 4 — Report generated**

Per-system access cards, findings with IDs, risk scoring, regulatory flags, and actionable recommendations.

</td>
<td>

```
  Audit complete: sess_abc123
  Risk:         MEDIUM
  Data quality: 100/100
  Verdict:      APPROVE WITH CONDITIONS
  Findings:     4
  Report:       ./reports/sess_abc123.md
  Dashboard:    http://localhost:3700/sessions/sess_abc123
```

</td>
</tr>
</table>

### Interview Protocol

10 structured questions targeting compliance fields, plus LLM-generated follow-ups:

| # | Question | Compliance Field |
|---|----------|-----------------|
| 1 | Deployment profile (project name, owner, trigger) | Agent identity |
| 2 | Permissions and scopes per system | `scopesRequested` |
| 3 | Systems enumeration (Name &rarr; API &rarr; Auth) | `systemId` |
| 4 | Data sensitivity per system (PII/financial/confidential) | `dataSensitivity` |
| 5 | Detailed permissions | Access assessment |
| 6 | Data read operations and classification | Data inventory |
| 7 | Reversibility of operations | `reversibility` |
| 8 | Write operations (Action &rarr; Target &rarr; Reversible? &rarr; Volume) | `writeOperations` |
| 9 | Blast radius (records/users affected if write fails) | `blastRadius` |
| 10 | Frequency and volume (runs/week, API calls/run) | `frequencyAndVolume` |
| +  | Unused permissions, worst-case failure, decision-making about people | Excess access, risk, regulatory |

Follow-ups are generated when answers are vague or compliance fields are missing (up to 6 per interview).

### Report Structure

1. **Executive Summary** &mdash; dashboard table (risk / systems / findings)
2. **Agent Profile** &mdash; purpose, trigger, owner, frequency
3. **Findings** &mdash; severity-ranked with IDs (HERON-001, ...), split description and recommendation
4. **Systems & Access** &mdash; per-system cards with risk rating, scopes, data, writes, blast radius
5. **What's Working Well** &mdash; positive findings
6. **Verdict & Recommendations** &mdash; APPROVE / APPROVE WITH CONDITIONS / DENY
7. **Regulatory Compliance** &mdash; EU (AI Act + GDPR), US (SOC 2 + state AI laws), UK (UK GDPR + ICO)
8. **Data Quality** &mdash; field-by-field coverage score, repeated answer warnings
9. **Interview Transcript** &mdash; full Q&A for manual review

## Example Report

<details>
<summary>Expand example: CRM sync agent audit</summary>

```markdown
# Agent Access Audit Report

**Generated**: 2026-04-05 | **Agent**: SalesSync | **Risk Level**: HIGH
**Data Quality**: 83/100
**Regulatory**: EU: Review | US: Review | UK: Review

---

## Executive Summary

| Risk | Systems | Findings |
|------|---------|----------|
| **HIGH** | 3 | 1 Critical, 1 High, 2 Medium |

SalesSync syncs contact and deal data between HubSpot CRM and an internal
PostgreSQL database, and sends Slack notifications on deal stage changes.

---

## Findings

| ID | Severity | Finding | Description | Recommendation |
|----|----------|---------|-------------|----------------|
| HERON-001 | CRITICAL | Bulk update risk | Can overwrite all ~15,000 contacts | Add validation + staged rollout |
| HERON-002 | HIGH | Sensitive data writable | PII + financial in PostgreSQL | Restrict to needed columns |
| HERON-003 | MEDIUM | Excessive HubSpot scope | deals.write granted but unused | Revoke unused scope |
| HERON-004 | MEDIUM | Irreversible Slack messages | Deal notifications can't be recalled | Add pre-send validation |

---

## Systems & Access

### HubSpot CRM → REST API → OAuth2 — Risk: HIGH

| | |
|---|---|
| **Scopes granted** | contacts.read, contacts.write, deals.read, deals.write |
| **Excessive** | deals.write (never used) |
| **Data** | PII + financial |
| **Blast radius** | org-wide (~15,000 records) |

---

## Verdict: APPROVE WITH CONDITIONS
```

</details>

## Use Cases

**Security team: "vet before you deploy"** &mdash; Deploy Heron as a gate. Agents must pass an audit before getting production access. Review structured reports with findings, risk levels, and recommendations.

**Team lead: "what does this agent actually do?"** &mdash; Paste the prompt into the agent's chat. Get a clear breakdown of systems, data, permissions, and blast radius.

**Compliance: "prove your agents are controlled"** &mdash; Heron generates audit-ready reports with regulatory flags for EU AI Act, GDPR, SOC 2, and UK GDPR. Attach to compliance evidence packages.

## Two Modes

| Mode | Command | Direction | Use Case |
|------|---------|-----------|----------|
| **Server** | `serve` | Agent &rarr; Heron | Deploy as a gate. Agents connect to Heron |
| **Scan** | `scan` | Heron &rarr; Agent | Connect to an agent's API and interrogate it |

## LLM Provider

Heron auto-detects the provider from your API key:

| Key prefix | Provider | Default model |
|------------|----------|---------------|
| `sk-ant-` | Anthropic | claude-sonnet-4 |
| `sk-` | OpenAI | gpt-5.4-mini |
| `AIza` | Gemini | gemini-2.0-flash |

```bash
export HERON_LLM_API_KEY=sk-xxx   # that's it — provider and model auto-selected
```

Override with `--llm-provider` and `--llm-model` if needed.

## Reference

<details>
<summary>Server Mode &mdash; <code>heron serve</code></summary>

```bash
npx heron-ai serve [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `3700` |
| `-H, --host <host>` | Host to bind to | `0.0.0.0` |
| `--llm-key <key>` | LLM API key | `HERON_LLM_API_KEY` env |
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | auto-detect |
| `--llm-model <model>` | Analysis LLM model | auto per provider |
| `--max-followups <n>` | Max follow-up questions | `3` |
| `--report-dir <dir>` | Where to save reports | `./reports` |

**API Endpoints**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible &mdash; agents connect here |
| `/api/sessions` | GET | List all sessions (JSON) |
| `/api/sessions/:id` | GET | Session details + transcript |
| `/api/sessions/:id/report` | GET | Download audit report (markdown) |
| `/` | GET | Dashboard |

</details>

<details>
<summary>Scan Mode &mdash; <code>heron scan</code></summary>

```bash
npx heron-ai scan [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --target <url>` | Agent's chat API URL | required |
| `--llm-key <key>` | LLM API key | `HERON_LLM_API_KEY` env |
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | auto-detect |
| `--llm-model <model>` | Analysis LLM model | auto per provider |
| `-o, --output <path>` | Save report to file | `./reports/scan_xxx.md` |
| `--max-followups <n>` | Max follow-up questions | `3` |
| `--report-dir <dir>` | Where to save reports | `./reports` |

</details>

## Architecture

```
bin/heron.ts              CLI entry point (interactive menu, scan, serve)
src/
  server/
    index.ts              HTTP server + dashboard + OpenAI-compatible endpoint
    sessions.ts           Session manager with follow-ups and async analysis
  interview/
    questions.ts          10 structured questions (one per compliance field)
    protocol.ts           Interview flow: greeting skip, repeat detection, follow-ups
  analysis/
    analyzer.ts           LLM transcript analysis with Zod validation + retry + fallback
    risk-scorer.ts        Rubric-driven risk scoring from structured per-system data
  report/
    generator.ts          Regulatory compliance flags (EU/US/UK) + report assembly
    templates.ts          Markdown report: per-system cards, findings, positive findings
    types.ts              Zod schemas for SystemAssessment, AuditReport, RegulatoryFlags
  llm/
    client.ts             Unified LLM client (Anthropic/OpenAI/Gemini, auto-detect)
    prompts.ts            Interview + analysis prompts with anti-hallucination rules
  connectors/             Agent connection (HTTP, interactive)
  config/                 YAML config loading + Zod validation
```

## Development

```bash
git clone https://github.com/jonydony/Heron.git
cd Heron && npm install

# Run locally
HERON_LLM_API_KEY=sk-xxx npx heron-ai serve

# Tests
npm test
```

## Contributing

Issues and PRs welcome.

## License

[MIT](LICENSE)
