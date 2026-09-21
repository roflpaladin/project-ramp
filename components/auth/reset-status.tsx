// Sprint 12, Ticket 65 — "Password Reset Flow". The one status line both
// reset pages render. Status is never colour-only (design guidelines §3.5):
// always a dot plus a text label. `risk` announces as an alert, `done` as a
// polite status.
import type { ReactNode } from "react";

import "./password-reset.css";

interface ResetStatusProps {
  tone: "done" | "risk";
  children: ReactNode;
}

export function ResetStatus({ tone, children }: ResetStatusProps) {
  return (
    <p className="pr-status" data-tone={tone} role={tone === "risk" ? "alert" : "status"}>
      <span className="pr-status-dot" data-status-dot="" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
