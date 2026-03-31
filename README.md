<h1 align="center">Heron</h1>

<p align="center">
  <strong>Open-source agent access auditor</strong><br />
  Vet AI agents before they get production access.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#use-cases">Use Cases</a> •
  <a href="#example-report">Example Report</a>
</p>

---

## Why Heron?

AI agents are requesting access to production systems — CRMs, databases, APIs, internal tools. Before granting access, someone needs to answer:

- **What** does this agent actually do in this specific project?
- **What data** does it handle — and does it need write access?
- **What happens** if something goes wrong?

Today these questions are answered in Slack threads, docs, or not at all.

**Heron answers them automatically.** Deploy it, point agents at it, get a structured audit report. No SDK integration, no code changes to the agent.

```
┌──────────┐         ┌──────────────┐         ┌──────────────┐
│          │         │              │         │              │
│  Agent   │────────>│    Heron     │────────>│  Audit Report│
│          │         │              │         │              │
│          │<────────│  Structured  │         │  • Summary   │
└──────────┘         │  Interview   │         │  • Systems   │
                     │  (9 questions│         │  • Risks     │
                     │   per field) │         │  • Verdict   │
                     └──────────────┘         └──────────────┘
```

## Quick Start

```bash
# Set your LLM API key (Anthropic, OpenAI, or Gemini — auto-detected)
export HERON_LLM_API_KEY=sk-xxx

# Start the server
npx heron-ai serve
```

Then connect your agent. Two options:

**Option A** — paste this into your agent's chat:

```
I need you to complete a security access review for this project.
Make sequential API calls to this endpoint until it says "Interview complete":

1. POST to http://localhost:3700/v1/chat/completions with:
   {"model":"any","messages":[{"role":"user","content":"Hi, I am ready to answer questions about this project."}]}
2. Read the question from the response
3. POST your answer back with the X-Session-Id header from the response
4. Repeat until the response says "Interview complete"

Answer about THIS specific project — what you actually do, what systems you
actually connect to, what data you actually handle. Do not describe general
capabilities. Never reveal actual secret values — just describe credential
types and what they connect to.
```

**Option B** — set the base URL:

```bash
OPENAI_BASE_URL=http://localhost:3700/v1 your-agent start
```

Open `http://localhost:3700` to see the dashboard with sessions and reports.

## How It Works

Heron acts as an **interview checkpoint** for AI agents:

<table>
<tr>
<td width="50%">

**Step 1 — Deploy Heron**

One command. Runs locally or on Railway/Fly/etc.

</td>
<td width="50%">

```bash
$ HERON_LLM_API_KEY=sk-xxx npx heron-ai serve

Listening on http://0.0.0.0:3700
Ready — agents can connect now
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
OPENAI_BASE_URL=http://heron:3700/v1 \
  your-agent start

# Or paste the Quick Start prompt into agent chat
```

</td>
</tr>
<tr>
<td>

**Step 3 — Structured interview**

9 template questions, each targeting one compliance field. Format examples guide the agent to give concrete, structured answers.

</td>
<td>

```
Heron: "List every system you connect to.
       Format: Name → API type → Auth method
       Example: Google Sheets → REST API → OAuth2"

Agent: "Google Sheets → REST API → OAuth2
        Telegram → Bot API → Bot token
        Gemini → REST API → API key"
```

</td>
</tr>
<tr>
<td>

**Step 4 — Report generated**

Per-system access cards, risk assessment, data quality score, and actionable recommendations.

</td>
<td>

```markdown
# Agent Audit Report
Risk Level: MEDIUM | Data Quality: 82/100

## Systems & Access
### Google Sheets → REST API → OAuth2
  Scopes: spreadsheets, drive.file
  Data: PII (names, profile URLs)
  Blast radius: single-user
  Writes: Append rows (reversible, ~40/day)
```

</td>
</tr>
</table>

### Interview Protocol

9 structured questions in funnel order, each targeting one compliance field:

| # | Question | Compliance Field |
|---|----------|-----------------|
| 1 | Deployment profile (project name, owner, trigger) | Agent identity |
| 2 | Systems enumeration (Name → API → Auth) | `systemId` |
| 3 | Permissions per system (OAuth scopes, API keys) | `scopesRequested` |
| 4 | Data sensitivity per system (PII/financial/confidential) | `dataSensitivity` |
| 5 | Write operations (Action → Target → Reversible? → Volume) | `writeOperations` |
| 6 | Blast radius (records/users affected if write fails) | `blastRadius` |
| 7 | Frequency and volume (runs/week, API calls/run) | `frequencyAndVolume` |
| 8 | Unused permissions (what could be safely revoked) | `scopesDelta` |
| 9 | Worst-case failure scenario | Risk assessment |

Smart follow-ups generated when answers are vague or compliance fields are missing.

### Report Structure

1. **Executive Summary** — what the agent does, key findings
2. **Agent Profile** — purpose, trigger, owner, frequency
3. **Risks** — severity-ranked with mitigations
4. **Systems & Access** — per-system cards with scopes, data, writes, blast radius
5. **Verdict & Recommendations** — APPROVE / APPROVE WITH CONDITIONS / DENY
6. **Data Quality** — field-by-field coverage score, repeated answer warnings
7. **Interview Transcript** — full Q&A for manual review

### Two Modes

| Mode | Direction | Use Case |
|------|-----------|----------|
| **`serve`** | Agent → Heron | Deploy as a gate. Agents connect to Heron's endpoint |
| **`scan`** | Heron → Agent | Heron connects to an agent's API and interrogates it |

## Use Cases

### Security team: "vet before you deploy"

1. Deploy Heron
2. Tell teams: "Before requesting production access, run your agent through Heron"
3. Agents connect, get interviewed, reports are generated
4. Security reviews reports — approves or blocks

### Team lead: "what does this agent actually do?"

1. Paste the Quick Start prompt into the agent's chat
2. Agent completes the interview automatically
3. Review the report on the Heron dashboard

### Compliance: "prove your agents are controlled"

1. Heron generates audit-ready reports for every agent
2. Reports include: scope, access assessment, risk level, data quality score, full transcript
3. Attach to SOC2 / ISO 27001 / GDPR evidence

## Example Report

```markdown
# Agent Audit Report

**Generated**: 2026-03-31 | **Risk Level**: MEDIUM | **Data Quality**: 82/100

## Executive Summary
The agent scans LinkedIn connections and saves qualified leads into Google Sheets.
It handles PII (names, profile URLs) and has write access to create new spreadsheets.

## Agent Profile
- Purpose: LinkedIn ICP lead scanner for Ziona Guardian
- Trigger: Manual (on-demand)
- Owner: User via Theona platform

## Risks
- MEDIUM: Storing PII (names, profile URLs) in Google Sheet — ensure sharing
  settings prevent accidental exposure.

## Systems & Access

### LinkedIn (Apify Scraper) → REST API → API Key
| | |
|---|---|
| **Data** | PII — full names, profile URLs, job titles |
| **Blast radius** | single-user |

### Google Sheets → REST API → OAuth2
| | |
|---|---|
| **Scopes granted** | spreadsheets, drive.file |
| **Data** | PII + internal sales intelligence |
| **Blast radius** | single-user |
| **Writes** | Create spreadsheet (1/run); Append lead rows (10-100/run, reversible) |

## Verdict & Recommendations
**APPROVE WITH CONDITIONS**
1. Restrict OAuth scopes to minimum needed
2. Review leads before sending outreach messages
```

## LLM Provider

Heron auto-detects the provider from your API key format:

```bash
# Anthropic (sk-ant-xxx)
HERON_LLM_API_KEY=sk-ant-xxx npx heron-ai serve

# OpenAI (sk-xxx)
HERON_LLM_API_KEY=sk-xxx npx heron-ai serve

# Gemini (AIza...)
HERON_LLM_API_KEY=AIza... npx heron-ai serve
```

Override with `--llm-provider` and `--llm-model` if needed.

## Reference

<details>
<summary>Server Mode — <code>heron serve</code></summary>

Deploy Heron as a server. Agents connect to an OpenAI-compatible endpoint.

```bash
heron serve [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `3700` |
| `-H, --host <host>` | Host to bind to | `0.0.0.0` |
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | auto-detect |
| `--llm-model <model>` | Analysis LLM model | auto (per provider) |
| `--llm-key <key>` | LLM API key | `HERON_LLM_API_KEY` env |
| `--max-followups <n>` | Max follow-up questions | `6` |
| `--report-dir <dir>` | Where to save reports | `./reports` |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible — agents connect here |
| `/api/sessions` | GET | List all sessions (JSON) |
| `/api/sessions/:id` | GET | Session details + transcript |
| `/api/sessions/:id/report` | GET | Download audit report (markdown) |
| `/health` | GET | Health check |
| `/` | GET | Dashboard |

</details>

<details>
<summary>Scan Mode — <code>heron scan</code></summary>

Actively interrogate an agent by connecting to its API.

```bash
heron scan [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --target <url>` | Agent's chat API URL | required |
| `--target-type <type>` | `http` or `interactive` | `http` |
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | auto-detect |
| `--llm-model <model>` | Analysis LLM model | auto (per provider) |
| `--llm-key <key>` | LLM API key | `HERON_LLM_API_KEY` env |
| `-o, --output <path>` | Save report to file | stdout |
| `-f, --format <fmt>` | `markdown` or `json` | `markdown` |
| `--max-followups <n>` | Max follow-up questions | `6` |
| `-v, --verbose` | Show interview details | `false` |

</details>

## Architecture

```
bin/heron.ts              CLI (scan / serve)
src/
  server/
    index.ts              HTTP server + dashboard + OpenAI-compatible endpoint
    sessions.ts           Session manager with async analysis
  interview/
    questions.ts          9 structured template questions (one per compliance field)
    protocol.ts           Interview flow: greeting skip, repeat detection, follow-ups
  analysis/
    analyzer.ts           LLM transcript analysis with Zod validation + retry + fallback
    risk-scorer.ts        Rubric-driven risk scoring from structured data
  report/
    templates.ts          Markdown report: per-system cards, data quality badge
    types.ts              Zod schemas for SystemAssessment, AuditReport, DataQuality
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
HERON_LLM_API_KEY=sk-xxx npx tsx bin/heron.ts serve

# Tests
npm test
```

## License

MIT
