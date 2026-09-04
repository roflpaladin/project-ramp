import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/encrypt-secret";

// Sprint 10, Ticket 52 — service-role CRUD over crm_connections (0010).
// Moved from lib/hubspot/token-store.ts to lib/crm-connections/token-store.ts
// (Sprint 11, Ticket 55) — a pure move, no behavior change: this module was
// already provider-parameterized (every function takes `provider`, defaulted
// to "hubspot" only for call-site convenience), so Salesforce's OAuth flow
// (lib/salesforce/get-client.ts, app/api/integrations/salesforce/oauth/*)
// reuses it directly rather than forking a near-duplicate module. Every
// function here goes through the service-role client (lib/supabase/admin.ts):
// crm_connections has RLS enabled with zero policies (0010's own header,
// mirroring 0002/0008's "service-role only" shape), so an RLS-scoped seller
// client could never read/write it anyway.
//
// The refresh token is encrypted (lib/encrypt-secret.ts, AES-256-GCM) before
// it ever reaches an `.insert`/`.upsert` call, and decrypted only in
// getTenantConnection/getTenantRefreshToken — the functions that actually
// need the plaintext (to call a provider's token-exchange refreshAccessToken).
//
// `instance_url` (0013_crm_connections_instance_url.sql, Sprint 11, Ticket
// 55) is Salesforce-specific — every Salesforce API call goes to a
// per-org instance host returned in the token response, unlike HubSpot's
// single fixed api.hubapi.com host. It's nullable and simply never set by
// HubSpot's own saveTenantTokens calls (omitted from the payload, same
// "undefined key is left out of the row" convention `scope` already uses
// below) — HubSpot's read/write paths are completely unaffected by its
// existence.

const DEFAULT_PROVIDER = "hubspot";

export interface SaveTenantTokensInput {
  readonly tenantId: string;
  readonly refreshToken: string;
  /**
   * Optional so a rotated-refresh-token re-persist (a get-client.ts's own
   * refresh path only ever learns a new token, never a new scope) can call
   * this without re-fetching the original OAuth grant's scope string. A
   * supabase-js `.upsert` only sets the columns present in the payload —
   * omitting `scope` here leaves an existing row's scope column untouched
   * rather than nulling it out.
   */
  readonly scope?: string;
  readonly externalAccountId?: string | null;
  readonly connectedBy?: string | null;
  readonly provider?: string;
  /**
   * Salesforce-only (see this file's header) — the per-org API host from the
   * token response. Optional and omitted-when-absent, same convention as
   * `scope` above: HubSpot's saveTenantTokens calls never pass this, so the
   * column is simply never touched for a HubSpot row.
   */
  readonly instanceUrl?: string | null;
}

/**
 * Upserts on (tenant_id, provider) — a reconnect replaces the prior row's
 * token/scope rather than duplicating it. Row is built with a single
 * spread + conditional scope/instanceUrl, immutably — no post-construction
 * mutation of the object handed to `.upsert`.
 */
export async function saveTenantTokens(input: SaveTenantTokensInput): Promise<void> {
  const admin = createAdminClient();
  const provider = input.provider ?? DEFAULT_PROVIDER;

  const row = {
    tenant_id: input.tenantId,
    provider,
    external_account_id: input.externalAccountId ?? null,
    encrypted_refresh_token: encryptSecret(input.refreshToken),
    connected_by: input.connectedBy ?? null,
    updated_at: new Date().toISOString(),
    // `.upsert` only sets columns present in the payload — omitting `scope`
    // / `instance_url` (rather than including either as `undefined` or
    // `null`) leaves an existing row's column untouched on a
    // rotated-token-only re-persist. See SaveTenantTokensInput's own doc
    // comments for `scope` and `instanceUrl`.
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    ...(input.instanceUrl !== undefined ? { instance_url: input.instanceUrl } : {}),
  };

  const { error } = await admin.from("crm_connections").upsert(row, { onConflict: "tenant_id,provider" });

  if (error) {
    throw new Error(`Failed to save the ${provider} connection: ${error.message}`);
  }
}

export interface TenantConnection {
  readonly refreshToken: string;
  /** null for HubSpot rows (column never set) and for a Salesforce row saved before 0013 added the column's data. */
  readonly instanceUrl: string | null;
}

/**
 * Decrypts and returns the stored refresh token AND instance_url, or `null`
 * when the tenant has no connection for this provider (row genuinely absent
 * — `.maybeSingle()` returns `{ data: null, error: null }` for zero rows, not
 * an error). lib/salesforce/get-client.ts is the one caller that needs
 * instance_url (to build its per-org API base URL); getTenantRefreshToken
 * below delegates here and simply discards it, so HubSpot's existing
 * call sites and behavior are unchanged.
 *
 * T52 code review (MEDIUM): a REAL query error (DB outage, permissions,
 * etc.) throws instead of being folded into the same `null` a missing row
 * produces — a caller must be able to tell "this tenant genuinely never
 * connected" apart from "we couldn't find out right now"; treating a DB
 * outage as "never connected" would be a silent, incorrect downgrade of a
 * real failure.
 */
export async function getTenantConnection(
  tenantId: string,
  provider: string = DEFAULT_PROVIDER,
): Promise<TenantConnection | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_connections")
    .select("encrypted_refresh_token, instance_url")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read the ${provider} connection: ${error.message}`);
  }
  if (!data) return null;
  return {
    refreshToken: decryptSecret(data.encrypted_refresh_token),
    instanceUrl: (data as { instance_url: string | null }).instance_url ?? null,
  };
}

/**
 * HubSpot's original read shape — refresh token only, no instance_url
 * column touched in the select. Kept as its own function (rather than every
 * HubSpot call site switching to getTenantConnection and discarding
 * `.instanceUrl` itself) so HubSpot's query and error message are byte-for-byte
 * unaffected by 0013 ever having been written, whether or not that migration
 * has been applied yet in a given environment. See getTenantConnection above
 * for the instance_url-aware read Salesforce's get-client.ts uses instead.
 */
export async function getTenantRefreshToken(
  tenantId: string,
  provider: string = DEFAULT_PROVIDER,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_connections")
    .select("encrypted_refresh_token")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read the ${provider} connection: ${error.message}`);
  }
  if (!data) return null;
  return decryptSecret(data.encrypted_refresh_token);
}

/**
 * Existence check only — never decrypts, so a page that only needs "is this
 * connected?" never touches the ciphertext. Same error-vs-absent-row
 * distinction as getTenantRefreshToken above — see its comment.
 */
export async function isTenantConnected(tenantId: string, provider: string = DEFAULT_PROVIDER): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_connections")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to check the ${provider} connection: ${error.message}`);
  }
  return data !== null;
}

/** Deletes the connection row unconditionally — the caller (hubspot-actions.ts / salesforce-actions.ts) decides whether an upstream revoke succeeded first. */
export async function deleteTenantTokens(tenantId: string, provider: string = DEFAULT_PROVIDER): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("crm_connections").delete().eq("tenant_id", tenantId).eq("provider", provider);

  if (error) {
    throw new Error(`Failed to delete the ${provider} connection: ${error.message}`);
  }
}
