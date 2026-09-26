// Sprint 12 follow-up. app/admin/page.tsx — the seller's workspace list, the
// first page a seller sees. Before this change "Create Workspace" and every
// workspace link rendered as raw browser-default blue/purple anchors (no
// theme, no dark mode) and the CTA read title case instead of the design
// system's sentence case. Component-level DOM assertions, mocking
// lib/supabase/server the way tests/components/plan-read-only.dom.spec.tsx
// does — DB-free.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const { mockCreateClient } = vi.hoisted(() => ({ mockCreateClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mockCreateClient }));

vi.mock("./actions", () => ({ signOut: vi.fn() }));

const { default: AdminHome } = await import("@/app/admin/page");

interface Workspace {
  id: string;
  target_company_name: string;
  target_domain: string;
}

function stubSupabase(user: { email: string } | null, workspaces: Workspace[]) {
  mockCreateClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({
        order: async () => ({ data: workspaces }),
      }),
    }),
  });
}

afterEach(() => {
  cleanup();
  mockCreateClient.mockReset();
});

describe("AdminHome — has workspaces", () => {
  it("renders 'Create workspace' in sentence case, not title case", async () => {
    stubSupabase({ email: "seller@example.com" }, [
      { id: "ws-1", target_company_name: "Acme Co", target_domain: "acme.com" },
    ]);

    render(await AdminHome());

    expect(screen.getByRole("link", { name: "Create workspace" })).toBeInTheDocument();
    expect(screen.queryByText("Create Workspace")).not.toBeInTheDocument();
  });

  it("styles the create-workspace link and workspace links with theme tokens, not the browser default", async () => {
    stubSupabase({ email: "seller@example.com" }, [
      { id: "ws-1", target_company_name: "Acme Co", target_domain: "acme.com" },
    ]);

    render(await AdminHome());

    const createLink = screen.getByRole("link", { name: "Create workspace" });
    expect(createLink.getAttribute("style")).toMatch(/var\(--(ink|paper|line)\)/);

    const workspaceLink = screen.getByRole("link", { name: "Acme Co (acme.com)" });
    expect(workspaceLink.getAttribute("style")).toMatch(/var\(--ink\)/);
  });

  it("carries no Signal in this branch — an existing workspace list is navigation, not a single primary decision", async () => {
    stubSupabase({ email: "seller@example.com" }, [
      { id: "ws-1", target_company_name: "Acme Co", target_domain: "acme.com" },
    ]);

    const { container } = render(await AdminHome());

    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(0);
  });
});

describe("AdminHome — zero workspaces (regression)", () => {
  it("still shows exactly one Signal action for a brand-new seller", async () => {
    stubSupabase({ email: "seller@example.com" }, []);

    const { container } = render(await AdminHome());

    expect(container.querySelectorAll('[data-signal="true"]')).toHaveLength(1);
    expect(screen.getByRole("link", { name: /set up your first deal/i })).toHaveAttribute("data-signal", "true");
  });
});
