// Sprint 12, Ticket 67 (slice 1, founder scope amendment — Paddle overlay
// checkout). Resolves + validates the client-side Paddle.js environment and
// token pair app/pricing/pricing-tiers.tsx initializes Paddle with. Same
// env-injectable, never-throws shape as lib/plans/stall-threshold.ts, with
// one deliberate difference: there is NO numeric-style default here. The
// founder's explicit instruction is "never silently default the
// environment, so we never run against the wrong Paddle account" — an
// unset NEXT_PUBLIC_PADDLE_ENV must never quietly resolve to 'sandbox'.
// Every failure path below is logged loudly (console.error) precisely so a
// missing or mismatched pair is visible in server logs, then still resolves
// to null rather than throwing — a page render must not 500 over this, the
// same reasoning stall-threshold documents. Callers gate on the null return
// (see lib/billing/plans.ts's isPublishable).

export type PaddleEnvironment = "sandbox" | "production";

export interface PaddleClientConfig {
  readonly environment: PaddleEnvironment;
  readonly clientToken: string;
}

const ENV_VAR_NAME = "NEXT_PUBLIC_PADDLE_ENV";
const TOKEN_VAR_NAME = "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN";

const LIVE_TOKEN_PREFIX = "live_";
const TEST_TOKEN_PREFIX = "test_";

function isPaddleEnvironment(value: string | undefined): value is PaddleEnvironment {
  return value === "sandbox" || value === "production";
}

export function getPaddleClientConfig(env: NodeJS.ProcessEnv = process.env): PaddleClientConfig | null {
  const rawEnvironment = env[ENV_VAR_NAME];
  const clientToken = env[TOKEN_VAR_NAME];

  if (!isPaddleEnvironment(rawEnvironment)) {
    console.error(
      `[paddle-env] ${ENV_VAR_NAME} is unset or not "sandbox"/"production" (got "${rawEnvironment ?? ""}") — ` +
        "refusing to default to a Paddle environment; pricing stays unpublishable",
    );
    return null;
  }

  if (!clientToken || clientToken.trim() === "") {
    console.error(`[paddle-env] ${TOKEN_VAR_NAME} is unset — pricing stays unpublishable`);
    return null;
  }

  const isLiveToken = clientToken.startsWith(LIVE_TOKEN_PREFIX);
  const isTestToken = clientToken.startsWith(TEST_TOKEN_PREFIX);

  if (rawEnvironment === "sandbox" && isLiveToken) {
    console.error(
      `[paddle-env] refusing to run a "${LIVE_TOKEN_PREFIX}" client token against the sandbox environment — ` +
        `check ${ENV_VAR_NAME}/${TOKEN_VAR_NAME}`,
    );
    return null;
  }
  if (rawEnvironment === "production" && isTestToken) {
    console.error(
      `[paddle-env] refusing to run a "${TEST_TOKEN_PREFIX}" client token against the production environment — ` +
        `check ${ENV_VAR_NAME}/${TOKEN_VAR_NAME}`,
    );
    return null;
  }

  return Object.freeze({ environment: rawEnvironment, clientToken });
}
