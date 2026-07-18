import { ingestCrmWebhook } from "@/lib/crm/ingest";
import { parseHubspotWebhook } from "@/lib/crm/parse";

// Mock HubSpot deal-stage webhook receiver (Sprint 3, Ticket 14). Accepts
// self-contained payloads replicating HubSpot's deal property names
// (dealId/objectId, dealstage, domain, associated_contacts, associated_owner)
// — no live HubSpot OAuth/REST handshake exists or is called.
export async function POST(request: Request) {
  return ingestCrmWebhook(request, parseHubspotWebhook);
}
