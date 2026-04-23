# Agent Access Audit Report

**Generated**: 2026-04-22 | **Agent**: session:sess_new_xyz | **Risk Level**: LOW

---

## Executive Summary

| Risk | Systems | Findings |
|------|---------|----------|
| **LOW** | 3 | 1 Medium |

Agent processes lesson content and uploads to Wellkid. Auth added to local worker.

---

## Findings

| ID | Severity | Finding | Description | Recommendation |
|----|----------|---------|-------------|----------------|
| HERON-001 | MEDIUM | Broad write access to Google Sheets queue | The agent can write status, dates, and links to any row. | Reduce to single-row scope. |

---

## Systems & Access

### Google Sheets → Google Sheets API → OAuth2 — Risk: LOW

| | |
|---|---|
| **Scopes granted** | https://www.googleapis.com/auth/spreadsheets |
| **Blast radius** | single-record |

### Local content worker → local HTTP API → Bearer token — Risk: LOW

| | |
|---|---|
| **Blast radius** | single-record |

### Notion → REST API → API key — Risk: LOW

| | |
|---|---|
| **Blast radius** | single-user |
