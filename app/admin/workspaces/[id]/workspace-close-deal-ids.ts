// Plain module (NO "use client") on purpose: page.tsx is a Server Component,
// and non-component exports of a "use client" file reach the server as
// client-reference proxies, not strings.

/** The page title heading's id (page.tsx sets it, with tabIndex -1). */
export const WORKSPACE_TITLE_ID = "workspace-title";
/** Id of Close deal's focusable <summary>; the stall alert's pointer links to `#` + this. */
export const CLOSE_DEAL_ANCHOR_ID = "close-deal";
