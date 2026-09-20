import type { ReactNode } from "react";
import Link from "next/link";
import "./settings.css";

// /settings is AE-only. Access control lives in middleware.ts (same
// updateSession gate as /admin — unauthenticated requests redirect to
// /admin/login); this layout just loads Tailwind for the settings surface.
//
// T59 slice 2: the settings area had no list of its own sections at all —
// app/settings/integrations was only reachable by direct URL. This adds the
// minimal one (Integrations, Billing), shared by every page under /settings
// rather than duplicated per page. Token-based (var(--slate)/var(--ink)/
// var(--line)), not the older integrations page's Tailwind neutral-* scale,
// since this is new code sitting alongside — not replacing — that page.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div data-surface="settings">
      <nav className="st-nav" aria-label="Settings">
        <Link href="/settings/integrations">Integrations</Link>
        <Link href="/settings/billing">Billing</Link>
      </nav>
      {children}
    </div>
  );
}
