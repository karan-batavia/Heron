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
export function startServer(config: ServerConfig): void {
  const llmClient = createLLMClient(config.llm);
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

      // Health check
      if (url.pathname === '/health') {
        json(res, 200, { status: 'ok', version: '0.1.0' });
        return;
      }

      // Landing page
      if (url.pathname === '/') {
        await handleLanding(res, sessions);
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

async function handleLanding(res: ServerResponse, sessions: SessionManager): Promise<void> {
  const activeSessions = sessions.listSessions();
  const html = `<!DOCTYPE html>
<html>
<head><title>Heron — Agent Interrogator</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
  h1 { font-size: 1.5rem; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  pre { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; font-weight: 600; }
  .badge-interviewing { background: #fef3c7; color: #92400e; }
  .badge-complete { background: #d1fae5; color: #065f46; }
  .badge-error { background: #fee2e2; color: #991b1b; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; }
</style>
</head>
<body>
  <h1>Heron — Agent Checkpoint</h1>
  <p>Point your AI agent here before it gets production access.</p>

  <h2>Quick start</h2>
  <p>Set your agent's base URL to this server:</p>
  <pre>OPENAI_BASE_URL=http://localhost:${3700}/v1</pre>
  <p>Or use curl:</p>
  <pre>curl -X POST http://localhost:${3700}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{"messages":[{"role":"user","content":"Hello, I am an invoice processing agent"}]}'</pre>

  <h2>Sessions (${activeSessions.length})</h2>
  ${activeSessions.length === 0
    ? '<p>No sessions yet. Connect an agent to start.</p>'
    : `<table>
    <tr><th>Session</th><th>Status</th><th>Questions</th><th>Risk</th><th>Created</th></tr>
    ${activeSessions.map(s => `<tr>
      <td><code>${s.id}</code></td>
      <td><span class="badge badge-${s.status}">${s.status}</span></td>
      <td>${s.questionsAsked}</td>
      <td>${s.reportJson?.overallRiskLevel?.toUpperCase() ?? '—'}</td>
      <td>${s.createdAt.toISOString().slice(0, 16)}</td>
    </tr>`).join('')}
  </table>`}

  <h2>API</h2>
  <table>
    <tr><td><code>POST /v1/chat/completions</code></td><td>OpenAI-compatible — agents connect here</td></tr>
    <tr><td><code>GET /api/sessions</code></td><td>List all interrogation sessions</td></tr>
    <tr><td><code>GET /api/sessions/:id</code></td><td>Session details + transcript</td></tr>
    <tr><td><code>GET /api/sessions/:id/report</code></td><td>Download audit report (markdown)</td></tr>
    <tr><td><code>GET /health</code></td><td>Health check</td></tr>
  </table>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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
