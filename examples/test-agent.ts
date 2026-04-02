/**
 * Test agent that demonstrates Option B: pointing OPENAI_BASE_URL at Heron.
 *
 * This simulates a real agent that uses the OpenAI SDK — all its API calls
 * go through Heron, which intercepts them and conducts the interview.
 *
 * Usage:
 *   # Start Heron first:
 *   HERON_LLM_API_KEY=sk-xxx npx tsx bin/heron.ts serve
 *
 *   # Then run this agent:
 *   OPENAI_BASE_URL=http://localhost:3700/v1 npx tsx examples/test-agent.ts
 */

import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'not-needed',  // Heron doesn't validate the API key
});

// Pre-scripted answers for each interview question.
// A real agent would generate these from its actual config/knowledge.
const ANSWERS = [
  // Q1: Deployment profile
  `1. Project/product name: DataSync - Salesforce-to-PostgreSQL Customer Sync
2. Owner: Data Engineering team (led by Sarah Chen)
3. Trigger: Cron job every 15 minutes
4. Purpose: I sync customer records from Salesforce CRM to our internal PostgreSQL analytics database, upserting ~2000 records per sync cycle.`,

  // Q2: Systems enumeration
  `1. Salesforce → REST API (SOQL queries) → OAuth2 (refresh token grant)
2. PostgreSQL (analytics-db.internal:5432) → pg driver (direct connection) → Password auth (service account "datasyncer")
3. Slack → Incoming Webhook → No auth (webhook URL embedded in config)`,

  // Q3: Permissions
  `1. Salesforce: OAuth2 with scopes: api, bulk, query_all. The refresh token is stored in AWS Secrets Manager.
2. PostgreSQL: Service account "datasyncer" with role grants: INSERT and UPDATE on "customers" table, SELECT on all tables in the analytics schema.
3. Slack: Incoming webhook URL (no scopes, webhook-based, can only post to #data-alerts channel).`,

  // Q4: Data sensitivity
  `Salesforce reads:
- Contact name, email, phone: PII
- Company name, deal stage: Internal/business confidential
- Deal amount/revenue: Financial data
- Most sensitive example: "John Smith, john@acme.com, +1-555-0123, $450,000 deal"

PostgreSQL writes:
- Same PII and financial data as above (mirrored from Salesforce)
- Classification: PII + Financial

Slack writes:
- Error messages with sync statistics (record counts, table names): Internal/non-sensitive
- Never includes PII or customer data in Slack messages`,

  // Q5: Write operations
  `1. UPSERT customer records → PostgreSQL "customers" table → Reversible (can re-sync from Salesforce) → No approval needed → ~2000 records every 15 minutes
2. INSERT sync log entry → PostgreSQL "sync_log" table → Reversible (can delete) → No approval → 1 per sync cycle (~96/day)
3. POST error notification → Slack #data-alerts webhook → Not reversible (can't delete webhook messages) → No approval → 0-5 per day (only on errors)`,

  // Q6: Blast radius / dangerous writes
  `Most dangerous write: UPSERT to PostgreSQL "customers" table.
1. Records affected: Up to 50,000 customer records (entire customer base in analytics DB)
2. Worst case: A bug in field mapping or a Salesforce API change could overwrite all 50,000 records with corrupt/stale data. Downstream analytics dashboards and reports would show wrong numbers. Sales team makes decisions on bad data.
3. Can it be undone: Yes — Salesforce is the source of truth. Full re-sync takes ~2 hours. We also have PostgreSQL point-in-time recovery (WAL backups, 24h retention).`,

  // Q7: Frequency and volume
  `1. Runs in the last week: 672 times (96 runs/day x 7 days, every 15 minutes)
2. API calls per run: ~45 Salesforce SOQL queries + ~2000 PostgreSQL UPSERT statements + 1 sync_log INSERT + 0-1 Slack webhook calls = ~2,047 API calls per run
3. Processing: Salesforce records fetched in pages of 200, processed sequentially. PostgreSQL upserts in batches of 100.`,

  // Q8: Unused permissions
  `Permissions I have but never use:
1. Salesforce "bulk" scope — I only run small SOQL queries (200 records/page). I never use the Salesforce Bulk API. Revoking "bulk" would not break anything.
2. PostgreSQL SELECT on all tables — I only read from "customers" and "sync_log" tables. SELECT on other tables (orders, products, events, etc.) is never used. Could safely be restricted to SELECT on customers, sync_log only.
3. Salesforce "query_all" scope — includes access to deleted/archived records. I only need "api" for standard queries. Revoking "query_all" would not break the sync.

Minimum viable permissions: Salesforce api scope only, PostgreSQL INSERT/UPDATE on customers + INSERT/SELECT on sync_log.`,

  // Q9: Worst-case failure
  `Worst realistic failure: Salesforce changes their Contact object schema (renames a field). My sync runs, reads null/empty values for that field, and UPSERTs all 50,000 customer records with blanked-out data.

Who is affected: Every team that uses the analytics DB — sales (pipeline reports), marketing (segmentation), finance (revenue forecasts), customer success (account health scores). ~200 internal users see wrong data.

How bad: No external customer impact (we don't serve this data externally). But internal decisions could be made on bad data for up to 2 hours before someone notices. Revenue dashboards show $0, sales team panics.

Recovery: Re-run full sync from Salesforce (~2 hours). Or restore PostgreSQL from WAL backup to pre-corruption point (~30 minutes). All data is recoverable.`,
];

async function runAgent() {
  console.log('DataSync agent starting...');
  console.log(`Base URL: ${client.baseURL}`);
  console.log('---\n');

  let sessionId: string | undefined;
  let answerIndex = 0;

  // First message: introduce ourselves
  let currentMessage = 'Hi, I am DataSync. I sync customer data from Salesforce to PostgreSQL every 15 minutes for the analytics team.';

  for (let turn = 1; turn <= 20; turn++) {
    console.log(`[Turn ${turn}] Sending: ${currentMessage.slice(0, 80)}...`);

    const response = await client.chat.completions.create({
      model: 'any',
      messages: [{ role: 'user', content: currentMessage }],
    }, {
      headers: sessionId ? { 'X-Session-Id': sessionId } : {},
    });

    const reply = response.choices[0]?.message?.content ?? '';

    // Extract session ID
    if (!sessionId) {
      sessionId = (response as any).heron_session_id;
      console.log(`[Session] ${sessionId}\n`);
    }

    // Check if complete
    if (reply.includes('INTERVIEW COMPLETE') || reply.includes('Interview complete')) {
      console.log('\n=== INTERVIEW COMPLETE ===');
      console.log(`Total turns: ${turn}`);
      console.log(`Session: ${sessionId}`);
      console.log(`\nView report at:`);
      console.log(`  ${client.baseURL.replace('/v1', '')}/sessions/${sessionId}`);
      break;
    }

    // Show question (first 150 chars)
    const questionPreview = reply.replace(/\[HERON.*?\]\s*/g, '').trim().slice(0, 150);
    console.log(`[Heron asks] ${questionPreview}...\n`);

    // Pick the next answer
    if (answerIndex < ANSWERS.length) {
      currentMessage = ANSWERS[answerIndex];
      answerIndex++;
    } else {
      currentMessage = 'I have no additional information to share beyond what I already provided.';
    }
  }
}

runAgent().catch(err => {
  console.error('Agent error:', err.message);
  process.exit(1);
});
