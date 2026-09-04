// Sprint 10, Ticket 52 — component-level DOM assertions for
// app/settings/integrations/hubspot-card.tsx (HubSpotConnectionCard) and a
// few pure-function checks for its sibling hubspot-messages.ts. Runs under
// the "components" Vitest project (happy-dom) — see vitest.config.ts.
//
// hubspot-actions.ts is a "use server" module (Server Actions can't run
// inside happy-dom), so it is mocked wholesale, mirroring
// tests/components/invite-panel.dom.spec.tsx and
// tests/components/onboarding-flow.dom.spec.tsx's house style; this file
// only exercises HubSpotConnectionCard's own rendering, never the real
// action body (that is covered against a real Supabase project by
// tests/security/hubspot-disconnect-action.spec.ts instead).
//
// page.tsx itself (the async Server Component that does the
// requireSeller()/isTenantConnected() reads) has no existing spec of its own
// to follow — every neighbouring settings/admin page spec in this repo
// tests the client/presentational piece a page renders, not the async page
// function, so this file follows that same precedent and only covers
// HubSpotConnectionCard plus hubspot-messages.ts's mapHubSpotErrorMessage.
//
// Coverage: not-connected renders the dot+label "Not connected" and a
// Connect HubSpot link (not a form) pointed at the OAuth start route;
// connected renders the dot+label "HubSpot connected" and a Disconnect
// button inside a form bound to the (mocked) disconnectHubSpot action, and
// no Connect link; each redirect-driven notice (connected/disconnected/
// revoke-failed warning/error) renders its own copy independently; no
// role="alert" is used anywhere (the page's own existing error paragraph
// has none either — see page.tsx's precedent); mapHubSpotErrorMessage maps
// every known code and returns null for anything else (including the CRM
// action's free-text sentences, which must keep flowing through unchanged).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { mockDisconnectHubSpot } = vi.hoisted(() => ({
  mockDisconnectHubSpot: vi.fn(),
}));

vi.mock("@/app/settings/integrations/hubspot-actions", () => ({
  disconnectHubSpot: mockDisconnectHubSpot,
}));

import { HubSpotConnectionCard } from "@/app/settings/integrations/hubspot-card";
import { mapHubSpotErrorMessage, REVOKE_FAILED_WARNING_MESSAGE } from "@/app/settings/integrations/hubspot-messages";

afterEach(() => {
  cleanup();
  mockDisconnectHubSpot.mockReset();
});

const BASE_PROPS = {
  isConnected: false,
  justConnected: false,
  justDisconnected: false,
  revokeFailedWarning: false,
  errorMessage: null,
} as const;

describe("HubSpotConnectionCard — not connected", () => {
  it("renders a dot + text 'Not connected' status and a Connect HubSpot link, no Disconnect form", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} />);

    expect(screen.getByText("Not connected")).toBeInTheDocument();

    const connectLink = screen.getByRole("link", { name: "Connect HubSpot" });
    expect(connectLink).toHaveAttribute("href", "/api/integrations/hubspot/oauth/start");

    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });
});

describe("HubSpotConnectionCard — connected", () => {
  it("renders a dot + text 'HubSpot connected' status and a Disconnect button, no Connect link", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} isConnected />);

    expect(screen.getByText("HubSpot connected")).toBeInTheDocument();

    const disconnectButton = screen.getByRole("button", { name: "Disconnect" });
    expect(disconnectButton).toHaveAttribute("type", "submit");
    expect(disconnectButton.closest("form")).toHaveAttribute("action");

    expect(screen.queryByRole("link", { name: "Connect HubSpot" })).not.toBeInTheDocument();
  });

  it("renders an 'Import deals' link to the HubSpot import page (Sprint 11, Ticket 56), plain styling not Signal", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} isConnected />);

    const importLink = screen.getByRole("link", { name: "Import deals" });
    expect(importLink).toHaveAttribute("href", "/admin/import/hubspot");
    expect(importLink).not.toHaveAttribute("data-signal");
  });
});

describe("HubSpotConnectionCard — not connected shows no Import deals link", () => {
  it("renders no 'Import deals' link when not connected", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} />);

    expect(screen.queryByRole("link", { name: "Import deals" })).not.toBeInTheDocument();
  });
});

describe("HubSpotConnectionCard — redirect-driven notices", () => {
  it("shows a success note for ?connected=1", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} justConnected />);
    expect(screen.getByText("HubSpot connected.")).toBeInTheDocument();
  });

  it("shows a note for ?disconnected=1", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} justDisconnected />);
    expect(screen.getByText("HubSpot disconnected.")).toBeInTheDocument();
  });

  it("shows the full explanation for ?warning=revoke_failed", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} revokeFailedWarning />);
    expect(screen.getByText(REVOKE_FAILED_WARNING_MESSAGE)).toBeInTheDocument();
  });

  it("shows a mapped error message when one is supplied", () => {
    render(<HubSpotConnectionCard {...BASE_PROPS} errorMessage="We couldn't complete the HubSpot connection. Try again." />);
    expect(screen.getByText("We couldn't complete the HubSpot connection. Try again.")).toBeInTheDocument();
  });

  it("never uses role=\"alert\" — the page has no precedent for it on this surface", () => {
    render(
      <HubSpotConnectionCard
        {...BASE_PROPS}
        justConnected
        justDisconnected
        revokeFailedWarning
        errorMessage="Something failed."
      />,
    );
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("mapHubSpotErrorMessage", () => {
  const KNOWN_CODES = [
    "unauthenticated",
    "missing_tenant",
    "rate_limited",
    "denied",
    "invalid_state",
    "missing_code",
    "exchange_failed",
    "save_failed",
    "disconnect_failed",
  ];

  it.each(KNOWN_CODES)("maps the known code %s to non-empty friendly copy", (code) => {
    const message = mapHubSpotErrorMessage(code);
    expect(message).toEqual(expect.any(String));
    expect(message).not.toHaveLength(0);
  });

  it("returns null for undefined (no ?error= param present)", () => {
    expect(mapHubSpotErrorMessage(undefined)).toBeNull();
  });

  it("returns null for the CRM save action's free-text error sentences, so they keep rendering as-is", () => {
    expect(mapHubSpotErrorMessage("Pick a stage from the list.")).toBeNull();
    expect(mapHubSpotErrorMessage("Your account has no tenant assigned yet.")).toBeNull();
  });

  it("returns null for an unrecognized code", () => {
    expect(mapHubSpotErrorMessage("some_future_code")).toBeNull();
  });
});
