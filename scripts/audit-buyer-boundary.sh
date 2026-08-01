#!/usr/bin/env bash
# Sprint 5 · Ticket 26 — the buyer boundary cURL audit.
#
# Pre-deploy check against a LIVE Vercel deployment, covering the Buyer
# Boundary Audit's A1–A5 (see the Notion page "Buyer Boundary Audit" — the
# canonical spec; this script and tests/security/buyer-boundary.spec.ts both
# implement it, at different layers: vitest proves it against dev Supabase +
# a local production server, this proves it against the thing that actually
# shipped).
#
#   A1  no private token in buyer-facing HTML (raw body, not just the DOM)
#   A2  no private resource URL — grep VALUES, not just field names
#   A3  two-sided step-completion ownership: 403 seller-owned / 200 buyer-owned
#       / 403 spoofed owner_side / 404 cross-workspace / 401 no session
#   A4  seller-only APIs return 401 to a buyer cookie AND to anon
#   A5  no enumeration oracle: nonexistent vs. another tenant's real workspace
#       return identical status and body
#
# Exits non-zero on ANY leak or ANY wrong status code. A route that does not
# exist yet is skipped LOUDLY, with the ticket that will add it — never
# silently passed over. Never edit this script to make a route "pass" by
# skipping a check the route is supposed to satisfy; if a route exists and
# fails, that is a finding.
#
# ── Configuration (env vars; sane demo-tenant defaults where possible) ──────
#
#   BASE                 Base URL of the deployment, e.g. https://ramp.vercel.app
#   WS                   A real, buyer-reachable workspace id (private data expected)
#   FOREIGN_WS           A real workspace id under a DIFFERENT tenant (A5 control)
#   NONEXISTENT_WS       A syntactically valid but never-seeded workspace id (A5)
#   COOKIE_VALUE         A pre-signed portal session VALUE for WS (see
#                        lib/portal-session.ts createPortalSessionValue — mint
#                        this out of band; the script cannot know
#                        PORTAL_SESSION_SECRET for a deployed environment)
#   FOREIGN_COOKIE_VALUE A pre-signed portal session VALUE for FOREIGN_WS
#   FORBIDDEN_VALUES     Comma-separated list of literal private values that
#                        must never appear in buyer-facing output (URLs, CRM
#                        amounts, tokens, ...)
#   STEP_ID              A seller-owned plan_steps.id under WS, for A3
#   BUYER_STEP_ID        A buyer-owned plan_steps.id under WS, for A3
#
# All of these have to be supplied by the caller — this script does not seed
# or know about any fixture. That is deliberate: it audits what is actually
# live, not a suite-managed sandbox.

set -uo pipefail

BASE="${BASE:?Set BASE to the deployment URL, e.g. https://ramp.vercel.app}"
WS="${WS:?Set WS to a real buyer-reachable workspace id}"
FOREIGN_WS="${FOREIGN_WS:-}"
NONEXISTENT_WS="${NONEXISTENT_WS:-00000000-0000-4000-8000-000000000000}"
COOKIE_VALUE="${COOKIE_VALUE:-}"
FOREIGN_COOKIE_VALUE="${FOREIGN_COOKIE_VALUE:-}"
FORBIDDEN_VALUES="${FORBIDDEN_VALUES:-}"
STEP_ID="${STEP_ID:-}"
BUYER_STEP_ID="${BUYER_STEP_ID:-}"

COOKIE_NAME="portal_session_${WS}"
FOREIGN_COOKIE_NAME="portal_session_${FOREIGN_WS}"

FAILURES=0
PENDING=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
pending() { printf '  PENDING  %s — Ticket %s\n' "$1" "$2"; PENDING=$((PENDING + 1)); }

# Body + status of a GET, optionally carrying a named cookie.
# Usage: http_get <path> [cookie_name] [cookie_value]
http_get() {
  local path="$1" cookie_name="${2:-}" cookie_value="${3:-}"
  if [ -n "$cookie_name" ] && [ -n "$cookie_value" ]; then
    curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' \
      --cookie "${cookie_name}=${cookie_value}" \
      "${BASE}${path}"
  else
    curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' "${BASE}${path}"
  fi
}

# A route is treated as absent if the response is a plain 404 whose body
# carries Next.js's own not-found boilerplate rather than an app-specific
# response. Best-effort — a live deploy gives no filesystem to check, unlike
# the vitest suite's routeFileExists().
looks_like_missing_route() {
  local status="$1" body_file="$2"
  [ "$status" = "404" ] && grep -qi "this page could not be found" "$body_file" 2>/dev/null
}

# Guards every check that infers SAFETY FROM ABSENCE.
#
# curl writes no body file and reports a status of "000" when it cannot connect.
# A grep against a missing or empty body then finds nothing — which reads
# identically to "no leak" and prints PASS for a request that never happened. A
# pre-deploy audit that passes because it never reached the deployment is worse
# than one nobody ran: it is a green light that was never earned.
#
# Checks asserting an EXACT status (A3, A4) already fail closed — "000" is not
# "401". Only the absence-based greps (A1, A2, and A5's body half) need this.
assert_live_response() {
  local status="$1" body_file="$2" label="$3"
  case "$status" in
    [1-5][0-9][0-9]) ;;
    *)
      fail "${label} — no HTTP response from ${BASE} (curl reported '${status}'); cannot prove the absence of anything"
      return 1
      ;;
  esac
  if [ ! -s "$body_file" ]; then
    fail "${label} — empty response body; cannot prove the absence of anything"
    return 1
  fi
  return 0
}

echo "== A1 — no private token in buyer-facing HTML =="
if [ -z "$FORBIDDEN_VALUES" ]; then
  pending "A1 private-token grep" "26 (set FORBIDDEN_VALUES to run this check)"
else
  IFS=',' read -ra TOKENS <<< "$FORBIDDEN_VALUES"
  for path in "/view/${WS}" "/portal/${WS}"; do
    status=$(http_get "$path" "$COOKIE_NAME" "$COOKIE_VALUE")
    if assert_live_response "$status" /tmp/audit-body.$$ "A1 ${path}"; then
      leaked=0
      for token in "${TOKENS[@]}"; do
        if grep -qF -- "$token" /tmp/audit-body.$$; then
          fail "A1 ${path} — response body contains forbidden value: ${token}"
          leaked=1
        fi
      done
      [ "$leaked" -eq 0 ] && pass "A1 ${path} (status ${status}) — no forbidden value found"
    fi
    rm -f /tmp/audit-body.$$
  done
fi

echo "== A2 — no private resource URL (value-level) =="
# Same mechanism as A1 (value-level grep) — kept as a separate section because
# the audit spec calls it out separately: A1 is "any forbidden token", A2 is
# specifically "a private link's own URL", which is the harder case (a URL is
# not a field name and cannot be caught by a key-rename).
if [ -z "$FORBIDDEN_VALUES" ]; then
  pending "A2 private-resource-URL grep" "26 (set FORBIDDEN_VALUES, include private URLs, to run this check)"
else
  echo "  (covered by A1 above — FORBIDDEN_VALUES should include the private URLs themselves)"
fi

echo "== A3 — two-sided step-completion ownership =="
if [ -z "$STEP_ID" ]; then
  pending "POST /api/steps/[id]/complete" "35"
else
  status=$(curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' -X POST \
    --cookie "${COOKIE_NAME}=${COOKIE_VALUE}" \
    -H 'content-type: application/json' \
    -d '{}' \
    "${BASE}/api/steps/${STEP_ID}/complete")
  if looks_like_missing_route "$status" /tmp/audit-body.$$; then
    pending "POST /api/steps/[id]/complete" "35"
  else
    [ "$status" = "403" ] && pass "A3 buyer completing seller-owned step → 403" \
      || fail "A3 buyer completing seller-owned step → expected 403, got ${status}"
  fi
  rm -f /tmp/audit-body.$$

  if [ -n "$BUYER_STEP_ID" ]; then
    status=$(curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' -X POST \
      --cookie "${COOKIE_NAME}=${COOKIE_VALUE}" \
      -H 'content-type: application/json' \
      -d '{}' \
      "${BASE}/api/steps/${BUYER_STEP_ID}/complete")
    if ! looks_like_missing_route "$status" /tmp/audit-body.$$; then
      [ "$status" = "200" ] && pass "A3 buyer completing buyer-owned step → 200" \
        || fail "A3 buyer completing buyer-owned step → expected 200, got ${status}"
    fi
    rm -f /tmp/audit-body.$$
  fi

  status=$(curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' -X POST \
    --cookie "${COOKIE_NAME}=${COOKIE_VALUE}" \
    -H 'content-type: application/json' \
    -d '{"owner_side":"buyer"}' \
    "${BASE}/api/steps/${STEP_ID}/complete")
  if ! looks_like_missing_route "$status" /tmp/audit-body.$$; then
    [ "$status" = "403" ] && pass "A3 spoofed owner_side in body is ignored → 403" \
      || fail "A3 spoofed owner_side in body → expected 403, got ${status}"
  fi
  rm -f /tmp/audit-body.$$

  if [ -n "$FOREIGN_COOKIE_VALUE" ]; then
    status=$(curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' -X POST \
      --cookie "${FOREIGN_COOKIE_NAME}=${FOREIGN_COOKIE_VALUE}" \
      -H 'content-type: application/json' \
      -d '{}' \
      "${BASE}/api/steps/${STEP_ID}/complete")
    if ! looks_like_missing_route "$status" /tmp/audit-body.$$; then
      [ "$status" = "404" ] && pass "A3 cross-workspace session → 404" \
        || fail "A3 cross-workspace session → expected 404, got ${status}"
    fi
    rm -f /tmp/audit-body.$$
  fi

  status=$(curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' -X POST \
    -H 'content-type: application/json' \
    -d '{}' \
    "${BASE}/api/steps/${STEP_ID}/complete")
  if ! looks_like_missing_route "$status" /tmp/audit-body.$$; then
    [ "$status" = "401" ] && pass "A3 no session → 401" \
      || fail "A3 no session → expected 401, got ${status}"
  fi
  rm -f /tmp/audit-body.$$
fi

echo "== A4 — seller-only APIs reject buyer cookie and anon =="
status=$(curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' \
  --cookie "${COOKIE_NAME}=${COOKIE_VALUE}" \
  "${BASE}/api/plans/${WS}")
if looks_like_missing_route "$status" /tmp/audit-body.$$; then
  pending "GET /api/plans/[ws]" "28"
else
  [ "$status" = "401" ] && pass "A4 GET /api/plans/${WS} with buyer cookie → 401" \
    || fail "A4 GET /api/plans/${WS} with buyer cookie → expected 401, got ${status}"
fi
rm -f /tmp/audit-body.$$

status=$(curl -sS -o /tmp/audit-body.$$ -w '%{http_code}' "${BASE}/api/plans/${WS}")
if ! looks_like_missing_route "$status" /tmp/audit-body.$$; then
  [ "$status" = "401" ] && pass "A4 GET /api/plans/${WS} anon → 401" \
    || fail "A4 GET /api/plans/${WS} anon → expected 401, got ${status}"
fi
rm -f /tmp/audit-body.$$

echo "== A5 — no enumeration oracle =="
if [ -z "$FOREIGN_WS" ]; then
  pending "A5 enumeration-oracle check" "26 (set FOREIGN_WS to run this check)"
else
  for route in "/view" "/portal"; do
    status_nonexistent=$(http_get "${route}/${NONEXISTENT_WS}")
    live_nonexistent=0
    assert_live_response "$status_nonexistent" /tmp/audit-body.$$ "A5 ${route} (nonexistent)" && live_nonexistent=1
    body_nonexistent=$(cat /tmp/audit-body.$$ 2>/dev/null || true)
    rm -f /tmp/audit-body.$$

    status_foreign=$(http_get "${route}/${FOREIGN_WS}")
    live_foreign=0
    assert_live_response "$status_foreign" /tmp/audit-body.$$ "A5 ${route} (foreign)" && live_foreign=1
    body_foreign=$(cat /tmp/audit-body.$$ 2>/dev/null || true)
    rm -f /tmp/audit-body.$$

    # Two unreachable hosts return the same "000" and the same empty body, which
    # would otherwise read as the strongest possible pass.
    if [ "$live_nonexistent" -eq 0 ] || [ "$live_foreign" -eq 0 ]; then
      : # assert_live_response already recorded the failure
    elif [ "$status_nonexistent" != "$status_foreign" ]; then
      fail "A5 ${route} — status differs: nonexistent=${status_nonexistent} foreign=${status_foreign} (this alone lets a buyer distinguish 'never existed' from 'exists, not yours')"
    elif echo "$body_nonexistent" | grep -qF -- "$FOREIGN_WS" || echo "$body_foreign" | grep -qF -- "$NONEXISTENT_WS"; then
      fail "A5 ${route} — response body echoes the counterpart workspace id"
    else
      pass "A5 ${route} — identical status (${status_nonexistent}) for nonexistent vs. foreign-tenant workspace"
    fi
  done
fi

echo
echo "=================================================="
echo "  ${FAILURES} failure(s), ${PENDING} pending check(s)"
echo "=================================================="

if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi
exit 0
