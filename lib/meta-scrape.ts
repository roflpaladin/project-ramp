// Minimal, dependency-free OpenGraph/HTML metadata extractor (Sprint 2,
// Ticket 12). Reads a handful of well-known tags via regex rather than
// pulling in a full HTML parser like cheerio -- keeps the same zero-extra-
// infra spirit as the rest of Sprint 2.

export type ScrapedMeta = {
  title: string | null;
  desc: string | null;
  favicon: string | null;
};

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function firstMatch(html: string, pattern: RegExp): string | null {
  const match = pattern.exec(html);
  return match ? decodeEntities(match[1].trim()) : null;
}

function extractMetaContent(html: string, attrName: "property" | "name", attrValue: string): string | null {
  // <meta property="x" content="y"> and the reversed attribute order both
  // appear in the wild.
  const forward = new RegExp(`<meta[^>]*${attrName}=["']${attrValue}["'][^>]*content=["']([^"']*)["'][^>]*>`, "i");
  const backward = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attrName}=["']${attrValue}["'][^>]*>`, "i");
  return firstMatch(html, forward) ?? firstMatch(html, backward);
}

function extractIconHref(html: string): string | null {
  const forward = /<link[^>]*rel=["'](?:shortcut icon|icon)["'][^>]*href=["']([^"']*)["'][^>]*>/i;
  const backward = /<link[^>]*href=["']([^"']*)["'][^>]*rel=["'](?:shortcut icon|icon)["'][^>]*>/i;
  return firstMatch(html, forward) ?? firstMatch(html, backward);
}

export function parseMeta(html: string, pageUrl: URL): ScrapedMeta {
  const titleTagMatch = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = extractMetaContent(html, "property", "og:title") ?? (titleTagMatch ? decodeEntities(titleTagMatch[1].trim()) : null);

  const desc = extractMetaContent(html, "property", "og:description") ?? extractMetaContent(html, "name", "description");

  const rawFavicon = extractMetaContent(html, "property", "og:image") ?? extractIconHref(html) ?? "/favicon.ico";
  let favicon: string | null;
  try {
    favicon = new URL(rawFavicon, pageUrl).toString();
  } catch {
    favicon = null;
  }

  return { title, desc, favicon };
}
