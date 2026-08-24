// Sprint 10, Ticket 54, Phase 2. Component-level DOM assertions for
// components/crm/crm-mapping-preview.tsx. Runs under the "components"
// Vitest project (happy-dom) — see vitest.config.ts.
//
// PROVISIONAL / mock-seamed — built entirely against mocks of a readonly
// CrmFieldMapping[] (lib/crm/import-ui-types.ts). No API call is exercised
// in this file.
//
// Coverage per the ticket brief: every mapping row renders (source label,
// target field or an explicit "not mapped" marker, sample value); a null
// targetField is visibly marked "not mapped" with dot + text in the
// neutral/wait tone (never risk — unmapped is not an error); a null
// sampleValue falls back to an em dash; no row is ever dropped.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { CrmFieldMapping } from "@/lib/crm-import/types";
import { CrmMappingPreview } from "@/components/crm/crm-mapping-preview";

afterEach(() => {
  cleanup();
});

const MAPPINGS: readonly CrmFieldMapping[] = [
  { sourceField: "dealname", sourceLabel: "Deal name", targetField: "name", sampleValue: "Acme renewal" },
  { sourceField: "amount", sourceLabel: "Amount", targetField: "amount", sampleValue: "12000" },
  { sourceField: "hs_lead_status", sourceLabel: "Lead status", targetField: null, sampleValue: "OPEN" },
  { sourceField: "custom_field_42", sourceLabel: "Renewal quarter", targetField: null, sampleValue: null },
];

describe("CrmMappingPreview — every row renders, none dropped", () => {
  it("lists every mapping row by source label", () => {
    render(<CrmMappingPreview mappings={MAPPINGS} />);

    for (const mapping of MAPPINGS) {
      expect(screen.getByText(mapping.sourceLabel)).toBeInTheDocument();
    }

    expect(screen.getAllByRole("row")).toHaveLength(MAPPINGS.length + 1); // + header row
  });

  it("shows the mapped target field for mapped rows", () => {
    render(<CrmMappingPreview mappings={MAPPINGS} />);

    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("marks unmapped rows visibly with dot + 'Not mapped' text, in the neutral/wait tone", () => {
    render(<CrmMappingPreview mappings={MAPPINGS} />);

    const notMappedMarkers = screen.getAllByText("Not mapped");
    expect(notMappedMarkers).toHaveLength(2);

    for (const marker of notMappedMarkers) {
      const status = marker.closest(".cmp-status");
      expect(status).not.toBeNull();
      expect(status).toHaveAttribute("data-tone", "wait");
      expect(status?.querySelector(".cmp-status-dot")).not.toBeNull();
    }
  });

  it("falls back to an em dash for a null sample value, and renders a real sample value verbatim", () => {
    render(<CrmMappingPreview mappings={MAPPINGS} />);

    expect(screen.getByText("Acme renewal")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("CrmMappingPreview — CSS carries no hardcoded colours", () => {
  it("uses design tokens only, never a raw hex value", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath, URL: NodeURL } = await import("node:url");
    const cssPath = fileURLToPath(new NodeURL("../../components/crm/crm-mapping-preview.css", import.meta.url));
    const css = readFileSync(cssPath, "utf8");

    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});
