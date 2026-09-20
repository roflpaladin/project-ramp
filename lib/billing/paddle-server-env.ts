// Sprint 12, Ticket 59 (slice 1 — Paddle fulfillment). The server-only half
// of the Paddle environment: the webhook secret, the (not yet used) API key,
// and the API base URL every future server-to-Paddle call must go through.
//
// Same rule as lib/billing/paddle-env.ts, and for the same founder reason
// ("never silently default the environment, so we never run against the
// wrong Paddle account"): the base URL is DERIVED from the single
// NEXT_PUBLIC_PADDLE_ENV value that module already interprets
// (resolvePaddleEnvironment) rather than read from a second env var that
// could disagree with it, and an unresolved environment yields null — never
// a guess at sandbox or production.
//
// No Paddle API call is built in this slice (explicitly out of scope);
// getPaddleApiBaseUrl/getPaddleApiKey exist so that when one is built it
// cannot invent its own host or key-reading convention.

import "server-only";

import { resolvePaddleEnvironment, type PaddleEnvironment } from "./paddle-env";

const WEBHOOK_SECRET_VAR_NAME = "PADDLE_WEBHOOK_SECRET";
const API_KEY_VAR_NAME = "PADDLE_API_KEY";

const API_BASE_URL_BY_ENVIRONMENT: Readonly<Record<PaddleEnvironment, string>> = Object.freeze({
  sandbox: "https://sandbox-api.paddle.com",
  production: "https://api.paddle.com",
});

function readRequired(env: NodeJS.ProcessEnv, name: string): string | null {
  const raw = env[name];
  if (!raw || raw.trim() === "") return null;
  return raw;
}

/**
 * The notification destination's secret key (Paddle dashboard ->
 * Notifications -> your webhook destination; prefixed `pdl_ntfset_`).
 * Returns null rather than throwing so the route can answer 500 and log
 * once, instead of a module-load crash taking the whole deployment down —
 * but a null here means NOTHING is processed (see the route's fail-closed
 * branch). Never logged, never returned to a caller.
 */
export function getPaddleWebhookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  return readRequired(env, WEBHOOK_SECRET_VAR_NAME);
}

/** Unused in this slice — see the file header. */
export function getPaddleApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return readRequired(env, API_KEY_VAR_NAME);
}

/** null when NEXT_PUBLIC_PADDLE_ENV is unset/invalid — there is no default host. */
export function getPaddleApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const environment = resolvePaddleEnvironment(env);
  if (environment === null) return null;
  return API_BASE_URL_BY_ENVIRONMENT[environment];
}
