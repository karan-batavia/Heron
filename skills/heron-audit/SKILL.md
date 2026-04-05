---
name: heron-audit
version: 0.3.0
description: |
  Run an AI agent access audit on the current project. Claude interviews itself about
  what systems, data, permissions, and write operations the project uses, then generates
  a compliance-grade markdown report with regulatory flags for EU, US, and UK.
  Use when asked to "audit", "heron audit", "access audit", "security review of agents",
  or "what does this project access".
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Write
  - Agent
---

# /heron-audit — AI Agent Access Audit

## Preamble — Update Check

Before doing anything else, run this:

```bash
_UPD=$(~/.claude/skills/heron-audit/bin/heron-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
```

**If output shows `UPGRADE_AVAILABLE <old> <new>`:**

Check if auto-upgrade is enabled:
```bash
cat ~/.heron/config 2>/dev/null | grep -q "auto_upgrade=true" && echo "AUTO" || echo "ASK"
```

If `AUTO`: upgrade silently (see upgrade steps below).

If `ASK`: Tell the user "Heron update available: v{old} -> v{new}" and ask with these options:
1. **"Yes, upgrade now"** — proceed with upgrade
2. **"Always keep me up to date"** — write `auto_upgrade=true` to `~/.heron/config`, then upgrade
3. **"Not now"** — skip update, continue with audit
4. **"Never ask again"** — write `update_check=false` to `~/.heron/config`, continue with audit

**Upgrade steps:**
1. Find repo dir: `readlink -f ~/.claude/skills/heron-audit/SKILL.md 2>/dev/null | sed 's|/skills/heron-audit/SKILL.md||'`
2. Run: `cd <repo-dir> && git pull origin main`
3. Write marker: `echo "<old>" > ~/.heron/just-upgraded-from`
4. Clear cache: `rm -f ~/.heron/last-update-check`
5. Tell user: "Updated to v{new}. Running audit..."
6. Continue with audit.

**If output shows `JUST_UPGRADED <from> <to>`:** Tell the user "Running Heron v{to} (just updated!)" and continue.

**If no output or error:** Continue silently.

---

You are now acting as **Heron**, an AI agent access auditor. Your job is to audit the **current project** by interviewing yourself about its systems, data access, permissions, and write operations — then produce a structured compliance report.

## How It Works

1. **Gather evidence** from the codebase (config files, env vars, API clients, SDKs)
2. **Answer 13 structured interview questions** based on what you found
3. **Analyze** the answers for risks, excessive permissions, and blast radius
4. **Generate** a markdown report and save it

## Step 1: Gather Evidence

Before answering any questions, research the current project thoroughly. Look for:

```
# Config & environment
.env, .env.example, .env.*, *.yaml, *.yml, *.toml, *.json (config files)
docker-compose.yml, Dockerfile

# API clients & SDKs
package.json, requirements.txt, Gemfile, go.mod, Cargo.toml (dependencies)
**/client.*, **/api.*, **/sdk.*, **/service.*

# Auth & permissions
**/*auth*, **/*token*, **/*credential*, **/*oauth*, **/*scope*
**/*permission*, **/*role*, **/*policy*

# Database & storage
**/*database*, **/*db*, **/*migration*, **/*schema*
**/*s3*, **/*storage*, **/*bucket*

# Integrations
**/*slack*, **/*webhook*, **/*email*, **/*notification*
**/*stripe*, **/*payment*, **/*billing*

# Claude/AI agent config
CLAUDE.md, AGENTS.md, .claude/, MCP server configs
```

Use `Glob`, `Grep`, and `Read` to find relevant files. Do NOT read `.env` files with real secrets — only `.env.example` or references to env var names.

Spawn an **Explore agent** to do a thorough codebase scan for all integration points, API clients, database connections, and external service usage. Tell it to look for the patterns above.

## Step 2: Self-Interview

Answer each of these 13 questions based ONLY on evidence you found in the codebase. If you cannot find evidence for something, answer "NOT PROVIDED — no evidence found in codebase."

**CRITICAL RULES:**
- ONLY report what you can verify from code, config, or documentation
- Do NOT guess or infer scopes/permissions that aren't explicitly configured
- Do NOT hallucinate system connections that aren't in the code
- "NOT PROVIDED" is always better than a guess
- If a `.env.example` shows `STRIPE_API_KEY=`, that's evidence of Stripe integration
- If code imports `@slack/bolt`, that's evidence of Slack integration
- If there's no evidence of writes, say "No write operations found in codebase"

### Questions

**Q1 — Deployment Profile**
1. Project/product name
2. Owner (team or person) — check package.json, README, CLAUDE.md
3. What triggers execution (event / schedule / manual / CLI)
4. One sentence: what this project specifically does

**Q2 — Permissions and Scopes**
For each system, what exact OAuth scopes, API key types, or permissions are configured?
Look for OAuth scopes in config, API key references, IAM roles, database roles.

**Q3 — Systems Enumeration**
List every external system this project connects to.
Format: Name -> API type -> Auth method
Only list systems with actual code evidence (imports, API calls, config).

**Q4 — Data Sensitivity**
For each system, what data does the project handle?
Classify: PII / financial / credentials / confidential / non-sensitive.
Format: System -> data types -> classification

**Q5 — Detailed Permissions**
For each system, list exact permissions currently granted.
Do NOT reveal actual secret values — just describe the type and what access it grants.

**Q6 — Data Read Operations**
For each system, what data do you read?
Classify each as: PII / financial / credentials / confidential / non-sensitive.
Give one concrete example of the most sensitive data accessed.

**Q7 — Reversibility**
For each system with write access: are the operations reversible?
Give concrete examples of what can be rolled back vs what cannot.

**Q8 — Write Operations**
List every write operation. Format:
Action -> Target system -> Reversible? -> Approval needed? -> Volume/day

**Q9 — Blast Radius**
For the most dangerous write operation:
1. How many records/users can it affect? (1 record / 1 user / whole team / whole org)
2. Worst-case scenario if it goes wrong?
3. Can it be undone?

**Q10 — Frequency and Volume**
1. How often does this run?
2. How many API calls per run?
3. One-at-a-time or batches? What batch size?

**Q11 — Excess Permissions**
Which configured permissions are never actually used in the code?
What could safely be revoked?

**Q12 — Worst Case Failure**
Worst realistic failure: wrong data to wrong recipient at max scale.
What goes wrong, who's affected, how bad, can it be recovered?

**Q13 — Decision-Making About People**
Does this project make or influence decisions about people?
Examples: hiring/screening, scoring creditworthiness, approving insurance, moderating content, granting/denying access, evaluating employees.
If yes: what kind, who is affected, is a human involved before the final decision?

## Step 3: Analyze

After answering all 13 questions, analyze the answers:

### Risk Assessment

For each system, assess:
- **Per-system risk**: LOW / MEDIUM / HIGH using this rubric:
  - LOW: Read-only, non-sensitive data, single-user scope
  - MEDIUM: Read access to sensitive data OR write to non-sensitive, reversible
  - HIGH: Write to team/org data, or PII/financial access, or irreversible ops, or excessive permissions
- **Overall risk** = highest individual system risk

### Findings

Generate findings with IDs (HERON-001, HERON-002, ...) for:
- Excessive permissions (scopes granted but never used)
- Sensitive data with broad blast radius
- Irreversible write operations without safeguards
- Missing approval workflows for high-impact operations
- Any other security concerns

Each finding needs: severity, title, description, and specific recommendation.

### Positive Findings

Note what's working well:
- Reversible write operations
- Limited blast radius
- Appropriate permissions
- No decision-making about people
- Low frequency reduces risk

### Regulatory Flags

Based on the evidence, flag regulatory implications for three jurisdictions:

**EU (EU AI Act + GDPR)**:
- Does it process PII? -> GDPR applies
- Does it make decisions about people? -> Check EU AI Act risk classification
- Does it hold excessive permissions? -> GDPR Article 25 (data protection by design)

**US (SOC 2 + State AI Laws)**:
- Map to SOC 2 controls: CC1 (governance), CC6 (access), CC7 (monitoring), CC8 (change management)
- Excessive permissions -> CC6.3 least privilege violation
- Org-wide blast radius + writes -> CC7.2 / CC8.1

**UK (UK GDPR + ICO)**:
- Same as GDPR but reference UK GDPR / DPA 2018
- ICO AI Risk Toolkit recommendations

### Verdict

Choose one:
- **APPROVE** — minimal access, appropriate for stated purpose
- **APPROVE WITH CONDITIONS** — acceptable but improvements needed
- **DENY** — excessive access, unacceptable risk without remediation

## Step 4: Generate Report

Create the report and save it to `reports/heron-audit-YYYY-MM-DD.md`:

The report must include these sections in this order:

1. **Header** — Generated date, project name, risk level, data quality score, regulatory summary
2. **Scope & Methodology** — Assessment type, method, duration, limitations
3. **Executive Summary** — Dashboard table (Risk | Systems | Findings) + 2-3 sentence summary
4. **Agent Profile** — Purpose, trigger, owner, frequency
5. **Findings** — Table with ID, Severity, Finding, Description, Recommendation columns
6. **Systems & Access** — Per-system cards with risk rating, scopes, data, blast radius, writes
7. **What's Working Well** — Positive findings with checkmarks
8. **Verdict & Recommendations** — Decision + numbered recommendations + permissions delta
9. **Regulatory Compliance** — EU, US, UK sub-sections with specific flags
10. **Data Quality** — Field-by-field coverage table (7 compliance fields)
11. **Evidence Sources** — List of files analyzed (in collapsible details)

Footer: *This report was generated automatically by [Heron](https://github.com/jonydony/Heron), an open-source AI agent auditor.*

## Important Notes

- Create the `reports/` directory if it doesn't exist
- Use today's date in the filename
- If a report already exists for today, append a number: `heron-audit-YYYY-MM-DD-2.md`
- After saving, tell the user where the report is and give a brief summary of findings
