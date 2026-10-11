// T67 (public site). DOM assertions for app/security/page.tsx, mirroring
// legal-pages.dom.spec.tsx. Runs under the "components" Vitest project.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SecurityPage, { metadata } from "@/app/security/page";

afterEach(() => {
  cleanup();
});

describe("Security page", () => {
  it("renders the h1 and key sections", () => {
    render(<SecurityPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Security" })).toBeInTheDocument();
    for (const name of [
      "How your data is stored",
      "Accounts and sign-in",
      "Payments",
      "Email",
      "Backups",
      "What we don't offer yet",
      "Reporting a security issue",
    ]) {
      expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    }
  });

  it("links the security contact by mailto", () => {
    render(<SecurityPage />);
    expect(screen.getByRole("link", { name: "dimas@getbrava.tech" })).toHaveAttribute(
      "href",
      "mailto:dimas@getbrava.tech",
    );
  });

  it("makes no certification, SLA or wrong-domain claims", () => {
    render(<SecurityPage />);
    const text = screen.getByTestId("legal-page").textContent ?? "";
    expect(text).not.toMatch(/SOC 2 certified/i);
    expect(text).not.toMatch(/SLA guarantee/i);
    expect(text).not.toMatch(/getbrava\.io/i);
  });

  it("states the not-yet-offered items plainly", () => {
    render(<SecurityPage />);
    const text = screen.getByTestId("legal-page").textContent ?? "";
    expect(text).toMatch(/single sign-on/i);
    expect(text).toMatch(/uptime/i);
    expect(text).toMatch(/SOC 2 report/i);
  });

  it("has a title and description and a way back home", () => {
    render(<SecurityPage />);
    expect(metadata.title).toBe("Security — Brava");
    expect(metadata.description).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to brava/i })).toHaveAttribute("href", "/");
  });

  it("uses design tokens only, never a raw hex value", () => {
    const cssPath = fileURLToPath(new NodeURL("../../app/security/security.css", import.meta.url));
    expect(readFileSync(cssPath, "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
