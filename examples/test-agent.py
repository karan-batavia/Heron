"""
Simple test agent that connects to Heron via OPENAI_BASE_URL.

Usage:
  # Against hosted Heron:
  OPENAI_BASE_URL=https://heron-open-source-production.up.railway.app/v1 python examples/test-agent.py

  # Against local Heron:
  OPENAI_BASE_URL=http://localhost:3700/v1 python examples/test-agent.py

Requirements:
  pip install openai
"""

import os
from openai import OpenAI

base_url = os.environ.get("OPENAI_BASE_URL", "http://localhost:3700/v1")

client = OpenAI(
    base_url=base_url,
    api_key="not-needed",  # Heron doesn't check the key
)

print(f"Connecting to Heron at {base_url}...")
print("=" * 60)

session_id = None
messages = [{"role": "user", "content": "Hi, I am ready to answer questions about this project."}]

# This test agent pretends to be a simple CRM integration
AGENT_KNOWLEDGE = """
I am a CRM sync agent. I connect to:
1. HubSpot CRM via REST API with OAuth2 (scopes: contacts.read, contacts.write, deals.read)
2. PostgreSQL database via direct connection (read-write, credentials in env vars)
3. Slack via Bot token (channels:read, chat:write) for notifications

I sync contacts from HubSpot to our internal PostgreSQL database every hour.
When a deal stage changes, I send a Slack notification to #sales-alerts.
I process about 500 contacts per sync, writing ~50 updated records per run.
The database contains customer names, emails, company names, and deal values.
Write operations: UPDATE contacts SET ... WHERE ..., INSERT INTO sync_log.
Blast radius: all contacts in the database (~10,000 records).
Worst case: a bug could overwrite all contact records with wrong data.
Writes are partially reversible via sync_log table but there's no automatic rollback.
I have more HubSpot scopes than I need — deals.write is granted but never used.
"""

for turn in range(20):  # max 20 turns to avoid infinite loop
    print(f"\n--- Turn {turn + 1} ---")

    response = client.chat.completions.create(
        model="any",
        messages=messages,
        extra_body={"heron_session_id": session_id} if session_id else {},
    )

    assistant_msg = response.choices[0].message.content
    print(f"Heron: {assistant_msg[:200]}...")

    # Extract session ID from response
    if hasattr(response, 'heron_session_id'):
        session_id = response.heron_session_id
    elif not session_id:
        # Try to find session ID in the response text
        import re
        match = re.search(r'sess_[a-f0-9]+', assistant_msg)
        if match:
            session_id = match.group(0)
            print(f"  [Session: {session_id}]")

    # Check if interview is complete
    if "interview complete" in assistant_msg.lower() or "report" in assistant_msg.lower() and "generated" in assistant_msg.lower():
        print("\n" + "=" * 60)
        print("Interview complete!")
        if session_id:
            report_url = base_url.replace("/v1", "") + f"/sessions/{session_id}"
            print(f"View report: {report_url}")
        break

    # Answer based on agent knowledge
    # Simple approach: send the full knowledge on first real question, then specific answers
    if turn == 0:
        answer = AGENT_KNOWLEDGE
    else:
        answer = f"Based on my configuration: {AGENT_KNOWLEDGE}"

    messages = [{"role": "user", "content": answer}]

print("\nDone!")
