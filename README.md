<h1 align="center">Heron</h1>

<p align="center">
  <strong>Open-source agent checkpoint</strong><br />
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

```bash
# Set your LLM API key
export HERON_LLM_API_KEY=sk-ant-xxx

# Start the checkpoint server
npx heron-ai serve
```

Or with Docker:

```bash
docker run -p 3700:3700 -e HERON_LLM_API_KEY=sk-xxx ghcr.io/jonydony/heron
```

Then give your agent this prompt (or paste it into any AI chat):

```
Connect to the Heron checkpoint at https://your-heron-url.up.railway.app/v1/chat/completions

Send a POST request with your introduction as a JSON body:
{"messages": [{"role": "user", "content": "Hi, I am [describe your agent]. I [what you do]."}]}

Heron will ask you questions. Answer each one, sending your response in the same format.
Include the header X-Session-Id from the first response to continue the conversation.
When the interview is done, Heron returns your audit report.
```

Or if the agent supports `OPENAI_BASE_URL`, just set it:

```bash
OPENAI_BASE_URL=https://your-heron-url.up.railway.app/v1 your-agent start
```

## How It Works

Heron acts as a **checkpoint** that any security engineer can deploy in front of AI agents:

<table>
<tr>
<td width="50%">

**Step 1 — Deploy Heron**

Security engineer starts Heron in one command.

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

Point any agent's base URL to Heron. No SDK, no code changes — it speaks OpenAI-compatible API.

</td>
<td>

```bash
OPENAI_BASE_URL=http://heron:3700/v1 \
  your-agent start

# Agent: "Hello, I process invoices..."
```

</td>
</tr>
<tr>
<td>

**Step 3 — Heron interviews**

Structured questions about purpose, data access, permissions, and writes.

</td>
<td>

```
Heron: "What systems do you access?"
Agent: "SAP, HubSpot, Stripe..."

Heron: "Do you need write access?"
Agent: "Yes, to update invoices..."

Heron: "What happens if it fails?"
Agent: "Duplicate charges could..."
```

</td>
</tr>
<tr>
<td>

**Step 4 — Report generated**

Markdown audit report with risk level, excessive permissions, and actionable recommendations.

</td>
<td>

```markdown
# Agent Audit Report
Risk Level: HIGH

Excessive: Full Stripe API access
Excessive: HubSpot admin rights

Recommendations:
1. Use Stripe read-only API key
2. Restrict HubSpot to invoices only
```

</td>
</tr>
</table>

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
| SAP ERP     | full read   | Excessive    | Only needs PO module         |
| HubSpot CRM | admin      | Excessive    | Only needs invoice object    |
| Stripe      | full access | Excessive    | Only needs read access       |

## Risks
1. **[CRITICAL]** Full Stripe API access — agent could create charges
2. **[HIGH]** Excessive CRM access — agent can modify any record

## Recommendations
1. Use Stripe read-only API key
2. Restrict HubSpot to Invoice object only
3. Limit SAP access to PO module read-only
```

## LLM Provider

Heron uses an LLM to analyze agent responses and generate reports. Here are examples with the most popular providers:

```bash
# Anthropic (default)
HERON_LLM_API_KEY=sk-ant-xxx npx heron-ai serve

# OpenAI
HERON_LLM_API_KEY=sk-xxx npx heron-ai serve --llm-provider openai --llm-model gpt-4o-mini

# Gemini
HERON_LLM_API_KEY=AIza... npx heron-ai serve --llm-provider gemini --llm-model gemini-2.0-flash
```

Use `--llm-provider` and `--llm-model` to pick any model you prefer.

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
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | `anthropic` |
| `--llm-model <model>` | Analysis LLM model | `claude-sonnet-4-20250514` |
| `--llm-key <key>` | LLM API key | `HERON_LLM_API_KEY` env |
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
| `--llm-provider <p>` | `anthropic`, `openai`, or `gemini` | `anthropic` |
| `--llm-model <model>` | Analysis LLM model | `claude-sonnet-4-20250514` |
| `--llm-key <key>` | LLM API key | `HERON_LLM_API_KEY` env |
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
```

</details>

## Architecture

```
bin/heron.ts              CLI (scan / serve)
src/
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
git clone https://github.com/jonydony/Heron.git
cd Heron && npm install

# Run locally
HERON_LLM_API_KEY=sk-xxx npx tsx bin/heron.ts serve

# Tests
npm test
npm run test:watch
npm run lint
```

## License

MIT
