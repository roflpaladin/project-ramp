-- Sprint 11, Ticket 55: Salesforce OAuth — crm_connections.instance_url.
--
-- Every Salesforce API call (data API, later the Chatter/metadata APIs, and
-- this ticket's own token refresh/revoke calls are the one exception —
-- those always go to the fixed login host, see lib/salesforce/env.ts's
-- getSalesforceLoginBaseUrl()) must be made against a PER-ORG instance host
-- (e.g. https://my-dev-org.my.salesforce.com), returned as `instance_url` in
-- both the initial authorization_code token response and (per Salesforce's
-- own docs) the refresh_token response. HubSpot, by contrast, has one fixed
-- api.hubapi.com host for every tenant — there was nothing to store for it.
-- This is load-bearing (lib/salesforce/get-client.ts uses it as every
-- request's base URL), org-specific, and orthogonal to every other column
-- already on this row, so it gets its own nullable column rather than being
-- folded into `scope` or `external_account_id`.
--
-- Nullable: existing HubSpot rows never populate it (see
-- lib/crm-connections/token-store.ts's SaveTenantTokensInput.instanceUrl —
-- omitted from the upsert payload entirely for HubSpot, so this column is
-- simply never touched for those rows), and it stays nullable going forward
-- so a provider that never needs a per-org host (HubSpot, or a future one)
-- is never forced to fabricate a value for it.
--
-- Same "RLS enabled, zero policies" table (0010) — adding a column changes
-- nothing about that; no policy needs to be added or touched here.

begin;

alter table crm_connections
  add column if not exists instance_url text;

comment on column crm_connections.instance_url is
  'Per-org API host for providers that need one (Salesforce). Null for HubSpot rows and for any provider with a single fixed API host. Populated from the OAuth token response''s instance_url field (lib/salesforce/token-exchange.ts).';

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     alter table crm_connections drop column if exists instance_url;
--   commit;
