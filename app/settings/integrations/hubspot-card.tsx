import { Button, buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { disconnectHubSpot } from "./hubspot-actions";
import { REVOKE_FAILED_WARNING_MESSAGE } from "./hubspot-messages";

// Sprint 10, Ticket 52 — the settings page's HubSpot connection card.
// Plain (non-async) presentational component: page.tsx does the tenant
// lookup and isTenantConnected() read, then hands the resolved booleans/copy
// down as props, which also keeps this file renderable in an RTL test
// without a Next server runtime behind it.
export interface HubSpotConnectionCardProps {
  /** lib/crm-connections/token-store.ts's isTenantConnected() result for this seller's tenant. */
  readonly isConnected: boolean;
  /** ?connected=1 — the OAuth callback route just finished successfully. */
  readonly justConnected: boolean;
  /** ?disconnected=1 — disconnectHubSpot just finished, revoke included. */
  readonly justDisconnected: boolean;
  /** ?warning=revoke_failed — disconnectHubSpot's local delete succeeded, but the HubSpot-side revoke call failed. */
  readonly revokeFailedWarning: boolean;
  /** Pre-mapped by page.tsx via hubspot-messages.ts's mapHubSpotErrorMessage; null when `?error=` isn't a recognized HubSpot code. */
  readonly errorMessage: string | null;
}

const HUBSPOT_OAUTH_START_PATH = "/api/integrations/hubspot/oauth/start";

export function HubSpotConnectionCard({
  isConnected,
  justConnected,
  justDisconnected,
  revokeFailedWarning,
  errorMessage,
}: HubSpotConnectionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>HubSpot</CardTitle>
        <CardDescription>
          Connect HubSpot so a deal-stage webhook can trigger the workspace provisioning below.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ConnectionStatus isConnected={isConnected} />

        {justConnected ? (
          <p className="m-0 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            HubSpot connected.
          </p>
        ) : null}
        {justDisconnected ? (
          <p className="m-0 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            HubSpot disconnected.
          </p>
        ) : null}
        {revokeFailedWarning ? (
          <p className="m-0 rounded-md bg-neutral-100 px-3 py-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            {REVOKE_FAILED_WARNING_MESSAGE}
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
          <form action={disconnectHubSpot} className="m-0">
            <Button type="submit" variant="outline">
              Disconnect
            </Button>
          </form>
        ) : (
          // Plain <a>, not <Button>, because this navigates a GET route
          // rather than submitting a form — buttonClassName keeps it
          // visually identical to the page's other primary button
          // (Save Settings) without duplicating its Tailwind classes.
          // Deliberately the page's standard button style, not the design
          // system's amber Signal: this page already has one primary action
          // (Save Settings) in scope, and Signal is one-per-decision-scope.
          <a href={HUBSPOT_OAUTH_START_PATH} className={buttonClassName("default")}>
            Connect HubSpot
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
      {isConnected ? "HubSpot connected" : "Not connected"}
    </span>
  );
}
