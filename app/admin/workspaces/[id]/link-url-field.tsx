"use client";

import { useRef, useState } from "react";

type ScrapedMeta = { title: string | null; desc: string | null; favicon: string | null };

// Paste-a-URL autofill for the seller link builder (Sprint 2, Ticket 12).
// `links` has no description/favicon columns, so only `title` is written
// into the form (link_label); desc/favicon are shown as a live preview to
// help the seller confirm they've got the right resource, not persisted.
export function LinkUrlField() {
  const [preview, setPreview] = useState<ScrapedMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const labelInputRef = useRef<HTMLInputElement>(null);

  async function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
    const url = event.target.value.trim();
    if (!url) {
      setPreview(null);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/scrape-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok) {
        setPreview(null);
        return;
      }

      const data: ScrapedMeta = await response.json();
      setPreview(data);

      // Only autofill the label if the seller hasn't already typed one.
      if (data.title && labelInputRef.current && !labelInputRef.current.value.trim()) {
        labelInputRef.current.value = data.title;
      }
    } catch {
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <label>
        Label
        <input ref={labelInputRef} type="text" name="link_label" placeholder="MNDA Draft" required />
      </label>
      <label>
        URL
        <input type="url" name="url_string" placeholder="https://…" required onBlur={handleBlur} />
      </label>
      {loading ? <p>Fetching preview…</p> : null}
      {preview ? (
        <p style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {preview.favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.favicon}
              alt=""
              width={16}
              height={16}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : null}
          <span>
            {preview.title ?? "No title found"}
            {preview.desc ? ` — ${preview.desc}` : ""}
          </span>
        </p>
      ) : null}
    </>
  );
}
