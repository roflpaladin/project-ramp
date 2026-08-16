// T43 (Sprint 8, Ticket 43 — "Own-inbox buyer invite & instant flip"). Component-level DOM
// assertions for app/admin/workspaces/[id]/invite-panel.tsx. Runs under the "components" Vitest
// project (happy-dom) — see vitest.config.ts.
//
// invite-actions.ts is a "use server" module (Server Actions can't run inside happy-dom — there is
// no Next.js server runtime backing cookies()/headers()/Supabase there) — mocked wholesale so this
// file only exercises InvitePanel's own rendering/state-transition logic, never the real action
// bodies (those are covered against a real Supabase project by
// tests/security/invite-actions.spec.ts instead).
//
// Coverage per the ticket brief: idle renders a labelled input + the card's sole primary
// Send-invite button and no flip; "sent" names the invited address and hands the card's one Signal
// to the flip button while Send invite drops to secondary; "cooldown"/"error" render recoverable
// dot+text status using the server's own message, input still editable; the "use my email"
// affordance fills the input; the send button's pending presentation swaps a spinner in at its own
// width; a static grep proves no hardcoded hex colour (house convention, see stall-alert.dom.spec.tsx).

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SendInviteState } from "@/app/admin/workspaces/[id]/invite-actions";

const { mockSendBuyerInvite, mockFlipToBuyerView } = vi.hoisted(() => ({
  mockSendBuyerInvite: vi.fn(),
  mockFlipToBuyerView: vi.fn(),
}));

vi.mock("@/app/admin/workspaces/[id]/invite-actions", () => ({
  INITIAL_SEND_INVITE_STATE: { status: "idle", email: null, message: null },
  sendBuyerInvite: mockSendBuyerInvite,
  flipToBuyerView: mockFlipToBuyerView,
}));

import * as InvitePanelModule from "@/app/admin/workspaces/[id]/invite-panel";
import { InvitePanel } from "@/app/admin/workspaces/[id]/invite-panel";

afterEach(() => {
  cleanup();
  mockSendBuyerInvite.mockReset();
  mockFlipToBuyerView.mockReset();
});

const WORKSPACE_ID = "ws-1";

function sentState(email: string): SendInviteState {
  return { status: "sent", email, message: `Invite sent to ${email}.` };
}

function cooldownState(email: string, waitSeconds: number): SendInviteState {
  return {
    status: "cooldown",
    email,
    message: `A code was already sent to this address recently — try again in ${waitSeconds}s.`,
  };
}

function errorState(message: string): SendInviteState {
  return { status: "error", email: null, message };
}

async function submitInvite(email: string): Promise<void> {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/**
 * React 19 entangles concurrent form-action transitions on a single shared
 * queue (so submissions resolve in order) — a promise a test leaves
 * permanently unresolved therefore blocks every OTHER test's action in this
 * file too, not just its own. The pending-presentation test below needs to
 * freeze mid-flight to assert the spinner, so it uses this instead of a bare
 * `new Promise(() => {})`, resolving it before the test ends.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("module boundary — single entry point", () => {
  it("exports exactly one runtime value: InvitePanel", () => {
    expect(Object.keys(InvitePanelModule)).toEqual(["InvitePanel"]);
  });
});

describe("InvitePanel — idle", () => {
  it("renders a labelled email input and exactly one primary Send-invite button, no flip, no status", () => {
    const { container } = render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail="ae@getbrava.io" />);

    expect(screen.getByRole("heading", { name: "Invite your buyer" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();

    const sendButton = screen.getByRole("button", { name: "Send invite" });
    expect(sendButton).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    expect(screen.queryByRole("button", { name: "Open buyer view" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries the data-surface attribute every rule in invite-panel.css is scoped to (T43 review regression)", () => {
    // Review finding: the stylesheet's selectors are all rooted at
    // [data-surface="invite-panel"], and nothing in build/lint/typecheck
    // notices a CSS file whose selectors simply never match — the panel
    // shipped unstyled. This pins the component half of that contract.
    render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={null} />);
    expect(screen.getByTestId("invite-panel")).toHaveAttribute("data-surface", "invite-panel");
  });

  it("orients with one sentence naming what this card does", () => {
    render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={null} />);
    expect(screen.getByText(/Invite your buyer to the deal room/)).toBeInTheDocument();
  });

  it("hides the 'use my email' affordance when the seller has no email on file", () => {
    render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={null} />);
    expect(screen.queryByRole("button", { name: "Use my email" })).not.toBeInTheDocument();
  });
});

describe("InvitePanel — 'use my email' affordance", () => {
  it("fills the email field with the seller's own address on click, without submitting", () => {
    render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail="ae@getbrava.io" />);
    const input = screen.getByLabelText("Email") as HTMLInputElement;
    expect(input.value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Use my email" }));

    expect(input.value).toBe("ae@getbrava.io");
    expect(mockSendBuyerInvite).not.toHaveBeenCalled();
  });
});

describe("InvitePanel — pending presentation", () => {
  it("disables the send button and swaps its label for a spinner at the button's own width, with no layout shift", async () => {
    const deferred = createDeferred<SendInviteState>();
    mockSendBuyerInvite.mockReturnValueOnce(deferred.promise);
    render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={null} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "buyer@acme.example" } });
    const sendButton = screen.getByRole("button", { name: "Send invite" });
    fireEvent.click(sendButton);

    await waitFor(() => expect(sendButton).toBeDisabled());
    expect(sendButton).toHaveAttribute("aria-busy", "true");
    expect(sendButton).toHaveAccessibleName("Sending invite");
    expect(sendButton.querySelector(".ip-spinner")).not.toBeNull();

    // The label stays in the DOM (opacity only) rather than being removed —
    // that's what keeps the button at its own width instead of reflowing.
    expect(sendButton).toHaveTextContent("Send invite");

    // Settle before the test ends: an unresolved action would otherwise
    // entangle and block every later test's own action (see createDeferred).
    deferred.resolve(sentState("buyer@acme.example"));
    await waitFor(() => expect(sendButton).not.toBeDisabled());
  });
});

describe("InvitePanel — sent to the seller's own inbox", () => {
  // The flip is own-inbox only (T43 follow-up, A3 ownership audit): it
  // renders solely when the invited address is the seller's own, mirroring
  // flipToBuyerView's server-side rule. sellerEmail arrives raw from auth —
  // mixed case here on purpose, to pin the case-insensitive comparison
  // against the action's normalized (lowercased) state.email.
  const SELLER_EMAIL = "AE@getbrava.io";
  const SELLER_EMAIL_NORMALIZED = "ae@getbrava.io";

  it("names the invited address, gives the flip button the card's one Signal, and drops Send invite to secondary", async () => {
    mockSendBuyerInvite.mockResolvedValueOnce(sentState(SELLER_EMAIL_NORMALIZED));
    const { container } = render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={SELLER_EMAIL} />);

    await submitInvite(SELLER_EMAIL_NORMALIZED);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(`Invite sent to ${SELLER_EMAIL_NORMALIZED}.`);
    expect(status.querySelector("[data-status-dot]")).not.toBeNull();
    expect(status).toHaveAttribute("data-tone", "done");

    const flipButton = screen.getByRole("button", { name: "Open buyer view" });
    expect(flipButton).toHaveAttribute("data-signal", "true");

    const sendButton = screen.getByRole("button", { name: "Send invite" });
    expect(sendButton).not.toHaveAttribute("data-signal");

    // Exactly one Signal element in the card, ever — it just changed hands.
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });

  it("carries the invited email on the flip form as a hidden field", async () => {
    mockSendBuyerInvite.mockResolvedValueOnce(sentState(SELLER_EMAIL_NORMALIZED));
    const { container } = render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={SELLER_EMAIL} />);

    await submitInvite(SELLER_EMAIL_NORMALIZED);
    await screen.findByRole("button", { name: "Open buyer view" });

    const hiddenInput = container.querySelector('input[type="hidden"][name="email"]') as HTMLInputElement;
    expect(hiddenInput.value).toBe(SELLER_EMAIL_NORMALIZED);
  });
});

describe("InvitePanel — sent to a real buyer's address (own-inbox rule)", () => {
  it("confirms the send but renders NO flip button, and Send invite keeps the card's one Signal", async () => {
    // A3 ownership regression (T43 follow-up): a buyer-bound invite must
    // never offer a button that would enter the portal as the buyer — the
    // server refuses it, so the UI must not render it. The send confirmation
    // itself is unchanged.
    mockSendBuyerInvite.mockResolvedValueOnce(sentState("buyer@acme.example"));
    const { container } = render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail="ae@getbrava.io" />);

    await submitInvite("buyer@acme.example");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Invite sent to buyer@acme.example.");
    expect(status).toHaveAttribute("data-tone", "done");

    expect(screen.queryByRole("button", { name: "Open buyer view" })).not.toBeInTheDocument();
    const sendButton = screen.getByRole("button", { name: "Send invite" });
    expect(sendButton).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });
});

describe("InvitePanel — cooldown (recoverable)", () => {
  it("renders a dot+text status with the server's own message, no flip, Send invite stays the one primary", async () => {
    mockSendBuyerInvite.mockResolvedValueOnce(cooldownState("buyer@acme.example", 42));
    const { container } = render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={null} />);

    await submitInvite("buyer@acme.example");

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("A code was already sent to this address recently — try again in 42s.");
    expect(status.querySelector("[data-status-dot]")).not.toBeNull();
    expect(status).toHaveAttribute("data-tone", "wait");

    expect(screen.queryByRole("button", { name: "Open buyer view" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).not.toBeDisabled();

    const sendButton = screen.getByRole("button", { name: "Send invite" });
    expect(sendButton).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
  });
});

describe("InvitePanel — error (recoverable)", () => {
  // A syntactically valid address (native `type="email"` constraint
  // validation would otherwise block the submit event before it ever reaches
  // sendBuyerInvite — exactly as it should for a client-detectable typo, but
  // that's a browser-native concern, not this component's error branch).
  // This exercises the server-side failure path instead (e.g. SEND_FAILED_MESSAGE
  // in invite-actions.ts) — a plausible email the backend still couldn't send to.
  it("renders a dot+text alert with the server's own message, and lets the user correct and resubmit", async () => {
    mockSendBuyerInvite.mockResolvedValueOnce(errorState("Couldn't send the invite email. Try again in a moment."));
    render(<InvitePanel workspaceId={WORKSPACE_ID} sellerEmail={null} />);

    await submitInvite("buyer@acme.example");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't send the invite email. Try again in a moment.");
    expect(alert.querySelector("[data-status-dot]")).not.toBeNull();
    expect(alert).toHaveAttribute("data-tone", "risk");

    const input = screen.getByLabelText("Email") as HTMLInputElement;
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).not.toBeDisabled();
    expect(input.value).toBe("buyer@acme.example");
  });
});

describe("InvitePanel — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/admin/workspaces/[id]/invite-panel.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
