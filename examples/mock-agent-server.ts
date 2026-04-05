/**
 * Mock agent server — pretends to be an OpenAI-compatible API.
 * Heron's `scan` command can interrogate this agent.
 *
 * Usage:
 *   npx tsx examples/mock-agent-server.ts
 *   # Then in another terminal:
 *   npx tsx bin/heron.ts scan --target http://localhost:4000/v1/chat/completions
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = 4000;

// This agent pretends to be a CRM sync tool
const AGENT_CONTEXT = `
I am a CRM sync agent called "SalesSync". I'm owned by the Sales Engineering team.
I run on a cron schedule every hour, triggered by a Kubernetes CronJob.
In one sentence: I sync contact and deal data between HubSpot CRM and our internal PostgreSQL database, and notify the sales team via Slack when deal stages change.

Systems I connect to:
- HubSpot CRM → REST API → OAuth2 (scopes: crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.read, crm.objects.deals.write)
- PostgreSQL (sales_db) → Direct TCP connection → Username/password from environment variables
- Slack → Bot Token API → Bot token (scopes: channels:read, chat:write, chat:write.public)

Data I handle:
- From HubSpot: contact names, emails, phone numbers, company names, deal amounts, deal stages, last activity dates → PII + financial
- From PostgreSQL: I read existing contact records to diff against HubSpot → PII
- To Slack: deal stage change notifications containing deal name, amount, and assigned rep name → financial + PII

Permissions:
- HubSpot OAuth2: crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.read, crm.objects.deals.write. I have deals.write but I never actually write deals — only read them.
- PostgreSQL: full read-write on sales_db.contacts, sales_db.deals, sales_db.sync_log tables. I could technically access other tables but only use these three.
- Slack: chat:write and chat:write.public to post in #sales-alerts and #deal-updates channels.

Write operations:
- UPDATE contacts SET ... → PostgreSQL → Reversible via sync_log → No approval → ~200/run
- INSERT INTO sync_log → PostgreSQL → Append-only log → No approval → ~200/run
- Send notification → Slack #sales-alerts → Not reversible → No approval → ~10/run

Blast radius: all ~15,000 contact records in PostgreSQL could be affected by a bad sync.
Worst case: a HubSpot API change could cause all contacts to be overwritten with wrong data. We have sync_log for partial rollback but no automatic recovery.
The deals.write scope on HubSpot is excessive — I only read deals, never write them.

Frequency: runs every hour, ~200 contacts synced per run, ~10 Slack notifications.
Batch processing: fetches all modified contacts since last sync timestamp, processes in batches of 100.

I do not make decisions about people. I just sync data and send notifications.
`;

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    const lastUserMsg = body.messages?.filter((m: any) => m.role === 'user').pop()?.content ?? '';

    // Simple logic: answer based on what's being asked
    let answer: string;

    const q = lastUserMsg.toLowerCase();
    if (q.includes('name') && q.includes('project') || q.includes('profile') || q.includes('what you specifically do')) {
      answer = 'Project name: SalesSync. Owner: Sales Engineering team. Trigger: Kubernetes CronJob running every hour. What I do: I sync contact and deal data between HubSpot CRM and our internal PostgreSQL database, and send Slack notifications when deal stages change.';
    } else if (q.includes('system') && q.includes('connect') || q.includes('list every system')) {
      answer = 'HubSpot CRM → REST API → OAuth2 (crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.read, crm.objects.deals.write)\nPostgreSQL (sales_db) → Direct TCP → Username/password env vars\nSlack → Bot Token API → Bot token (channels:read, chat:write, chat:write.public)';
    } else if (q.includes('permission') || q.includes('scope') || q.includes('oauth')) {
      answer = 'HubSpot: OAuth2 with scopes crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.read, crm.objects.deals.write. Note: deals.write is granted but never used — I only read deals.\nPostgreSQL: read-write credentials for tables contacts, deals, sync_log in sales_db.\nSlack: bot token with channels:read, chat:write, chat:write.public.';
    } else if (q.includes('data') && q.includes('read') || q.includes('classify') || q.includes('sensitive')) {
      answer = 'From HubSpot I read: contact names, emails, phone numbers, company names, deal amounts, deal stages → PII + financial data.\nFrom PostgreSQL I read existing contact/deal records for diffing → PII + financial.\nMost sensitive data: customer phone numbers and deal amounts from HubSpot.';
    } else if (q.includes('write') && (q.includes('operation') || q.includes('list every'))) {
      answer = 'UPDATE contacts SET name, email, phone, company, last_synced → PostgreSQL → Reversible via sync_log → No per-record approval → ~200/run\nINSERT INTO sync_log (before/after snapshot) → PostgreSQL → Append-only → No approval → ~200/run\nSend deal-stage notification → Slack #sales-alerts → Not reversible → No approval → ~10/run';
    } else if (q.includes('dangerous') || q.includes('worst') && q.includes('case') || q.includes('blast') || q.includes('failure')) {
      answer = 'Most dangerous: the PostgreSQL bulk UPDATE of contacts. Blast radius: all ~15,000 contact records. Worst case: a HubSpot API schema change causes all contacts to be overwritten with wrong/null data in one hourly sync. We have sync_log with before/after snapshots for manual rollback, but no automatic recovery — fixing 15,000 records from the log would take hours of manual work. Slack messages sent during the bad sync cannot be recalled.';
    } else if (q.includes('never') && q.includes('used') || q.includes('unused') || q.includes('safely') && q.includes('remove')) {
      answer = 'The HubSpot deals.write scope is granted but never used — I only read deals, never write them. This could safely be revoked. The Slack chat:write.public scope is also broader than needed since I only post to two specific channels. PostgreSQL permissions are scoped to three tables which matches actual usage.';
    } else if (q.includes('frequency') || q.includes('how many') && q.includes('run') || q.includes('batch')) {
      answer = '1. Runs every hour via cron, so ~24 runs/day, ~168/week.\n2. Per run: ~3 HubSpot API calls (list contacts, list deals, token refresh) + ~200 PostgreSQL queries + ~10 Slack messages = ~213 external calls.\n3. Batch processing: fetches all contacts modified since last sync, processes in batches of 100 records.';
    } else if (q.includes('decision') && q.includes('people') || q.includes('hiring') || q.includes('scoring')) {
      answer = 'No. This agent does not make or influence decisions about people. It only syncs data between systems and sends notifications. All decisions about contacts and deals are made by the sales team using the synced data.';
    } else {
      // Default: provide relevant context
      answer = AGENT_CONTEXT.trim();
    }

    const responseBody = {
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: answer },
        finish_reason: 'stop',
      }],
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseBody));
  });
}

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Mock CRM agent listening on http://localhost:${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/v1/chat/completions`);
  console.log('');
  console.log('To scan this agent with Heron:');
  console.log(`  npx tsx bin/heron.ts scan --target http://localhost:${PORT}/v1/chat/completions`);
});
