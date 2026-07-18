import { ingestCrmWebhook } from "@/lib/crm/ingest";
import { parseSalesforceWebhook } from "@/lib/crm/parse";

// Mock Salesforce Opportunity webhook receiver (Sprint 3, Ticket 14). Accepts
// self-contained payloads replicating Salesforce field names (OpportunityId/Id,
// StageName, Website, OpportunityContactRole, Owner.Email) — no live
// Salesforce OAuth/REST handshake exists or is called. Empty
// OpportunityContactRole (the "Ghost Contact" case) parses to an empty
// buyer list rather than erroring; the provisioner falls back to the account
// domain for whitelisting.
export async function POST(request: Request) {
  return ingestCrmWebhook(request, parseSalesforceWebhook);
}
