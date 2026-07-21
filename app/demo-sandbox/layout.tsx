import type { ReactNode } from "react";
import "./demo-sandbox.css";

// /demo-sandbox is a public pitch surface — deliberately NOT behind the
// /admin + /settings auth gate in middleware.ts. It only dispatches a mock CRM
// webhook at the real provisioner and reveals a shareable magic link; it holds
// no tenant-scoped data of its own. This layout just loads the demo surface's
// Tailwind + brand tokens.
export default function DemoSandboxLayout({ children }: { children: ReactNode }) {
  return <div data-surface="demo">{children}</div>;
}
