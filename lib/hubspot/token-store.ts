import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/encrypt-secret";

// Sprint 10, Ticket 52 — service-role CRUD over crm_connections (0010).
// Every function here goes through the service-role client
// (lib/supabase/admin.ts): crm_connections has RLS enabled with zero
// policies (0010's own header, mirroring 0002/0008's "service-role only"
// shape), so an RLS-scoped seller client could never read/write it anyway.
//
// `provider` defaults to "hubspot" but is a real parameter, not hardcoded
// inline, so a future Salesforce connection reuses this same module rather
// than forking a near-duplicate one — the table itself is already
// provider-agnostic (0010's header).
//
// The refresh token is encrypted (lib/encrypt-secret.ts, AES-256-GCM)
// before it ever reaches a `.insert`/`.upsert` call, and decrypted only in
// getTenantRefreshToken — the one function that actually needs the
// plaintext (to call lib/hubspot/token-exchange.ts's refreshAccessToken).

const DEFAULT_PROVIDER = "hubspot";

export interface SaveTenantTokensInput {
  readonly tenantId: string;
  readonly refreshToken: string;
  /**
   * Optional so lib/hubspot/get-client.ts's rotated-refresh-token
   * re-persist (it only ever learns a new token, never a new scope) can
   * call this without re-fetching the original OAuth grant's scope string.
   * A supabase-js `.upsert` only sets the columns present in the payload —
   * omitting `scope` here leaves an existing row's scope column untouched
   * rather than nulling it out.
   */
  readonly scope?: string;
  readonly externalAccountId?: string | null;
  readonly connectedBy?: string | null;
  readonly provider?: string;
}

/**
 * Upserts on (tenant_id, provider) — a reconnect replaces the prior row's
 * token/scope rather than duplicating it. Row is built with a single
 * spread + conditional scope, immutably — no post-construction mutation of
 * the object handed to `.upsert`.
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
    // (rather than including it as `undefined` or `null`) leaves an
    // existing row's scope column untouched on a rotated-token-only
    // re-persist. See SaveTenantTokensInput.scope's own doc comment.
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
  };

  const { error } = await admin.from("crm_connections").upsert(row, { onConflict: "tenant_id,provider" });

  if (error) {
    throw new Error(`Failed to save the HubSpot connection: ${error.message}`);
  }
}

/**
 * Decrypts and returns the stored refresh token, or `null` when the tenant
 * has no connection for this provider (row genuinely absent — `.maybeSingle()`
 * returns `{ data: null, error: null }` for zero rows, not an error).
 *
 * T52 code review (MEDIUM): a REAL query error (DB outage, permissions,
 * etc.) now throws instead of being folded into the same `null` a missing
 * row produces — a caller (lib/hubspot/get-client.ts) must be able to tell
 * "this tenant genuinely never connected" apart from "we couldn't find out
 * right now"; treating a DB outage as "never connected" would be a silent,
 * incorrect downgrade of a real failure.
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
    throw new Error(`Failed to read the HubSpot connection: ${error.message}`);
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
    throw new Error(`Failed to check the HubSpot connection: ${error.message}`);
  }
  return data !== null;
}

/** Deletes the connection row unconditionally — the caller (hubspot-actions.ts) decides whether an upstream revoke succeeded first. */
export async function deleteTenantTokens(tenantId: string, provider: string = DEFAULT_PROVIDER): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("crm_connections").delete().eq("tenant_id", tenantId).eq("provider", provider);

  if (error) {
    throw new Error(`Failed to delete the HubSpot connection: ${error.message}`);
  }
}
