import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SessionManager } from './sessions.js';
import { createLLMClient } from '../llm/client.js';
import type { LLMConfig } from '../config/schema.js';
import * as logger from '../util/logger.js';

export interface ServerConfig {
  port: number;
  host: string;
  llm: LLMConfig;
  maxFollowUps: number;
  reportDir: string;
}

/**
 * Starts the Heron server.
 *
 * Exposes two API surfaces:
 * 1. /v1/chat/completions — OpenAI-compatible (agents connect as if talking to an LLM)
 * 2. /api/sessions — Simple REST API for managing interrogation sessions
 */
export async function startServer(config: ServerConfig): Promise<void> {
  const llmClient = await createLLMClient(config.llm);
  const sessions = new SessionManager(llmClient, {
    maxFollowUps: config.maxFollowUps,
    reportDir: config.reportDir,
  });

  const server = createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      // OpenAI-compatible endpoint
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        await handleChatCompletions(req, res, sessions);
        return;
      }

      // REST: list sessions
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        await handleListSessions(res, sessions);
        return;
      }

      // REST: get session / report
      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === 'GET') {
        await handleGetSession(res, sessions, sessionMatch[1]);
        return;
      }

      const reportMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/report$/);
      if (reportMatch && req.method === 'GET') {
        await handleGetReport(res, sessions, reportMatch[1]);
        return;
      }

      // Session detail page (HTML)
      const sessionPageMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
      if (sessionPageMatch && req.method === 'GET') {
        await handleSessionPage(req, res, sessions, sessionPageMatch[1]);
        return;
      }

      // Health check
      if (url.pathname === '/health') {
        json(res, 200, { status: 'ok', version: '0.1.0' });
        return;
      }

      // Landing page
      if (url.pathname === '/') {
        await handleLanding(res, sessions, req.headers.host ?? 'localhost:3700');
        return;
      }

      json(res, 404, { error: 'Not found' });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      json(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(config.port, config.host, () => {
    logger.heading('Heron Server');
    logger.log(`Listening on http://${config.host}:${config.port}`);
    logger.log('');
    logger.log('Endpoints:');
    logger.log(`  POST /v1/chat/completions  — OpenAI-compatible (point your agent here)`);
    logger.log(`  GET  /api/sessions         — List all interrogation sessions`);
    logger.log(`  GET  /api/sessions/:id      — Get session details`);
    logger.log(`  GET  /api/sessions/:id/report — Get report (markdown)`);
    logger.log(`  GET  /health               — Health check`);
    logger.log('');
    logger.log('Reports saved to: ' + config.reportDir);
    logger.log('');
    logger.success('Ready — agents can connect now');
  });
}

// ─── OpenAI-compatible handler ────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatCompletionsRequest {
  model?: string;
  messages: ChatMessage[];
}

const SYSTEM_GREETING = `You are now being interviewed by Heron, an open-source agent auditor. I'll ask you a series of questions about what you do, what data you access, and what permissions you need. Please answer honestly and in detail. Let's begin.`;

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionManager,
): Promise<void> {
  const body = await readBody<ChatCompletionsRequest>(req);
  const messages = body.messages ?? [];
  const sessionId = (req.headers['x-session-id'] as string) ?? null;

  // Filter to user messages only (the agent's answers)
  const userMessages = messages.filter(m => m.role === 'user');

  if (userMessages.length === 0) {
    // Agent connected but sent no message — return greeting + first question
    const { session, firstQuestion } = sessions.createSession();
    const reply = `${SYSTEM_GREETING}\n\n${firstQuestion}`;
    chatResponse(res, session.id, reply);
    return;
  }

  // Determine session: by header, or try to find/create
  let session = sessionId ? sessions.getSession(sessionId) : null;

  if (!session) {
    // First real message from agent — create session and treat first user message as intro,
    // then process remaining messages
    const { session: newSession, firstQuestion } = sessions.createSession();
    session = newSession;

    if (userMessages.length === 1) {
      // Agent just introduced itself — record it as answer to first question, get next
      const result = await sessions.processAnswer(session.id, userMessages[0].content);
      if (result.done) {
        chatResponse(res, session.id, formatCompletion(result.report));
      } else {
        chatResponse(res, session.id, result.question);
      }
      return;
    }
  }

  // Process the latest user message as an answer
  const latestAnswer = userMessages[userMessages.length - 1].content;
  const result = await sessions.processAnswer(session.id, latestAnswer);

  if (result.done) {
    chatResponse(res, session.id, formatCompletion(result.report));
  } else {
    chatResponse(res, session.id, result.question);
  }
}

function formatCompletion(report: string): string {
  return `Interview complete. Here is your audit report:\n\n${report}`;
}

function chatResponse(res: ServerResponse, sessionId: string, content: string): void {
  json(res, 200, {
    id: `chatcmpl-${sessionId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'heron-interrogator',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    // Custom: session tracking
    heron_session_id: sessionId,
  });
}

// ─── REST handlers ────────────────────────────────────────────────────────

async function handleListSessions(res: ServerResponse, sessions: SessionManager): Promise<void> {
  const list = sessions.listSessions().map(s => ({
    id: s.id,
    status: s.status,
    questionsAsked: s.questionsAsked,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    riskLevel: s.reportJson?.overallRiskLevel ?? null,
  }));

  json(res, 200, { sessions: list });
}

async function handleGetSession(
  res: ServerResponse,
  sessions: SessionManager,
  id: string,
): Promise<void> {
  const session = sessions.getSession(id);
  if (!session) {
    json(res, 404, { error: 'Session not found' });
    return;
  }

  json(res, 200, {
    id: session.id,
    status: session.status,
    questionsAsked: session.questionsAsked,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    transcript: session.protocol.getTranscript(),
    riskLevel: session.reportJson?.overallRiskLevel ?? null,
    error: session.error ?? null,
  });
}

async function handleGetReport(
  res: ServerResponse,
  sessions: SessionManager,
  id: string,
): Promise<void> {
  const session = sessions.getSession(id);
  if (!session) {
    json(res, 404, { error: 'Session not found' });
    return;
  }

  if (session.status !== 'complete') {
    json(res, 409, {
      error: `Session is still "${session.status}". Report not ready yet.`,
      questionsAsked: session.questionsAsked,
    });
    return;
  }

  // Return markdown directly
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  res.end(session.report);
}

async function handleSessionPage(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: SessionManager,
  id: string,
): Promise<void> {
  const session = sessions.getSession(id);
  if (!session) {
    json(res, 404, { error: 'Session not found' });
    return;
  }

  const transcript = session.protocol.getTranscript();
  const riskBadge = session.reportJson?.overallRiskLevel
    ? `<span class="risk risk-${session.reportJson.overallRiskLevel}">${session.reportJson.overallRiskLevel.toUpperCase()}</span>`
    : '';

  const transcriptHtml = transcript.map((qa, i) => `
    <div class="qa">
      <div class="q"><span class="cat">${qa.category}</span> ${escapeHtml(qa.question)}</div>
      <div class="a">${escapeHtml(qa.answer)}</div>
    </div>
  `).join('');

  const reportSection = session.status === 'complete' && session.report
    ? `<h2>Report</h2>
       <div class="report-actions">
         <a href="/api/sessions/${id}/report" class="btn">Download Markdown</a>
       </div>
       <div class="report-preview">${escapeHtml(session.report)}</div>`
    : session.status === 'analyzing'
    ? '<h2>Report</h2><p class="analyzing">Analyzing interview...</p>'
    : session.status === 'error'
    ? `<h2>Report</h2><p class="error-msg">Error: ${escapeHtml(session.error ?? 'Unknown error')}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><title>Session ${id} — Heron</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { font-size: 1.3rem; }
  .meta { color: #6b7280; margin-bottom: 24px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }
  .badge-interviewing { background: #fef3c7; color: #92400e; }
  .badge-analyzing { background: #dbeafe; color: #1e40af; }
  .badge-complete { background: #d1fae5; color: #065f46; }
  .badge-error { background: #fee2e2; color: #991b1b; }
  .risk { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 700; margin-left: 8px; }
  .risk-low { background: #d1fae5; color: #065f46; }
  .risk-medium { background: #fef3c7; color: #92400e; }
  .risk-high { background: #fee2e2; color: #991b1b; }
  .risk-critical { background: #991b1b; color: #fff; }
  .qa { margin-bottom: 20px; border-left: 3px solid #e5e7eb; padding-left: 16px; }
  .q { font-weight: 600; margin-bottom: 4px; }
  .a { color: #374151; white-space: pre-wrap; }
  .cat { display: inline-block; background: #f3f4f6; padding: 1px 6px; border-radius: 3px; font-size: 0.75em; color: #6b7280; font-weight: 400; margin-right: 6px; text-transform: uppercase; }
  .report-preview { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; white-space: pre-wrap; font-family: ui-monospace, monospace; font-size: 0.85em; max-height: 600px; overflow-y: auto; }
  .btn { display: inline-block; background: #2563eb; color: #fff; padding: 8px 16px; border-radius: 6px; font-size: 0.9em; }
  .btn:hover { background: #1d4ed8; text-decoration: none; }
  .report-actions { margin-bottom: 16px; }
  .analyzing { color: #1e40af; font-style: italic; }
  .error-msg { color: #991b1b; }
</style>
${session.status === 'interviewing' || session.status === 'analyzing' ? '<meta http-equiv="refresh" content="5">' : ''}
</head>
<body>
  <p><a href="/">&larr; All sessions</a></p>
  <h1>Session <code>${id}</code> <span class="badge badge-${session.status}">${session.status}</span> ${riskBadge}</h1>
  <div class="meta">${session.questionsAsked} questions &middot; started ${session.createdAt.toISOString().slice(0, 19).replace('T', ' ')} UTC</div>

  <h2>Interview (${transcript.length} Q&A)</h2>
  ${transcript.length === 0 ? '<p>Waiting for agent to respond...</p>' : transcriptHtml}

  ${reportSection}
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

async function handleLanding(res: ServerResponse, sessions: SessionManager, host: string): Promise<void> {
  const activeSessions = sessions.listSessions();
  const baseUrl = host.includes('localhost') || host.includes('0.0.0.0')
    ? `http://localhost:${3700}`
    : `https://${host}`;

  const html = `<!DOCTYPE html>
<html>
<head><title>Heron — Agent Checkpoint</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { font-size: 1.5rem; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }
  .badge-interviewing { background: #fef3c7; color: #92400e; }
  .badge-analyzing { background: #dbeafe; color: #1e40af; }
  .badge-complete { background: #d1fae5; color: #065f46; }
  .badge-error { background: #fee2e2; color: #991b1b; }
  .risk { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.75em; font-weight: 700; }
  .risk-low { background: #d1fae5; color: #065f46; }
  .risk-medium { background: #fef3c7; color: #92400e; }
  .risk-high { background: #fee2e2; color: #991b1b; }
  .risk-critical { background: #991b1b; color: #fff; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb; }
  tr:hover { background: #f9fafb; }
  .empty { color: #6b7280; padding: 40px 0; text-align: center; }
</style>
${activeSessions.some(s => s.status === 'interviewing' || s.status === 'analyzing') ? '<meta http-equiv="refresh" content="5">' : ''}
</head>
<body>
  <h1>Heron — Agent Checkpoint</h1>
  <p>Point your AI agent here before it gets production access.</p>

  <h2>Sessions (${activeSessions.length})</h2>
  ${activeSessions.length === 0
    ? '<div class="empty"><p>No sessions yet.</p><p>Connect an agent to <code>/v1/chat/completions</code> to start an interview.</p></div>'
    : `<table>
    <tr><th>Session</th><th>Status</th><th>Questions</th><th>Risk</th><th>Started</th></tr>
    ${activeSessions.map(s => `<tr>
      <td><a href="/sessions/${s.id}"><code>${s.id}</code></a></td>
      <td><span class="badge badge-${s.status}">${s.status}</span></td>
      <td>${s.questionsAsked}</td>
      <td>${s.reportJson?.overallRiskLevel ? `<span class="risk risk-${s.reportJson.overallRiskLevel}">${s.reportJson.overallRiskLevel.toUpperCase()}</span>` : '—'}</td>
      <td>${s.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
    </tr>`).join('')}
  </table>`}

  <h2>Quick start</h2>
  <pre>OPENAI_BASE_URL=${baseUrl}/v1 your-agent start</pre>

  <h2>API</h2>
  <table>
    <tr><td><code>POST /v1/chat/completions</code></td><td>OpenAI-compatible — agents connect here</td></tr>
    <tr><td><code>GET /api/sessions</code></td><td>List all sessions (JSON)</td></tr>
    <tr><td><code>GET /api/sessions/:id</code></td><td>Session details + transcript</td></tr>
    <tr><td><code>GET /api/sessions/:id/report</code></td><td>Download audit report (markdown)</td></tr>
  </table>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Utilities ────────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw) as T);
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
