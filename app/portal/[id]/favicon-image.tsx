"use client";

import { useState } from "react";

// Defense-in-depth on top of lib/branding.ts's fallback guarantee: if the
// favicon service itself is unreachable, swap to a neutral placeholder
// instead of a broken image icon. Needs to be a Client Component because
// Server Components can't attach onError.
export function FaviconImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        aria-hidden
        style={{ width: 32, height: 32, borderRadius: 6, background: "#e5e5e5", flexShrink: 0 }}
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- external, per-workspace domain; next/image would need a wildcard remotePattern
  return <img src={src} alt={alt} width={32} height={32} onError={() => setFailed(true)} />;
}
