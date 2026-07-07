import type { Metadata } from "next";
import type { ReactNode } from "react";

// Hard-coded on every /portal/* route (this layout wraps all of them) —
// deal rooms must never be indexed, and this must not depend on any
// runtime condition to take effect.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function PortalRootLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
