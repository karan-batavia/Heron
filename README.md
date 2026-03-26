# Heron

**Open-source agent checkpoint** — know what your AI agents do before they get production access.

Heron is a lightweight, self-hosted tool that interrogates AI agents and produces clear audit reports. Security teams use it as a "gate" before granting agents access to corporate systems.

## The Problem

AI agents are requesting access to production systems — CRMs, databases, APIs, internal tools. But before granting access, someone needs answers:

- What exactly does this agent do?
- What data does it actually need?
- Does it need write access? To what?
- What are the risks if something goes wrong?

Today, these questions are answered in Slack threads, docs, or not at all. Heron answers them automatically.

## Two Modes

### Mode 1: Server — agents come to you

Deploy Heron and tell agents to connect. Works as an OpenAI-compatible endpoint — any agent can talk to it without code changes.

```bash
# Start Heron server
HERON_LLM_API_KEY=your-key npx heron-ai serve

# Point your agent to Heron (just change the base URL)
OPENAI_BASE_URL=http://localhost:3700/v1 your-agent
```

The agent thinks it's talking to an LLM. Heron asks it structured questions and produces a report.

```
Agent                           Heron Server
  |                                  |
  |  POST /v1/chat/completions       |
  |  "Hello, I process invoices"     |
  |  ─────────────────────────────>  |
  |                                  |
  |  "What systems do you access?"   |
  |  <─────────────────────────────  |
  |                                  |
  |  "SAP, HubSpot, Stripe..."      |
  |  ─────────────────────────────>  |
  |                                  |
  |  ... (9+ questions)              |
  |                                  |
  |  "Interview complete. Report:"   |
  |  <─────────────────────────────  |
  |                                  |
  |               ┌──────────────┐   |
  |               │  report.md   │   |
  |               │  Risk: HIGH  │   |
  |               └──────────────┘   |
```

### Mode 2: Scan — you go to the agent

Heron connects to an agent's API and interrogates it directly.

```bash
# Scan an agent with an OpenAI-compatible API
npx heron-ai scan --target http://your-agent:8080/v1/chat/completions \
  --llm-key $ANTHROPIC_API_KEY \
  -o report.md

# Interactive mode (you relay questions manually)
npx heron-ai scan --target-type interactive \
  --llm-key $ANTHROPIC_API_KEY \
  -o report.md
```

## Quick Start

### Option A: Server mode (recommended)

```bash
# 1. Start the server
HERON_LLM_API_KEY=sk-ant-your-key npx heron-ai serve

# 2. Test with curl
curl -s http://localhost:3700/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"I am a billing automation agent that updates invoices in QuickBooks"}]}'

# 3. View sessions
curl -s http://localhost:3700/api/sessions | jq

# 4. Get the report
curl -s http://localhost:3700/api/sessions/sess_xxxxx/report
```

Open `http://localhost:3700` in a browser to see the dashboard.

### Option B: Scan mode

```bash
npx heron-ai scan \
  --target http://your-agent:8080/v1/chat/completions \
  --llm-key $ANTHROPIC_API_KEY \
  -o report.md
```

### Option C: From source

```bash
git clone https://github.com/jonydony/Heron.git
cd Heron
npm install

# Server mode
HERON_LLM_API_KEY=your-key npx tsx bin/heron.ts serve

# Scan mode
HERON_LLM_API_KEY=your-key npx tsx bin/heron.ts scan --target http://agent:8080/v1/chat/completions
```

## Example Report

```markdown
# Agent Audit Report

**Date**: 2026-03-25
**Target**: session:sess_a1b2c3d4
**Risk Level**: HIGH
**Questions Asked**: 12

## Executive Summary
The agent processes customer invoices with broad access to financial systems.
Write access to Stripe is excessive — the agent only needs read access to
verify payment status.

## Access Assessment
| Resource    | Access Level | Status       | Notes                        |
|-------------|-------------|--------------|------------------------------|
| SAP ERP     | full read   | !! Excessive | Only needs PO module         |
| HubSpot CRM | admin      | !! Excessive | Only needs invoice object    |
| Stripe      | full access | !! Excessive | Only needs read access       |

## Risks
1. **[CRITICAL] Full Stripe API access** — Agent could create charges
2. **[HIGH] Excessive CRM access** — Agent can modify any record

## Recommendations
1. Use Stripe read-only API key
2. Restrict HubSpot to Invoice object only
3. Limit SAP access to PO module read-only
```

## Server API Reference

When running in server mode (`heron serve`):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible — agents connect here |
| `/api/sessions` | GET | List all interrogation sessions |
| `/api/sessions/:id` | GET | Session details + transcript |
| `/api/sessions/:id/report` | GET | Download audit report (markdown) |
| `/health` | GET | Health check |
| `/` | GET | Dashboard with session list |

### Session tracking

Heron returns a `heron_session_id` in the response body. Pass it as `X-Session-Id` header in subsequent requests to continue the same interview.

## CLI Reference

### `heron serve`

Start Heron as a server. Agents connect to be interrogated.

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `3700` |
| `-H, --host <host>` | Host to bind to | `0.0.0.0` |
| `--llm-provider <p>` | `anthropic` or `openai` | `anthropic` |
| `--llm-model <model>` | Analysis LLM model | `claude-sonnet-4-20250514` |
| `--llm-key <key>` | LLM API key | `$HERON_LLM_API_KEY` |
| `--max-followups <n>` | Max follow-up questions | `3` |
| `--report-dir <dir>` | Where to save reports | `./reports` |

### `heron scan`

Actively interrogate an agent by connecting to its API.

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --target <url>` | Agent's chat API URL | required |
| `--target-type <type>` | `http` or `interactive` | `http` |
| `--llm-provider <p>` | `anthropic` or `openai` | `anthropic` |
| `--llm-model <model>` | Analysis LLM model | `claude-sonnet-4-20250514` |
| `--llm-key <key>` | LLM API key | `$HERON_LLM_API_KEY` |
| `-o, --output <path>` | Save report to file | stdout |
| `-f, --format <fmt>` | `markdown` or `json` | `markdown` |
| `-c, --config <path>` | Config file path | — |
| `--max-followups <n>` | Max follow-up questions | `3` |
| `-v, --verbose` | Show interview details | `false` |

## What Heron Asks

Heron conducts a structured interview across 5 categories:

1. **Purpose** — What the agent does and why it exists
2. **Data** — What systems/data it accesses and any sensitive information
3. **Frequency** — How often it runs and how many operations it performs
4. **Access** — What permissions it has and what it actually needs
5. **Writes** — What it creates, modifies, or deletes and what happens if something goes wrong

After core questions, Heron generates smart follow-ups to dig deeper into areas of concern.

## Architecture

```
bin/heron.ts              CLI entry point (scan / serve)
src/
  index.ts                Scan pipeline: connect → interview → analyze → report
  server/
    index.ts              HTTP server with OpenAI-compatible endpoint
    sessions.ts           Session manager for concurrent agent interviews
  config/                 YAML config loading + Zod validation
  connectors/             Agent connection (HTTP, interactive)
  interview/              Question bank, protocol, interviewer loop
  analysis/               LLM-based transcript analysis + risk scoring
  report/                 Markdown/JSON report generation
  llm/                    Unified LLM client (Anthropic/OpenAI)
```

## Use Cases

### Security team: "vet before you deploy"

1. Security deploys Heron (`docker run` or `npx heron-ai serve`)
2. Tells teams: "Before requesting production access, run your agent through Heron"
3. Agents connect, get interrogated, reports are saved
4. Security reviews reports, approves or blocks access

### Team lead: "what does this agent actually do?"

1. Vendor brings an AI agent for a workflow
2. Team lead runs `heron scan --target <agent-url>`
3. Gets a clear report: purpose, access needs, risks, recommendations
4. Makes an informed decision

### Compliance: "prove your agents are controlled"

1. Heron generates audit-ready reports for every agent
2. Reports include: scope, access assessment, risk level, transcript
3. Attach to SOC2/GDPR evidence

## Development

```bash
npm install
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run lint          # Type check
```

## License

MIT
