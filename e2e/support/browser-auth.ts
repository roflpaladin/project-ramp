// Adapts the EXISTING seller-session mechanism
// (tests/security/support/seller-http-session.ts's buildSellerCookieHeader)
// for a Playwright BrowserContext rather than a fetch() Cookie header.
//
// buildSellerCookieHeader is reused byte-for-byte and unmodified — it signs
// in through a real @supabase/ssr server client and returns whatever cookies
// that client actually wrote, serialized as a single `Cookie:` header value
// (name=value pairs joined by "; "). This file only reshapes that same
// output into the {name, value} pairs BrowserContext.addCookies() expects;
// no separate sign-in path is introduced.

import type { BrowserContext } from "@playwright/test";
import { buildSellerCookieHeader } from "../../tests/security/support/seller-http-session";

interface NameValue {
  readonly name: string;
  readonly value: string;
}

function parseCookieHeader(header: string): NameValue[] {
  return header
    .split("; ")
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex === -1) {
        throw new Error(`parseCookieHeader: malformed cookie pair "${pair}"`);
      }
      return { name: pair.slice(0, separatorIndex), value: pair.slice(separatorIndex + 1) };
    });
}

/** Signs in as the given seller and installs the resulting session cookies into `context`. */
export async function signInSellerInto(context: BrowserContext, baseUrl: string, email: string, password: string): Promise<void> {
  const header = await buildSellerCookieHeader(email, password);
  const cookies = parseCookieHeader(header);

  await context.addCookies(cookies.map(({ name, value }) => ({ name, value, url: baseUrl })));
}
