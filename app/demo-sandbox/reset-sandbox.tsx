"use client";

import { useState } from "react";

// "Reset Demo Sandbox Engine" (Ticket 21). Purges the demo tenant's per-pitch
// data via /api/demo/reset (demo-scoped, real tenants untouched), then reloads
// so the sandbox + pulse start from a clean slate. Idempotent and safe to spam.
export function ResetSandbox() {
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setStatus("running");
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStatus("error");
        setError(data.message ?? `Reset failed (HTTP ${res.status}).`);
        return;
      }
      // Fresh page = guaranteed-clean simulator + pulse state.
      window.location.reload();
    } catch {
      setStatus("error");
      setError("Could not reach the reset endpoint.");
    }
  }

  return (
    <div className="mt-6 flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={reset}
        disabled={status === "running"}
        // Secondary/destructive styling — NOT Signal (reserved for the trigger).
        className="rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
        style={{ borderColor: "var(--line)", color: "var(--slate)" }}
      >
        {status === "running" ? "Resetting…" : "↺ Reset Demo Sandbox Engine"}
      </button>
      <p className="m-0 text-xs" style={{ color: "var(--slate)" }}>
        Purges only the demo tenant&apos;s workspaces, links &amp; analytics — real tenants are untouched.
      </p>
      {status === "error" && error ? (
        <p role="alert" className="m-0 text-xs" style={{ color: "#d9503e" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
