import type { Metadata } from "next";
import { DEMO_OWNER_EMAIL } from "@/lib/demo";
import { SandboxSimulator } from "./sandbox-simulator";
import { ResetSandbox } from "./reset-sandbox";

// Pitch tool — keep it out of search indexes.
export const metadata: Metadata = {
  title: "Live Demo Engine — Project Ramp",
  robots: { index: false, follow: false },
};

// High-fidelity presets. `name` is the CRM-supplied company name: when present,
// the provisioner uses it verbatim and skips the brand scrape (fast, offline,
// deterministic — ideal on stage). Free-text domains omit it, exercising the
// real SSRF-guarded scraper with its graceful domain fallback (Ticket 21).
const PRESETS = [
  { label: "Stripe", domain: "stripe.com", name: "Stripe" },
  { label: "HubSpot", domain: "hubspot.com", name: "HubSpot" },
  { label: "Vercel", domain: "vercel.com", name: "Vercel" },
];

export default function DemoSandboxPage() {
  return (
    <main>
      <header className="mb-8">
        <p
          className="m-0 mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--seller-mark)" }}
        >
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--seller-mark)" }}
          />
          Seller sandbox
        </p>
        <h1 className="m-0 text-3xl font-semibold tracking-tight sm:text-4xl">Live Demo Engine</h1>
        <p className="m-0 mt-2 max-w-prose text-[0.95rem]" style={{ color: "var(--slate)" }}>
          Fire a mock CRM deal-stage webhook at the real v1.2 provisioning pipeline and watch a
          branded, tenant-isolated buyer workspace spin up live — then share the magic link and open
          it side-by-side.
        </p>
      </header>

      <SandboxSimulator demoOwnerEmail={DEMO_OWNER_EMAIL} presets={PRESETS} />
      <ResetSandbox />
    </main>
  );
}
