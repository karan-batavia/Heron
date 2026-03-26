import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * A simple mock agent that responds to OpenAI-compatible chat requests
 * with pre-defined answers based on question keywords.
 */

const MOCK_RESPONSES: Record<string, string> = {
  purpose: `I am an invoice processing agent. My main purpose is to automatically process incoming invoices from vendors, match them with purchase orders in our ERP system, and update the payment status in our CRM. I handle about 200-300 invoices per day across 3 business units.`,

  data: `I connect to the following systems:
1. **SAP ERP** — I read purchase orders, vendor master data, and GL accounts
2. **HubSpot CRM** — I read and write invoice records, update payment status fields
3. **Stripe API** — I read payment confirmations and transaction history
4. **Google Sheets** — I write daily reconciliation summaries to a shared spreadsheet
5. **Company S3 bucket** — I read incoming invoice PDFs from the upload folder`,

  sensitive: `Yes, I handle several types of sensitive data:
- **Vendor bank account numbers** from SAP (needed to verify payment routing)
- **Invoice amounts and payment terms** (financial data)
- **Customer email addresses** from HubSpot (for payment confirmation notifications)
- **Stripe API keys** stored as environment variables
I don't handle SSNs, passwords, or healthcare data.`,

  frequency: `I run continuously during business hours (8am-6pm EST, Monday-Friday). I process invoices in near-real-time as they arrive in the S3 bucket. On average:
- 200-300 invoice reads per day from S3
- 150-200 CRM updates per day
- 50-80 ERP lookups per day
- 1 reconciliation write to Google Sheets at end of day
- Stripe API calls as needed (roughly 100/day)`,

  access: `My current access levels:
- **SAP ERP**: Full read access to all modules (was set up by IT with a service account)
- **HubSpot CRM**: Read/write access to all objects (admin API key)
- **Stripe**: Full API access (live secret key)
- **Google Sheets**: Read/write to entire Google Workspace (OAuth with broad scope)
- **S3**: Read/write access to the entire company bucket (not just the invoices folder)
- **Company Slack**: Can post to any channel (webhook with full scope)`,

  minimum: `If I could have minimum access, I would need:
- **SAP**: Read-only access to Purchase Orders and Vendor Master modules only (not all modules)
- **HubSpot**: Read/write to Invoice and Contact objects only (not all objects)
- **Stripe**: Read-only API key (I never create charges)
- **Google Sheets**: Write access to one specific spreadsheet only
- **S3**: Read-only access to the /invoices/ folder only
- **Slack**: I don't actually need Slack access at all — it was set up "just in case"`,

  writes: `I write to the following:
1. **HubSpot CRM**: I update the invoice status field (draft → pending → paid → overdue), payment date, and matched PO number on invoice records
2. **Google Sheets**: I write one row per day to the "Daily Reconciliation" spreadsheet with totals
3. **S3**: I move processed invoices from /invoices/incoming/ to /invoices/processed/ (rename/move operation)
That's it — I don't write to SAP, Stripe, or Slack in normal operation.`,

  impact: `If a write went wrong:
- **HubSpot**: Wrong invoice status could cause duplicate payments or missed payments. We've had this happen once — a batch of 50 invoices were incorrectly marked "paid" when they weren't. It took 2 days to find and fix. There's no automatic rollback — we had to manually review each one.
- **Google Sheets**: Low impact — the spreadsheet is for reporting only, easily corrected
- **S3**: If files were incorrectly moved or deleted from S3, we could lose unprocessed invoices. We have backups but restoring takes time.
- Worst case: incorrectly marking invoices as paid could result in real financial loss if vendors are double-paid.`,
};

function findResponse(messages: Array<{ content: string }>): string {
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() ?? '';

  if (lastMessage.includes('purpose') || lastMessage.includes('created to do')) {
    return MOCK_RESPONSES.purpose;
  }
  if (lastMessage.includes('sensitive') || lastMessage.includes('confidential') || lastMessage.includes('personal')) {
    return MOCK_RESPONSES.sensitive;
  }
  if (lastMessage.includes('systems') || lastMessage.includes('databases') || lastMessage.includes('connect to')) {
    return MOCK_RESPONSES.data;
  }
  if (lastMessage.includes('how often') || lastMessage.includes('frequency') || lastMessage.includes('schedule')) {
    return MOCK_RESPONSES.frequency;
  }
  if (lastMessage.includes('minimum') || lastMessage.includes('removed without')) {
    return MOCK_RESPONSES.minimum;
  }
  if (lastMessage.includes('permission') || lastMessage.includes('access level') || lastMessage.includes('credentials')) {
    return MOCK_RESPONSES.access;
  }
  if (lastMessage.includes('wrong') || lastMessage.includes('worst') || lastMessage.includes('rollback') || lastMessage.includes('impact')) {
    return MOCK_RESPONSES.impact;
  }
  if (lastMessage.includes('write') || lastMessage.includes('modify') || lastMessage.includes('create') || lastMessage.includes('delete')) {
    return MOCK_RESPONSES.writes;
  }

  // Default: give a generic but useful response
  return `I'm an invoice processing agent that reads invoices from S3, matches them with purchase orders in SAP, and updates payment records in HubSpot CRM. I also write daily summaries to Google Sheets.`;
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const reply = findResponse(body.messages ?? []);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{
        message: { role: 'assistant', content: reply },
      }],
    }));
  });
}

/**
 * Start the mock agent server. Returns a cleanup function.
 */
export function startMockAgent(port = 4444): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handleRequest);
    server.listen(port, () => {
      resolve({
        url: `http://localhost:${port}/v1/chat/completions`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// If run directly, start the server
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { url } = await startMockAgent();
  console.log(`Mock agent running at ${url}`);
}
