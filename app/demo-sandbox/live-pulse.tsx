"use client";

import { useEffect, useRef, useState } from "react";

type FeedItem = {
  action_type: "portal_view" | "link_click";
  buyer_email: string;
  metadata: { link_label: string | null };
  timestamp: string;
};
type Pulse = {
  domain: string;
  metrics: { total_views: number; total_clicks: number };
  activity_feed: FeedItem[];
};

const POLL_MS = 3000;

function keyOf(item: FeedItem) {
  return `${item.timestamp}|${item.action_type}|${item.metadata.link_label ?? ""}`;
}

function flashText(item: FeedItem, domain: string) {
  return item.action_type === "portal_view"
    ? `👀 Buyer from ${domain} accessed the portal`
    : `🖱️ Clicked: ${item.metadata.link_label ?? "a resource"}`;
}

function relativeTime(iso: string) {
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// Live Pulse ticker (Ticket 20). Polls the demo-scoped /api/demo/pulse for the
// one active workspace and flashes a visible alert when a fresh portal_view /
// link_click arrives — the "Aha! moment" for the audience.
export function LivePulse({ workspaceId }: { workspaceId: string }) {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    let active = true;
    // Fresh workspace → reset detection state.
    seen.current = new Set();
    primed.current = false;
    setPulse(null);
    setFlash(null);

    async function poll() {
      try {
        const res = await fetch(`/api/demo/pulse?workspace_id=${workspaceId}`, { cache: "no-store" });
        if (!res.ok || !active) return;
        const data: Pulse = await res.json();
        if (!active) return;
        setPulse(data);

        // First poll primes the seen-set silently so we never flash events that
        // were already there; subsequent new events flash. newest-first, so the
        // first unseen item is the freshest.
        if (!primed.current) {
          for (const item of data.activity_feed) seen.current.add(keyOf(item));
          primed.current = true;
          return;
        }
        for (const item of data.activity_feed) {
          const k = keyOf(item);
          if (!seen.current.has(k)) {
            seen.current.add(k);
            setFlash(flashText(item, data.domain));
            break; // flash only the freshest new event this tick
          }
        }
      } catch {
        // Transient network/poll error — the next tick retries.
      }
    }

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <div className="mt-6 rounded-xl border p-5" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between">
        <p className="m-0 inline-flex items-center gap-2 text-sm font-semibold">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 animate-pulse rounded-full"
            style={{ background: "var(--signal)" }}
          />
          Live Pulse
        </p>
        <div className="flex items-center gap-4 text-xs" style={{ color: "var(--slate)" }}>
          <span>
            <strong style={{ color: "var(--ink)" }}>{pulse?.metrics.total_views ?? 0}</strong> views
          </span>
          <span>
            <strong style={{ color: "var(--ink)" }}>{pulse?.metrics.total_clicks ?? 0}</strong> clicks
          </span>
        </div>
      </div>

      {flash ? (
        <p
          role="status"
          className="m-0 mt-4 rounded-lg px-3 py-2.5 text-sm font-medium"
          style={{ background: "color-mix(in srgb, var(--signal) 14%, transparent)", color: "var(--signal)" }}
        >
          {flash}
        </p>
      ) : null}

      <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
        {pulse && pulse.activity_feed.length > 0 ? (
          pulse.activity_feed.map((item, index) => (
            <li key={`${item.timestamp}-${index}`} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span aria-hidden>{item.action_type === "portal_view" ? "👀" : "🖱️"}</span>
                <span>
                  {item.action_type === "portal_view"
                    ? "Portal accessed"
                    : `Clicked: ${item.metadata.link_label ?? "a resource"}`}
                </span>
                <span style={{ color: "var(--slate)" }}>· {item.buyer_email}</span>
              </span>
              <span className="shrink-0 text-xs" style={{ color: "var(--slate)" }}>
                {relativeTime(item.timestamp)}
              </span>
            </li>
          ))
        ) : (
          <li className="text-sm" style={{ color: "var(--slate)" }}>
            Waiting for buyer activity… open the magic link to see it flash here.
          </li>
        )}
      </ul>
    </div>
  );
}
