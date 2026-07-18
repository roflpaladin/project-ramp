import { isValidDomain, normalizeDomain } from "@/lib/domain";
import type { CrmDealEvent, CrmSource } from "@/lib/crm/types";

// Per-vendor payload parsers (Sprint 3, Ticket 14). The inbound bodies are
// self-contained mocks replicating each vendor's webhook field names — HubSpot
// deal properties are lowercase (dealstage/domain), Salesforce Opportunity
// fields are PascalCase (StageName/Website). Both flat and properties-nested
// HubSpot shapes are accepted, since HubSpot's own payloads nest custom
// properties while simple mocks tend to flatten them.

export type ParseResult =
  | { ok: true; event: CrmDealEvent }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asIdString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Contact lists arrive either as plain email strings or as objects
// (HubSpot associated_contacts: { email }, Salesforce
// OpportunityContactRole: { Contact: { Email } } or { Email }). Anything
// that doesn't yield a plausible email is dropped, not fatal — an empty
// result is the Ghost Contact case, handled downstream.
function extractEmails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const emails: string[] = [];
  for (const entry of value) {
    let candidate: string | null = null;
    if (typeof entry === "string") {
      candidate = entry;
    } else {
      const record = asRecord(entry);
      if (record) {
        const contact = asRecord(record.Contact);
        candidate =
          asTrimmedString(record.email) ??
          asTrimmedString(record.Email) ??
          (contact ? asTrimmedString(contact.Email) ?? asTrimmedString(contact.email) : null);
      }
    }
    if (candidate) {
      const normalized = candidate.trim().toLowerCase();
      if (looksLikeEmail(normalized) && !emails.includes(normalized)) {
        emails.push(normalized);
      }
    }
  }
  return emails;
}

function extractOwnerEmail(value: unknown): string | null {
  const direct = asTrimmedString(value);
  if (direct) return looksLikeEmail(direct.toLowerCase()) ? direct.toLowerCase() : null;
  const record = asRecord(value);
  if (record) {
    const nested = asTrimmedString(record.email) ?? asTrimmedString(record.Email);
    if (nested && looksLikeEmail(nested.toLowerCase())) return nested.toLowerCase();
  }
  return null;
}

function buildEvent(
  crmSource: CrmSource,
  crmObjectId: string | null,
  rawDomain: string | null,
  companyName: string | null,
  buyerEmails: string[],
  ownerEmail: string | null,
  stage: string | null,
): ParseResult {
  if (!crmObjectId) {
    return { ok: false, error: crmSource === "hubspot" ? "dealId is required." : "OpportunityId is required." };
  }
  if (!rawDomain) {
    return { ok: false, error: "domain is required." };
  }
  const domain = normalizeDomain(rawDomain);
  if (!isValidDomain(domain)) {
    return { ok: false, error: "domain is malformed." };
  }
  // A stage-change webhook without a stage is malformed, not skippable.
  if (!stage) {
    return { ok: false, error: crmSource === "hubspot" ? "dealstage is required." : "StageName is required." };
  }
  return {
    ok: true,
    event: { crmSource, crmObjectId, domain, companyName, buyerEmails, ownerEmail, stage },
  };
}

export function parseHubspotWebhook(body: unknown): ParseResult {
  const root = asRecord(body);
  if (!root) return { ok: false, error: "Body must be a JSON object." };
  const properties = asRecord(root.properties) ?? {};

  return buildEvent(
    "hubspot",
    asIdString(root.dealId) ?? asIdString(root.objectId) ?? asIdString(properties.hs_object_id),
    asTrimmedString(root.domain) ?? asTrimmedString(properties.domain),
    asTrimmedString(root.name) ?? asTrimmedString(properties.name),
    extractEmails(root.buyer_emails ?? root.associated_contacts),
    extractOwnerEmail(root.owner_email ?? root.associated_owner),
    asTrimmedString(root.dealstage) ?? asTrimmedString(properties.dealstage),
  );
}

export function parseSalesforceWebhook(body: unknown): ParseResult {
  const root = asRecord(body);
  if (!root) return { ok: false, error: "Body must be a JSON object." };
  const owner = asRecord(root.Owner);

  return buildEvent(
    "salesforce",
    asIdString(root.OpportunityId) ?? asIdString(root.Id),
    asTrimmedString(root.Website) ?? asTrimmedString(root.domain),
    asTrimmedString(root.Name) ?? asTrimmedString(root.AccountName),
    extractEmails(root.OpportunityContactRole ?? root.buyer_emails),
    extractOwnerEmail(root.owner_email ?? (owner ? owner.Email ?? owner.email : undefined) ?? root.OwnerEmail),
    asTrimmedString(root.StageName),
  );
}
