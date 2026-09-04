import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { disconnectSalesforce } from "./salesforce-actions";
import { SALESFORCE_REAUTH_REQUIRED_MESSAGE, SALESFORCE_REVOKE_FAILED_WARNING_MESSAGE } from "./salesforce-messages";

// Sprint 11, Ticket 55 — the settings page's Salesforce connection card.
// Mirrors app/settings/integrations/hubspot-card.tsx's shape 1:1 (plain,
// non-async presentational component; page.tsx does the tenant lookup and
// isTenantConnected() read and hands down resolved booleans/copy) — see that
// file's header for the reasoning, unchanged here.
export interface SalesforceConnectionCardProps {
  /** lib/crm-connections/token-store.ts's isTenantConnected(tenantId, "salesforce") result for this seller's tenant. */
  readonly isConnected: boolean;
  /** ?connected=salesforce — the OAuth callback route just finished successfully. */
  readonly justConnected: boolean;
  /** ?disconnected=salesforce — disconnectSalesforce just finished, revoke included. */
  readonly justDisconnected: boolean;
  /** ?warning=sf_revoke_failed — disconnectSalesforce's local delete succeeded, but the Salesforce-side revoke call failed. */
  readonly revokeFailedWarning: boolean;
  /**
   * Forward groundwork for T56 (see salesforce-messages.ts's
   * SALESFORCE_REAUTH_REQUIRED_MESSAGE) — nothing redirects with this yet.
   * Deliberately its own calm, neutral-toned box, not the red error one:
   * an expired refresh token is an EXPECTED Salesforce lifecycle event
   * (per-org admin-controlled expiry policy), not a failure to alarm the
   * seller about.
   */
  readonly reauthRequiredWarning: boolean;
  /** Pre-mapped by page.tsx via salesforce-messages.ts's mapSalesforceErrorMessage; null when `?error=` isn't a recognized Salesforce code. */
  readonly errorMessage: string | null;
}

const SALESFORCE_OAUTH_START_PATH = "/api/integrations/salesforce/oauth/start";

export function SalesforceConnectionCard({
  isConnected,
  justConnected,
  justDisconnected,
  revokeFailedWarning,
  reauthRequiredWarning,
  errorMessage,
}: SalesforceConnectionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Salesforce</CardTitle>
        <CardDescription>
          Connect Salesforce so a deal-stage change can trigger the workspace provisioning below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ConnectionStatus isConnected={isConnected} />

        {justConnected ? (
          <p className="m-0 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Salesforce connected.
          </p>
        ) : null}
        {justDisconnected ? (
          <p className="m-0 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            Salesforce disconnected.
          </p>
        ) : null}
        {revokeFailedWarning ? (
          <p className="m-0 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            {SALESFORCE_REVOKE_FAILED_WARNING_MESSAGE}
          </p>
        ) : null}
        {reauthRequiredWarning ? (
          <p className="m-0 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            {SALESFORCE_REAUTH_REQUIRED_MESSAGE}
          </p>
        ) : null}
        {errorMessage ? (
          <p className="m-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
      <CardFooter>
        {isConnected ? (
          <form action={disconnectSalesforce} className="m-0">
            <Button type="submit" variant="outline">
              Disconnect
            </Button>
          </form>
        ) : (
          // Plain <a>, not <Button> — this navigates a GET route rather than
          // submitting a form, same reasoning as hubspot-card.tsx's identical
          // choice (see that file's comment). Deliberately the page's
          // standard button style, not the design system's amber Signal:
          // this page already has one primary action (Save Settings) in
          // scope, and Signal is one-per-decision-scope.
          <a href={SALESFORCE_OAUTH_START_PATH} className={buttonClassName("default")}>
            Connect Salesforce
          </a>
        )}
      </CardFooter>
    </Card>
  );
}

/** Status is never colour-only (design system MUST) — always a dot next to a text label. */
function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
  return (
    <span
      className="inline-flex w-fit items-center gap-2 rounded-full border border-neutral-200 px-3 py-1 text-sm font-medium text-neutral-900 dark:border-neutral-800 dark:text-neutral-50"
      data-connected={isConnected}
    >
      <span
        aria-hidden="true"
        className={
          isConnected
            ? "h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400"
            : "h-1.5 w-1.5 rounded-full bg-neutral-400 dark:bg-neutral-600"
        }
      />
      {isConnected ? "Salesforce connected" : "Not connected"}
    </span>
  );
}
