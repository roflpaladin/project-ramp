import type { ReactNode } from "react";
import { LEGAL_LAST_UPDATED } from "./legal-last-updated";
import "./legal.css";

export interface LegalPageLayoutProps {
  title: string;
  children: ReactNode;
}

/**
 * T47 (Sprint 9, Ticket 47). Shared shell for /terms, /privacy and
 * /refunds. The founder-approved copy replaced the earlier draft in this
 * pass, which also dropped the "Draft — pending founder review" banner
 * this layout used to render (no longer needed — the copy is real now) and
 * moved "Last updated" from a per-page prop to the single shared
 * LEGAL_LAST_UPDATED constant: it renders nothing at all while that
 * constant is null (no fake date), and every page picks up a real one from
 * this one file the day these pages actually go live.
 */
export function LegalPageLayout({ title, children }: LegalPageLayoutProps) {
  return (
    <main data-surface="legal" data-testid="legal-page">
      <article className="lg-article">
        <h1 className="lg-title">{title}</h1>
        {LEGAL_LAST_UPDATED ? <p className="lg-updated">Last updated: {LEGAL_LAST_UPDATED}</p> : null}
        {children}
      </article>
    </main>
  );
}
