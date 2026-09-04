// Sprint 11, Ticket 56 — component-level DOM assertions for
// app/settings/integrations/salesforce-card.tsx (SalesforceConnectionCard).
// Mirrors tests/components/hubspot-connection-card.dom.spec.tsx's shape 1:1
// (s/HubSpot/Salesforce/, plus the extra reauthRequiredWarning prop
// salesforce-card.tsx carries — see that file's own header) — see that
// file's header for the full reasoning, unchanged here. Runs under the
// "components" Vitest project (happy-dom) — see vitest.config.ts.
//
// salesforce-actions.ts is a "use server" module (Server Actions can't run
// inside happy-dom), so it is mocked wholesale, same house style as the
// HubSpot card's own spec.
//
// Coverage: not-connected renders the dot+label "Not connected" and a
// Connect Salesforce link (not a form) pointed at the OAuth start route, and
// no "Import deals" link; connected renders the dot+label "Salesforce
// connected", a Disconnect button, an "Import deals" link to
// /admin/import/salesforce (Sprint 11, Ticket 56 navigation — plain link
// styling, never the design system's amber Signal), and no Connect link;
// each redirect-driven notice (connected/disconnected/revoke-failed
// warning/reauth-required warning/error) renders its own copy
// independently; no role="alert" is used anywhere; mapSalesforceErrorMessage
// maps every known sf_-prefixed code and returns null for anything else.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { mockDisconnectSalesforce } = vi.hoisted(() => ({
  mockDisconnectSalesforce: vi.fn(),
}));

vi.mock("@/app/settings/integrations/salesforce-actions", () => ({
  disconnectSalesforce: mockDisconnectSalesforce,
}));

import { SalesforceConnectionCard } from "@/app/settings/integrations/salesforce-card";
import {
  mapSalesforceErrorMessage,
  SALESFORCE_REAUTH_REQUIRED_MESSAGE,
  SALESFORCE_REVOKE_FAILED_WARNING_MESSAGE,
} from "@/app/settings/integrations/salesforce-messages";

afterEach(() => {
  cleanup();
  mockDisconnectSalesforce.mockReset();
});

const BASE_PROPS = {
  isConnected: false,
  justConnected: false,
  justDisconnected: false,
  revokeFailedWarning: false,
  reauthRequiredWarning: false,
  errorMessage: null,
} as const;

describe("SalesforceConnectionCard — not connected", () => {
  it("renders a dot + text 'Not connected' status and a Connect Salesforce link, no Disconnect form, no Import deals link", () => {
    render(<SalesforceConnectionCard {...BASE_PROPS} />);

    expect(screen.getByText("Not connected")).toBeInTheDocument();

    const connectLink = screen.getByRole("link", { name: "Connect Salesforce" });
    expect(connectLink).toHaveAttribute("href", "/api/integrations/salesforce/oauth/start");

    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import deals" })).not.toBeInTheDocument();
  });
});

describe("SalesforceConnectionCard — connected", () => {
  it("renders a dot + text 'Salesforce connected' status and a Disconnect button, no Connect link", () => {
    render(<SalesforceConnectionCard {...BASE_PROPS} isConnected />);

    expect(screen.getByText("Salesforce connected")).toBeInTheDocument();

    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnectButton).toHaveAttribute("type", "submit");
    expect(disconnectButton.closest("form")).toHaveAttribute("action");

    expect(screen.queryByRole("link", { name: "Connect Salesforce" })).not.toBeInTheDocument();
  });

  it("renders an 'Import deals' link to the Salesforce import page, plain styling not Signal", () => {
    render(<SalesforceConnectionCard {...BASE_PROPS} isConnected />);

    const importLink = screen.getByRole("link", { name: "Import deals" });
    expect(importLink).toHaveAttribute("href", "/admin/import/salesforce");
    expect(importLink).not.toHaveAttribute("data-signal");
  });
});

describe("SalesforceConnectionCard — redirect-driven notices", () => {
  it("shows a success note for ?connected=salesforce", () => {
    render(<SalesforceConnectionCard {...BASE_PROPS} justConnected />);
    expect(screen.getByText("Salesforce connected.")).toBeInTheDocument();
  });

  it("shows a note for ?disconnected=salesforce", () => {
    render(<SalesforceConnectionCard {...BASE_PROPS} justDisconnected />);
    expect(screen.getByText("Salesforce disconnected.")).toBeInTheDocument();
  });

  it("shows the full explanation for ?warning=sf_revoke_failed", () => {
    render(<SalesforceConnectionCard {...BASE_PROPS} revokeFailedWarning />);
    expect(screen.getByText(SALESFORCE_REVOKE_FAILED_WARNING_MESSAGE)).toBeInTheDocument();
  });

  it("shows the calm, neutral reauth-required copy for ?error=sf_reauth_required", () => {
    render(<SalesforceConnectionCard {...BASE_PROPS} reauthRequiredWarning />);
    expect(screen.getByText(SALESFORCE_REAUTH_REQUIRED_MESSAGE)).toBeInTheDocument();
  });

  it("shows a mapped error message when one is supplied", () => {
    render(
      <SalesforceConnectionCard
        {...BASE_PROPS}
        errorMessage="We couldn't complete the Salesforce connection. Try again."
      />,
    );
    expect(screen.getByText("We couldn't complete the Salesforce connection. Try again.")).toBeInTheDocument();
  });

  it("never uses role=\"alert\" — the page has no precedent for it on this surface", () => {
    render(
      <SalesforceConnectionCard
        {...BASE_PROPS}
        justConnected
        justDisconnected
        revokeFailedWarning
        reauthRequiredWarning
        errorMessage="Something failed."
      />,
    );
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("mapSalesforceErrorMessage", () => {
  const KNOWN_CODES = [
    "sf_unauthenticated",
    "sf_missing_tenant",
    "sf_rate_limited",
    "sf_denied",
    "sf_invalid_state",
    "sf_missing_code",
    "sf_missing_verifier",
    "sf_exchange_failed",
    "sf_save_failed",
    "sf_disconnect_failed",
  ];

  it.each(KNOWN_CODES)("maps the known code %s to non-empty friendly copy", (code) => {
    const message = mapSalesforceErrorMessage(code);
    expect(message).toEqual(expect.any(String));
    expect(message).not.toHaveLength(0);
  });

  it("returns null for undefined (no ?error= param present)", () => {
    expect(mapSalesforceErrorMessage(undefined)).toBeNull();
  });

  it("returns null for a bare HubSpot code — the two provider sets are disjoint", () => {
    expect(mapSalesforceErrorMessage("unauthenticated")).toBeNull();
    expect(mapSalesforceErrorMessage("rate_limited")).toBeNull();
  });

  it("returns null for an unrecognized code", () => {
    expect(mapSalesforceErrorMessage("some_future_code")).toBeNull();
  });
});
