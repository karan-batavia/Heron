<p align="center">
  <img src="https://raw.githubusercontent.com/jonydony/Heron/main/.github/heron-logo.svg" alt="Heron" width="120" />
</p>

<h1 align="center">Heron</h1>

<p align="center">
  <strong>Open-source agent checkpoint</strong><br />
  Vet AI agents before they get production access.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#authentication">Authentication</a> •
  <a href="#server-mode">Server Mode</a> •
  <a href="#scan-mode">Scan Mode</a> •
  <a href="#example-report">Example Report</a>
</p>

---

## Why Heron?

AI agents are requesting access to production systems — CRMs, databases, APIs, internal tools. Before granting access, someone needs to answer:

- **What** does this agent actually do?
- **What data** does it need — and does it need write access?
- **What happens** if something goes wrong?

Today these questions are answered in Slack threads, docs, or not at all.

**Heron answers them automatically.** Deploy it in 5 minutes, point agents at it, get a structured audit report. No SDK integration, no code changes to the agent.

```
┌──────────┐         ┌──────────────┐         ┌──────────────┐
│          │         │              │         │              │
│  Agent   │────────>│    Heron     │────────>│  MD Report   │
│          │         │  Checkpoint  │         │              │
│          │<────────│              │         │  • Purpose   │
└──────────┘         │  Structured  │         │  • Access    │
                     │  Interview   │         │  • Risks     │
                     │              │         │  • Verdict   │
                     └──────────────┘         └──────────────┘
```

## Quick Start

### Option 1: Login + Serve (no API key in command line)

```bash
# Authenticate once (stored in ~/.heron/auth.json)
npx heron-ai login anthropic    # paste API key or Claude subscription token
npx heron-ai login openai       # opens browser — OAuth login
npx heron-ai login gemini       # API key or Google OAuth

# Start server
npx heron-ai serve
```

### Option 2: API Key

```bash
HERON_LLM_API_KEY=sk-ant-xxx npx heron-ai serve
```

### Option 3: From Source

```bash
git clone https://github.com/jonydony/Heron.git
cd Heron && npm install

# Login (one time)
npx tsx bin/heron.ts login anthropic

# Start
npx tsx bin/heron.ts serve
```

Then point your agent's base URL to `http://localhost:3700/v1` — it works as an OpenAI-compatible endpoint. The agent thinks it's talking to an LLM. Heron interviews it instead.

## How It Works

Heron acts as a **checkpoint** that any security engineer can deploy in front of AI agents:

```
Step 1: Security deploys Heron     Step 2: Agent connects

$ npx heron-ai serve               OPENAI_BASE_URL=http://heron:3700/v1
                                    your-agent start
Listening on :3700
Ready — agents can connect now      "Hello, I process invoices..."

Step 3: Heron interviews           Step 4: Report generated

"What systems do you access?"       # Agent Audit Report
"SAP, HubSpot, Stripe..."          Risk Level: HIGH
"Do you need write access?"
"Yes, to update invoices..."        Excessive: Full Stripe API access
"What happens if it fails?"         Recommendation: Use read-only key
```

### Two Modes

| Mode | Direction | Use Case |
|------|-----------|----------|
| **`serve`** | Agent → Heron | Deploy as a gate. Tell teams: "point your agent here first" |
| **`scan`** | Heron → Agent | You go to the agent and interrogate it directly |

### What Heron Asks

Structured interview across 5 categories:

1. **Purpose** — What the agent does and why
2. **Data** — What systems/data it accesses
3. **Frequency** — How often it runs, operation volume
4. **Access** — Current permissions vs actual needs
5. **Writes** — What it creates, modifies, deletes — and blast radius

After core questions, Heron generates smart follow-ups to dig deeper.

## Authentication

Heron uses an LLM under the hood to analyze agent responses and generate reports. It supports **three providers** with flexible authentication:

### Anthropic (Claude)

```bash
# Option A: API key
heron login anthropic
# → Paste your API key (sk-ant-api03-...)

# Option B: Claude subscription token (experimental)
# If you have Claude Pro/Team:
#   1. Run: claude setup-token
#   2. Paste the token (sk-ant-oat01-...)
heron login anthropic

# Option C: env var
HERON_LLM_API_KEY=sk-ant-xxx heron serve
```

### OpenAI

```bash
# Option A: OAuth — opens browser, logs in with your OpenAI account
heron login openai

# Option B: env var
HERON_LLM_API_KEY=sk-xxx heron serve --llm-provider openai --llm-model gpt-4o
```

### Google Gemini

```bash
# Option A: API key from AI Studio
heron login gemini

# Option B: Google OAuth (requires Cloud project)
heron login gemini
# → Choose 'o' for OAuth

# Option C: env var
HERON_LLM_API_KEY=AIza... heron serve --llm-provider gemini --llm-model gemini-2.0-flash
```

### Auth Status

```bash
heron auth-status
# anthropic: API Key (active) — sk-ant-api03...
# openai:    OAuth (active)   — eyJhbGciOi...
# gemini:    not configured
```

**Key resolution order:** `--llm-key` flag → `HERON_LLM_API_KEY` env → stored credential (`~/.heron/auth.json`)

## Server Mode

Deploy Heron as a server. Agents connect to an **OpenAI-compatible endpoint** — no code changes needed on the agent side.

```bash
heron serve [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `3700` |
| `-H, --host <host>` | Host to bind to | `0.0.0.0` |
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | `anthropic` |
| `--llm-model <model>` | Analysis LLM model | `claude-sonnet-4-20250514` |
| `--llm-key <key>` | LLM API key | stored / env |
| `--max-followups <n>` | Max follow-up questions | `3` |
| `--report-dir <dir>` | Where to save reports | `./reports` |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible — agents connect here |
| `/api/sessions` | GET | List all interrogation sessions |
| `/api/sessions/:id` | GET | Session details + transcript |
| `/api/sessions/:id/report` | GET | Download audit report (markdown) |
| `/health` | GET | Health check |
| `/` | GET | Dashboard |

## Scan Mode

Actively interrogate an agent by connecting to its API.

```bash
heron scan [options]
```

| Flag | Description | Default |
|------|-------------|---------|
| `-t, --target <url>` | Agent's chat API URL | required |
| `--target-type <type>` | `http` or `interactive` | `http` |
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | `anthropic` |
| `--llm-model <model>` | Analysis LLM model | `claude-sonnet-4-20250514` |
| `--llm-key <key>` | LLM API key | stored / env |
| `-o, --output <path>` | Save report to file | stdout |
| `-f, --format <fmt>` | `markdown` or `json` | `markdown` |
| `-c, --config <path>` | Config file path | — |
| `--max-followups <n>` | Max follow-up questions | `3` |
| `-v, --verbose` | Show interview details | `false` |

### Examples

```bash
# Scan an agent with an OpenAI-compatible API
heron scan --target http://agent:8080/v1/chat/completions -o report.md

# Interactive mode (paste questions to agent manually)
heron scan --target-type interactive -o report.md

# Use Gemini for analysis
heron scan --target http://agent:8080/v1/chat/completions \
  --llm-provider gemini --llm-model gemini-2.0-flash
```

## Example Report

```markdown
# Agent Audit Report

**Date**: 2026-03-26
**Risk Level**: HIGH
**Questions Asked**: 12

## Executive Summary
The agent processes customer invoices with broad access to financial systems.
Write access to Stripe is excessive — the agent only needs read access to
verify payment status.

## Access Assessment
| Resource    | Access Level | Status       | Notes                        |
|-------------|-------------|--------------|------------------------------|
| SAP ERP     | full read   | ⚠ Excessive  | Only needs PO module         |
| HubSpot CRM | admin      | ⚠ Excessive  | Only needs invoice object    |
| Stripe      | full access | ⚠ Excessive  | Only needs read access       |

## Risks
1. **[CRITICAL]** Full Stripe API access — agent could create charges
2. **[HIGH]** Excessive CRM access — agent can modify any record

## Recommendations
1. Use Stripe read-only API key
2. Restrict HubSpot to Invoice object only
3. Limit SAP access to PO module read-only
```

## Use Cases

### Security team: "vet before you deploy"

1. Deploy Heron (`docker run` or `npx heron-ai serve`)
2. Tell teams: "Before requesting production access, run your agent through Heron"
3. Agents connect, get interrogated, reports are saved
4. Security reviews reports — approves or blocks

### Team lead: "what does this agent actually do?"

1. Vendor brings an AI agent for a workflow
2. Run `heron scan --target <agent-url>`
3. Get a clear report: purpose, access needs, risks
4. Make an informed decision

### Compliance: "prove your agents are controlled"

1. Heron generates audit-ready reports for every agent
2. Reports include: scope, access assessment, risk level, full transcript
3. Attach to SOC2 / ISO 27001 / GDPR evidence

## Architecture

```
bin/heron.ts              CLI (scan / serve / login / logout / auth-status)
src/
  auth/                   Multi-provider authentication
    store.ts              Credential storage (~/.heron/auth.json)
    anthropic-token.ts    Anthropic API key / setup-token
    openai-oauth.ts       OpenAI PKCE OAuth flow
    gemini-oauth.ts       Google Gemini API key / OAuth
    index.ts              Unified auth interface
  server/
    index.ts              HTTP server with OpenAI-compatible endpoint
    sessions.ts           Session manager for concurrent interviews
  config/                 YAML config loading + Zod validation
  connectors/             Agent connection (HTTP, interactive)
  interview/              Question bank, protocol, interviewer loop
  analysis/               LLM-based transcript analysis + risk scoring
  report/                 Markdown/JSON report generation
  llm/                    Unified LLM client (Anthropic/OpenAI/Gemini)
```

## Development

```bash
npm install
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run lint          # Type check
```

## License

MIT
