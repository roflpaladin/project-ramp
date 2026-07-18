import type { ReactNode } from "react";
import "./settings.css";

// /settings is AE-only. Access control lives in middleware.ts (same
// updateSession gate as /admin — unauthenticated requests redirect to
// /admin/login); this layout just loads Tailwind for the settings surface.
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <div data-surface="settings">{children}</div>;
}
