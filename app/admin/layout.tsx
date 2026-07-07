import type { ReactNode } from "react";

// Access control lives in middleware.ts (redirects unauthenticated requests
// to /admin/login), not here — this layout is just the shared surface shell.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div data-surface="admin">{children}</div>;
}
