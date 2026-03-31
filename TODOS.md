# TODOS

## P2: Static analysis of tool manifests
**What:** Parse MCP server configs and OpenAI function-calling tool definitions to inventory agent capabilities directly, instead of relying on self-report.
**Why:** Self-report accuracy is the biggest long-term risk. Static analysis is the verification layer. Security teams trust static analysis over self-reported interviews.
**Effort:** M (human ~1 week) -> with CC: S (~3 hours)
**Depends on:** Completion of compliance-grade interview sprint (A+C). Ground truth testing should validate how often self-report diverges from reality.
**Context:** Second opinion from CEO review proposed this as a 48-hour prototype. The ideal architecture combines static analysis (when tool manifests available) with conversational interrogation (when not). See design doc at ~/.gstack/projects/jonydony-Heron/ for full Approach B description.

## P3: Approval workflow integration
**What:** Auto-create a ticket (Linear, Jira, or Slack message) with risk summary after report generation for security reviewer to approve/deny.
**Why:** The report alone requires manual forwarding. An auto-created approval ticket makes Heron feel like infrastructure, not a one-off tool. Closes the loop from "here's a report" to "here's a decision workflow."
**Effort:** M (human ~1 week) -> with CC: S (~2 hours per integration)
**Depends on:** Validated report format + at least 1 buyer confirming the workflow makes sense.
**Context:** Part of the full chain: understand -> narrow -> approve -> enforce -> audit. This covers the "approve" step.

## P3: Evaluate "compliance-grade" naming claim
**What:** After ground truth testing, evaluate whether "compliance-grade" is an honest claim for reports based on agent self-report without verification. Consider renaming to "interview-grade" if self-report accuracy is insufficient.
**Why:** Outside voice (eng review, 2026-03-30) challenged that "compliance-grade" from self-report is a contradiction without a verification layer. The Self-Report Accuracy Gate (>30% critical field misses) may trigger Approach B, but even below that threshold the naming could mislead regulated buyers.
**Effort:** S (decision, not implementation)
**Depends on:** Ground truth testing results. If accuracy gate triggers, this is moot (Approach B required). If accuracy is acceptable, decide whether to keep the name with caveats or rename.
**Context:** Design doc uses "compliance-grade" throughout. Buyers like Janardhan and Ilyas responded to compliance positioning. Changing the name affects marketing and positioning, not just code.

## P3: Compliance framework mapping
**What:** Map Heron report fields to specific compliance framework controls (SOC 2 CC6.1, ISO 27001 A.9, etc.) so reports are directly usable in audit documentation.
**Why:** Janardhan (pharma) ranked compliance + auditability first. Regulated segments (banking, pharma, telecom) need reports that speak their language.
**Effort:** M (human ~1 week research + implementation) -> with CC: S (~2 hours)
**Depends on:** Buyer feedback on which frameworks matter most. Don't guess, ask.
**Context:** Open question in design doc. For v1, "compliance-grade" means sufficient for internal security review, not mapped to external framework.
