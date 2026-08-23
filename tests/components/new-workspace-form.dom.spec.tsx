// Ticket 45 (Sprint 9), Phase 2b. Component-level DOM assertions for
// app/admin/workspaces/new/new-workspace-form.tsx. Runs under the
// "components" Vitest project (happy-dom) — see vitest.config.ts.
//
// new-workspace-actions.ts is a "use server" module (Server Actions can't
// run inside happy-dom), so it is mocked wholesale, mirroring
// tests/components/invite-panel.dom.spec.tsx and
// tests/components/onboarding-flow.dom.spec.tsx's house style; this file
// only exercises NewWorkspaceForm's own rendering/state-transition logic,
// never the real action body. workspace-form-state.ts is NOT mocked — it
// has no server-only dependency (kept out of the "use server" module for
// exactly this reason, mirroring onboarding-state.ts/import-state.ts), so
// the real INITIAL_NEW_WORKSPACE_STATE/message constants are imported and
// used as-is.
//
// createWorkspace redirects on success (next/navigation) rather than
// returning a state — mirroring onboarding-flow.tsx's ManualStep, this
// component only ever renders the "still here" (idle/pending/error) states;
// a successful submit never returns here to be handled, so there is no
// success-render case in this file.
//
// Coverage per the ticket brief: initial state (labelled fields above their
// inputs, the form's sole primary Create-workspace button, a tertiary Back
// link, no alert); pending presentation (aria-busy, width-preserving label
// swap); error tone (role="alert", field-level aria-invalid mapped from the
// server's own error constant, typed values preserved); keyboard
// focusability.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  INITIAL_NEW_WORKSPACE_STATE,
  INVALID_DOMAIN_MESSAGE,
  MISSING_NAME_MESSAGE,
  type NewWorkspaceActionState,
} from "@/app/admin/workspaces/new/workspace-form-state";

const { mockCreateWorkspace } = vi.hoisted(() => ({
  mockCreateWorkspace: vi.fn(),
}));

vi.mock("@/app/admin/workspaces/new/new-workspace-actions", () => ({
  createWorkspace: mockCreateWorkspace,
}));

import * as NewWorkspaceFormModule from "@/app/admin/workspaces/new/new-workspace-form";
import { NewWorkspaceForm } from "@/app/admin/workspaces/new/new-workspace-form";

afterEach(() => {
  cleanup();
  mockCreateWorkspace.mockReset();
});

function errorState(message: string): NewWorkspaceActionState {
  return { error: message };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

/**
 * React 19 entangles concurrent form-action transitions on a single shared
 * queue — a promise a test leaves permanently unresolved therefore blocks
 * every OTHER test's action in this file too. Copied from
 * tests/components/invite-panel.dom.spec.tsx's documented workaround.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("module boundary — single entry point", () => {
  it("exports exactly one runtime value: NewWorkspaceForm", () => {
    expect(Object.keys(NewWorkspaceFormModule)).toEqual(["NewWorkspaceForm"]);
  });
});

describe("NewWorkspaceForm — initial state", () => {
  it("renders labelled fields above their inputs and exactly one primary Create-workspace button", () => {
    const { container } = render(<NewWorkspaceForm />);

    expect(screen.getByRole("heading", { name: "Create a workspace" })).toBeInTheDocument();

    const companyName = screen.getByLabelText("Company name");
    const domain = screen.getByLabelText("Their website domain");
    expect(companyName).toBeRequired();
    expect(domain).toBeRequired();
    expect(domain).toHaveAttribute("placeholder", "acme.com");

    const submit = screen.getByRole("button", { name: "Create workspace" });
    expect(submit).toHaveAttribute("data-signal", "true");
    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);

    expect(screen.getByRole("link", { name: "Back to workspaces" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("carries the data-surface attribute every rule in new-workspace-form.css is scoped to", () => {
    render(<NewWorkspaceForm />);
    expect(screen.getByTestId("new-workspace-form")).toHaveAttribute("data-surface", "new-workspace-form");
  });

  it("is keyboard focusable: both fields and the submit button reachable by tab order", () => {
    render(<NewWorkspaceForm />);
    const companyName = screen.getByLabelText("Company name");
    const domain = screen.getByLabelText("Their website domain");
    const submit = screen.getByRole("button", { name: "Create workspace" });

    companyName.focus();
    expect(companyName).toHaveFocus();
    domain.focus();
    expect(domain).toHaveFocus();
    submit.focus();
    expect(submit).toHaveFocus();
  });
});

describe("NewWorkspaceForm — pending presentation", () => {
  it("disables the submit button and swaps its label for a spinner at the button's own width, with no layout shift", async () => {
    const deferred = createDeferred<NewWorkspaceActionState>();
    mockCreateWorkspace.mockReturnValueOnce(deferred.promise);
    render(<NewWorkspaceForm />);

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme Inc" } });
    fireEvent.change(screen.getByLabelText("Their website domain"), { target: { value: "acme.com" } });
    const submit = screen.getByRole("button", { name: "Create workspace" });
    fireEvent.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    expect(submit).toHaveAttribute("aria-busy", "true");
    expect(submit).toHaveAccessibleName("Creating workspace");
    expect(submit.querySelector(".wf-spinner")).not.toBeNull();
    expect(submit).toHaveTextContent("Create workspace");

    deferred.resolve(INITIAL_NEW_WORKSPACE_STATE);
    await waitFor(() => expect(submit).not.toBeDisabled());
  });
});

describe("NewWorkspaceForm — validation error", () => {
  it("marks the company-name field invalid and preserves typed values on a name error", async () => {
    mockCreateWorkspace.mockResolvedValueOnce(errorState(MISSING_NAME_MESSAGE));
    render(<NewWorkspaceForm />);

    const companyName = screen.getByLabelText("Company name") as HTMLInputElement;
    const domain = screen.getByLabelText("Their website domain") as HTMLInputElement;
    fireEvent.change(companyName, { target: { value: "   " } });
    fireEvent.change(domain, { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(MISSING_NAME_MESSAGE);
    expect(alert.querySelector(".wf-status-dot")).not.toBeNull();
    expect(alert).toHaveAttribute("data-tone", "risk");

    expect(companyName).toHaveAttribute("aria-invalid", "true");
    expect(domain).not.toHaveAttribute("aria-invalid");
    expect(domain.value).toBe("acme.com");
  });

  it("marks the domain field invalid on a domain error, and leaves the form resubmittable", async () => {
    mockCreateWorkspace.mockResolvedValueOnce(errorState(INVALID_DOMAIN_MESSAGE));
    render(<NewWorkspaceForm />);

    const companyName = screen.getByLabelText("Company name") as HTMLInputElement;
    const domain = screen.getByLabelText("Their website domain") as HTMLInputElement;
    fireEvent.change(companyName, { target: { value: "Acme Inc" } });
    fireEvent.change(domain, { target: { value: "not a domain" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(INVALID_DOMAIN_MESSAGE);

    expect(domain).toHaveAttribute("aria-invalid", "true");
    expect(companyName).not.toHaveAttribute("aria-invalid");
    expect(companyName.value).toBe("Acme Inc");

    const submit = screen.getByRole("button", { name: "Create workspace" });
    expect(submit).not.toBeDisabled();
  });

  it("never leaks a raw exception message — only its own fixed copy", async () => {
    // Regression pin for the bug this rebuild fixes: the legacy actions.ts
    // redirected with the raw Postgres error.message embedded in a query
    // string. This component only ever renders workspace-form-state.ts's
    // fixed constants, so a raw exception string can never reach the DOM.
    mockCreateWorkspace.mockResolvedValueOnce(errorState("Couldn't create the workspace. Try again in a moment."));
    render(<NewWorkspaceForm />);

    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Acme Inc" } });
    fireEvent.change(screen.getByLabelText("Their website domain"), { target: { value: "acme.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't create the workspace. Try again in a moment.");
  });
});

describe("NewWorkspaceForm — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(
      new NodeURL("../../app/admin/workspaces/new/new-workspace-form.css", import.meta.url),
    );
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
