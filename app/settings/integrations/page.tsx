import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DEFAULT_TRIGGER_STAGE } from "@/lib/crm/trigger-stage";
import { MOCK_PIPELINE_STAGES } from "@/lib/crm/stages";
import { isTenantConnected } from "@/lib/crm-connections/token-store";
import { requireSeller } from "@/lib/plans/require-seller";
import { saveTriggerStage } from "./actions";
import { HubSpotConnectionCard } from "./hubspot-card";
import { mapHubSpotErrorMessage } from "./hubspot-messages";
import { SalesforceConnectionCard } from "./salesforce-card";
import { mapSalesforceErrorMessage } from "./salesforce-messages";

// CRM Custom Stage Mapping (Sprint 3, Ticket 16). Static component shell —
// the pipeline dropdown is seeded from the mock stage array, not a live CRM
// handshake (no OAuth in v1.2). Reads/writes go through the RLS-scoped
// client, so everything here is tenant-bounded at the DB layer.
//
// Sprint 10, Ticket 52 added the HubSpot connection card below — that is a
// real OAuth handshake (see app/api/integrations/hubspot/oauth/*), the CRM
// stage mapping above still isn't. Sprint 11, Ticket 55 added the Salesforce
// connection card the same way (see app/api/integrations/salesforce/oauth/*).
export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    connected?: string;
    disconnected?: string;
    warning?: string;
  }>;
}) {
  const { saved, error, connected, disconnected, warning } = await searchParams;

  // requireSeller() (T28-9) replaces this page's own inline
  // auth.getUser()-and-redirect (Sprint 3 shape) — same underlying check,
  // but also hands back tenantId, which the HubSpot/Salesforce cards need
  // for isTenantConnected below.
  const seller = await requireSeller();
  if (!seller) {
    redirect("/admin/login"); // middleware already enforces this; defense in depth
  }
  const supabase = seller.client;

  // Any of the tenant's workspaces is representative — Save keeps them
  // tenant-consistent (see actions.ts). No workspaces yet → DB default.
  // A tenant-less account (provisioning never completed) can't have a
  // HubSpot or Salesforce connection either, so isTenantConnected is skipped
  // rather than called with a null id.
  const [{ data: workspace }, isHubSpotConnected, isSalesforceConnected] = await Promise.all([
    supabase.from("workspaces").select("trigger_stage").limit(1).maybeSingle(),
    seller.tenantId ? isTenantConnected(seller.tenantId) : Promise.resolve(false),
    seller.tenantId ? isTenantConnected(seller.tenantId, "salesforce") : Promise.resolve(false),
  ]);
  const currentStage = workspace?.trigger_stage ?? DEFAULT_TRIGGER_STAGE;
  const selectedStage =
    MOCK_PIPELINE_STAGES.find((stage) => stage.toLowerCase() === currentStage.toLowerCase()) ??
    MOCK_PIPELINE_STAGES[2];

  // The HubSpot OAuth routes and disconnectHubSpot (hubspot-actions.ts)
  // redirect back to this same page with `?error=<code>` from a small closed
  // set — the SAME query param the CRM trigger-stage save action below
  // already uses for its own free-text error sentences (see
  // hubspot-messages.ts's header for the full reasoning). hubspotErrorMessage
  // is non-null only when `error` is a recognized HubSpot code, so the CRM
  // card's own error paragraph is suppressed in that case rather than
  // showing the raw code a second time. salesforceErrorMessage is the same
  // idea for the Salesforce routes' own `sf_`-prefixed closed set (see
  // app/api/integrations/salesforce/oauth/callback/route.ts's header) — the
  // two sets are disjoint by construction, so at most one of these two is
  // ever non-null for a given `?error=` value.
  const hubspotErrorMessage = mapHubSpotErrorMessage(error);
  const salesforceErrorMessage = mapSalesforceErrorMessage(error);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <p className="m-0 text-sm">
          <Link href="/admin" className="text-neutral-500 no-underline hover:underline dark:text-neutral-400">
            ← Back to dashboard
          </Link>
        </p>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="m-0 text-sm text-neutral-500 dark:text-neutral-400">
          Align automated workspace provisioning with your CRM pipeline.
        </p>
      </div>

      <HubSpotConnectionCard
        isConnected={isHubSpotConnected}
        justConnected={connected === "1"}
        justDisconnected={disconnected === "1"}
        revokeFailedWarning={warning === "revoke_failed"}
        errorMessage={hubspotErrorMessage}
      />

      <SalesforceConnectionCard
        isConnected={isSalesforceConnected}
        justConnected={connected === "salesforce"}
        justDisconnected={disconnected === "salesforce"}
        revokeFailedWarning={warning === "sf_revoke_failed"}
        reauthRequiredWarning={error === "sf_reauth_required"}
        errorMessage={salesforceErrorMessage}
      />

      <Card>
        <form action={saveTriggerStage} className="m-0 flex max-w-none flex-col gap-0 p-0">
          <CardHeader>
            <CardTitle>CRM stage mapping</CardTitle>
            <CardDescription>
              When a HubSpot or Salesforce deal-stage webhook matches the trigger stage below, a buyer
              workspace is provisioned automatically. Any other stage is skipped.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Label htmlFor="trigger_stage">
              Trigger stage
              <Select id="trigger_stage" name="trigger_stage" defaultValue={selectedStage}>
                {MOCK_PIPELINE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </Select>
            </Label>
            <p className="m-0 text-xs text-neutral-500 dark:text-neutral-400">
              Stages come from a static mock pipeline in v1.2 — no live CRM connection. Matching is
              case-insensitive.
            </p>
            {saved ? (
              <p className="m-0 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                Trigger stage saved.
              </p>
            ) : null}
            {error && !hubspotErrorMessage && !salesforceErrorMessage ? (
              <p className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button type="submit">Save Settings</Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
