// Produces a real, browser-shaped Supabase auth cookie header for a seller
// (AE) session, for use by HTTP-level tests that need to hit a live Next.js
// server as an authenticated seller (e.g. T28-12's positive Tier 2 control).
//
// Deliberately uses @supabase/ssr's own createServerClient with an in-memory
// cookie jar rather than hand-reconstructing its chunked cookie-storage
// format (project-ref-derived key, base64 encoding, multi-cookie chunking for
// long sessions). Replicating that format by hand would be brittle and would
// silently drift the moment the library's internals change; driving the real
// client through a real sign-in and capturing whatever it writes via setAll
// is what actually proves the cookie is one lib/supabase/server.ts's
// createClient() can read back, because it is the same code path.

import { createServerClient, type CookieOptions } from "@supabase/ssr";

import { requireTestEnv } from "../../fixtures/env";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Signs in as `email`/`password` through a real @supabase/ssr server client
 * backed by an in-memory cookie jar, and returns the resulting cookies
 * serialized as a single `Cookie:` request header value.
 */
export async function buildSellerCookieHeader(email: string, password: string): Promise<string> {
  const env = requireTestEnv();
  const jar = new Map<string, string>();

  const client = createServerClient(env.supabaseUrl, env.anonKey, {
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet: CookieToSet[]) => {
        for (const { name, value } of cookiesToSet) {
          jar.set(name, value);
        }
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`buildSellerCookieHeader — sign-in failed: ${error.message}`);
  }
  if (jar.size === 0) {
    throw new Error(
      "buildSellerCookieHeader — sign-in succeeded but no cookies were written; " +
        "@supabase/ssr's cookie-writing contract may have changed",
    );
  }

  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}
