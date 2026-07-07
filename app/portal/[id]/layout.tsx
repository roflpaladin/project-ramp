import type { ReactNode } from "react";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div data-surface="portal">{children}</div>;
}
