import type { ReactNode } from "react";
import "./legal.css";

export interface LegalPageLayoutProps {
  title: string;
  /** e.g. "Effective date: TBD" — each page supplies its own. */
  updatedLabel: string;
  children: ReactNode;
}

/**
 * T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Shared shell for
 * /terms, /privacy and /refunds — one place to own the "Draft — pending
 * founder review" banner (unmissable, top of every legal page, ahead of the
 * title) rather than duplicating it three times. See legal.css's header
 * comment for the reasoning behind reusing the risk state colour here (a
 * flagged judgement call — the live guideline has no dedicated
 * notice/warning component).
 */
export function LegalPageLayout({ title, updatedLabel, children }: LegalPageLayoutProps) {
  return (
    <main data-surface="legal" data-testid="legal-page">
      <div className="lg-banner" data-testid="legal-draft-banner" role="status">
        <span className="lg-banner-dot" aria-hidden="true" />
        <span>Draft — pending founder review. This copy is not yet approved and may change before launch.</span>
      </div>

      <article className="lg-article">
        <h1 className="lg-title">{title}</h1>
        <p className="lg-updated">{updatedLabel}</p>
        {children}
      </article>
    </main>
  );
}
