"use client";

import { useState } from "react";

type Preset = { label: string; domain: string; name: string };
type Status = "idle" | "running" | "done" | "error";
type WebhookResponse = { success?: boolean; workspace_id?: string; message?: string };

const STEPS = [
  "Ingesting mock CRM webhook",
  "Scraping brand metadata securely",
  "Provisioning tenant-isolated workspace",
] as const;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Rough client-side domain sanity check — the server (lib/domain.ts) is the
// real validator; this only catches obvious typos before we fire.
const DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export function SandboxSimulator({
  demoOwnerEmail,
  presets,
}: {
  demoOwnerEmail: string;
  presets: Preset[];
}) {
  const [domain, setDomain] = useState("");
  // Company name comes from a preset; free-text entry clears it so the real
  // scraper runs (and gracefully falls back to the domain) during provisioning.
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<{ workspaceId: string; magicLink: string; company: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const running = status === "running";

  function applyPreset(preset: Preset) {
    if (running) return;
    setDomain(preset.domain);
    setCompanyName(preset.name);
  }

  function onDomainChange(value: string) {
    setDomain(value);
    setCompanyName(null);
  }

  async function simulate() {
    const cleanDomain = domain.trim().toLowerCase();
    if (!DOMAIN_RE.test(cleanDomain)) {
      setStatus("error");
      setResult(null);
      setError("Enter a valid buyer domain, e.g. stripe.com");
      return;
    }

    setStatus("running");
    setError(null);
    setResult(null);
    setCopied(false);
    setStep(0);

    // Hydrated mock body matching the v1.2 HubSpot contract (lib/crm/parse.ts).
    // owner_email is the seeded demo AE (Ticket 17), so the REAL provisioner
    // resolves it to the demo tenant → 201 instead of the 401 owner-lookup
    // failure. dealstage must be "evaluation" — the demo tenant's trigger stage
    // (DB default / Ticket 16). A unique dealId per click provisions a fresh
    // workspace every time (the tenant+CRM unique index would 409 a repeat).
    const body = {
      dealId: `demo-${cleanDomain.replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
      domain: cleanDomain,
      ...(companyName ? { name: companyName } : {}),
      buyer_emails: [`buyer@${cleanDomain}`],
      owner_email: demoOwnerEmail,
      dealstage: "evaluation",
    };

    // Fire the genuine webhook and pace the step reveal alongside it — the
    // animation narrates the real pipeline running server-side, not a stub.
    const request = fetch("/api/integrations/hubspot/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    await delay(650);
    setStep(1);
    await delay(650);
    setStep(2);

    let res: Response;
    try {
      res = await request;
    } catch {
      setStatus("error");
      setError("Could not reach the provisioning pipeline. Is the app running?");
      return;
    }

    const data: WebhookResponse = await res.json().catch(() => ({}));

    if (res.status === 201 && data.workspace_id) {
      setStep(STEPS.length); // mark all steps complete
      await delay(300);
      // Magic link routes through the real /api/track telemetry redirector
      // (Sprint 2) so opening it is logged for the live pulse (Ticket 20). The
      // buyer landing gate it lands on is built in Ticket 19.
      const magicLink = `${window.location.origin}/api/track?wsId=${data.workspace_id}`;
      setResult({ workspaceId: data.workspace_id, magicLink, company: companyName ?? cleanDomain });
      setStatus("done");
    } else {
      setStatus("error");
      setError(data.message ?? `Provisioning failed (HTTP ${res.status}).`);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.magicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (e.g. insecure context) — the field is selectable.
    }
  }

  return (
    <section
      className="rounded-2xl border p-6 shadow-sm sm:p-7"
      style={{ borderColor: "var(--line)", background: "color-mix(in srgb, var(--paper) 92%, var(--seller-tint))" }}
    >
      <label className="flex flex-col gap-2 text-sm font-medium">
        Buyer domain
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="stripe.com"
          value={domain}
          disabled={running}
          onChange={(event) => onDomainChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") simulate();
          }}
          className="rounded-lg border bg-transparent px-3 py-2.5 text-base outline-none focus:ring-2 disabled:opacity-60"
          style={{ borderColor: "var(--line)" }}
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs" style={{ color: "var(--slate)" }}>
          Presets
        </span>
        {presets.map((preset) => {
          const active = domain.trim().toLowerCase() === preset.domain && companyName === preset.name;
          return (
            <button
              key={preset.domain}
              type="button"
              disabled={running}
              onClick={() => applyPreset(preset)}
              aria-pressed={active}
              className="rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:opacity-60"
              style={
                active
                  ? { borderColor: "var(--seller-mark)", background: "var(--seller-tint)", color: "var(--seller-mark)" }
                  : { borderColor: "var(--line)", color: "var(--ink)" }
              }
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* The single Signal action for this view. */}
      <button
        type="button"
        onClick={simulate}
        disabled={running}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border-0 px-4 py-3 text-[0.95rem] font-semibold text-white transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-80 sm:w-auto"
        style={{ background: running ? "var(--signal-press)" : "var(--signal)" }}
      >
        {running ? (
          <>
            <Spinner />
            Simulating…
          </>
        ) : (
          "⚡ Simulate CRM Trigger"
        )}
      </button>

      {(running || status === "done") && (
        <ol className="mt-6 flex flex-col gap-2.5">
          {STEPS.map((label, index) => {
            const state = step > index ? "done" : step === index ? "active" : "pending";
            return (
              <li key={label} className="flex items-center gap-3 text-sm">
                <StepDot state={state} />
                <span
                  style={{
                    color:
                      state === "pending"
                        ? "var(--slate)"
                        : state === "done"
                          ? "var(--pos)"
                          : "var(--signal)",
                    fontWeight: state === "active" ? 600 : 400,
                  }}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {status === "error" && error && (
        <p
          role="alert"
          className="mt-5 rounded-lg px-3 py-2.5 text-sm"
          style={{ background: "color-mix(in srgb, #d9503e 12%, transparent)", color: "#d9503e" }}
        >
          {error}
        </p>
      )}

      {status === "done" && result && (
        <div
          className="mt-6 rounded-xl border p-5"
          style={{ borderColor: "color-mix(in srgb, var(--pos) 40%, var(--line))" }}
        >
          <p className="m-0 inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--pos)" }}>
            <span aria-hidden>✓</span> Workspace provisioned
          </p>
          <p className="m-0 mt-1.5 text-sm" style={{ color: "var(--slate)" }}>
            <strong style={{ color: "var(--ink)" }}>{result.company}</strong> now has a tenant-isolated
            deal room, live in the database.
          </p>

          <label className="mt-4 flex flex-col gap-2 text-sm font-medium">
            Shareable magic link
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                value={result.magicLink}
                onFocus={(event) => event.target.select()}
                className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 font-mono text-xs"
                style={{ borderColor: "var(--line)" }}
              />
              <button
                type="button"
                onClick={copyLink}
                className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
                style={{ borderColor: "var(--seller-mark)", color: "var(--seller-mark)" }}
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
          </label>
          <p className="m-0 mt-3 font-mono text-xs" style={{ color: "var(--slate)" }}>
            workspace_id {result.workspaceId}
          </p>
        </div>
      )}
    </section>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

function StepDot({ state }: { state: "pending" | "active" | "done" }) {
  if (state === "active") {
    return (
      <span
        aria-hidden
        className="inline-block h-4 w-4 animate-spin rounded-full border-2"
        style={{ borderColor: "color-mix(in srgb, var(--signal) 30%, transparent)", borderTopColor: "var(--signal)" }}
      />
    );
  }
  if (state === "done") {
    return (
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: "var(--pos)" }}
      >
        ✓
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 rounded-full border-2"
      style={{ borderColor: "var(--line)" }}
    />
  );
}
