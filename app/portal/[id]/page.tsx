import { cookies } from "next/headers";
import { portalCookieName, verifyPortalSessionValue } from "@/lib/portal-session";
import { requestAccess, verifyAccess } from "./gate-actions";

export default async function PortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ stage?: string; email?: string; error?: string }>;
}) {
  const { id } = await params;
  const { stage, email, error } = await searchParams;

  const cookieStore = await cookies();
  const hasAccess = verifyPortalSessionValue(id, cookieStore.get(portalCookieName(id))?.value);

  if (hasAccess) {
    // Curated links rendering is the Buyer Portal Layout ticket — this proves
    // the gate actually grants/withholds access before that ticket lands.
    return (
      <main>
        <h1>Deal Room</h1>
        <p>Access granted. The links view lands in the next ticket.</p>
      </main>
    );
  }

  const requestAccessForWorkspace = requestAccess.bind(null, id);
  const verifyAccessForWorkspace = verifyAccess.bind(null, id);

  if (stage === "verify") {
    return (
      <main>
        <h1>Enter your code</h1>
        <p>We sent a 4-digit code to {email}.</p>
        <form action={verifyAccessForWorkspace}>
          <input type="hidden" name="email" value={email ?? ""} />
          <label>
            Code
            <input type="text" name="token" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required />
          </label>
          <button type="submit">Verify</button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
      </main>
    );
  }

  return (
    <main>
      <h1>Deal Room Access</h1>
      <form action={requestAccessForWorkspace}>
        <label>
          Your email
          <input type="email" name="email" required />
        </label>
        <button type="submit">Send me a code</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
