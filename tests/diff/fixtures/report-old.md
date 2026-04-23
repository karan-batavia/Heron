# Agent Access Audit Report

**Generated**: 2026-04-10 | **Agent**: session:sess_old_abc | **Risk Level**: MEDIUM

---

## Executive Summary

| Risk | Systems | Findings |
|------|---------|----------|
| **MEDIUM** | 2 | 2 High |

Agent processes lesson content and uploads to Wellkid.

---

## Findings

| ID | Severity | Finding | Description | Recommendation |
|----|----------|---------|-------------|----------------|
| HERON-001 | HIGH | Broad write access to Google Sheets queue | The agent can write status, dates, and links to any row. | Reduce to single-row scope. |
| HERON-002 | HIGH | Local HTTP worker has no built-in authentication | FastAPI worker exposes endpoints with no auth. | Bind to localhost and add auth. |

---

## Systems & Access

### Google Sheets → Google Sheets API → OAuth2 — Risk: MEDIUM

| | |
|---|---|
| **Scopes granted** | https://www.googleapis.com/auth/spreadsheets, https://www.googleapis.com/auth/spreadsheets.readonly |
| **Blast radius** | team-scope |

### Local content worker → local HTTP API → no auth — Risk: HIGH

| | |
|---|---|
| **Blast radius** | single-record |
