# Claude Code Prompt — Start Building Sprint 1 (Project Ramp)

> Paste everything below the line into Claude Code once the 7 tickets exist in Notion.

---

You are the CTO on **Project Ramp**, a multi-tenant B2B SaaS where Account Executives spin up branded, secure "deal room" portals for buyers. We're in **Phase 1**: perfect the manual **Input layer** (Seller/admin UI) and lightweight **Output layer** (Buyer portal). No CRM automation or webhooks yet.

Start building Sprint 1. Read the tickets and canonical schema in Notion first, then write code.

**Notion references (canonical — do not invent schema or field names):**
- Roadmap / Sprint 1 tickets: `https://app.notion.com/p/3968db98da21800b8499dd307b38032e`
- Technical Source of Truth: `https://app.notion.com/p/3968db98da218006b3aedb832b4376ef`

## Stack (confirm, then proceed)
- **Next.js (App Router)** monorepo, deployed to **Vercel**
- **Supabase** (Postgres + Auth), with **Row-Level Security** enforced via `tenant_id`
- TypeScript, server components where sensible

## Build order (strict — respects dependencies)
1. **Project Setup & Infrastructure** — scaffold Next.js App Router, Vercel deploy, clean `/admin` + `/portal` route separation. Set up Supabase client + env config.
2. **DB migrations** — create `tenants`, `workspaces`, `links` per the Master Schema. Add RLS policies keyed on `tenant_id`. Approved buyer emails must be an **array** column on the workspace.
3. **Auth & AE Login** — Supabase Auth, protected `/admin` middleware. Session maps to `workspaces.created_by` and scopes everything to the AE's `tenant_id`.
4. **Seller Builder UI** — "Create Workspace" dashboard writing `target_company_name` + `target_domain`.
5. **Link Aggregator Form** — dynamic add/remove category form writing to `links` (`category_header`, `link_label`, `url_string`, `display_order`).
6. **Security Gate** — domain whitelisting from `target_domain`, 4-digit magic-link token, `noindex` on all `/portal/*` routes.
7. **Buyer Portal Layout** — distraction-free `/portal/[id]` viewer, curated links open in new tabs, no platform branding.
8. **Instant Branding Engine (P1)** — favicon/logo scrape from `target_domain`, header title `"[Buyer Company] x Seller Success Plan"`.

## Non-negotiable guardrails
- **Tenant isolation is P0.** Every query on `workspaces`/`links` must be RLS-scoped by `tenant_id`. Verify no cross-tenant leakage before marking anything done.
- **Salesforce "Ghost Contact":** if a contact role is blank, fall back to the Account website domain for whitelisting — never throw.
- **No hardcoded pipeline stages** — design the whitelist/settings layer to accept dynamic client stages later.
- **Out of scope:** CRM sync, webhooks, automated provisioning, analytics. Do not build these.

## Workflow
- One branch + PR per ticket, in the order above.
- **Stop after step 2 (scaffold + migrations)** and show me the PR for review before building auth and UI on top of it.
- Each PR: what changed, how you verified tenant isolation, and how to run it locally.
- Update the corresponding Notion ticket's Status to **In progress** when you start it and **Done** when the PR merges.

Begin with step 1. Confirm the stack and repo location, then scaffold.
