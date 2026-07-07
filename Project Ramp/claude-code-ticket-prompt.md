# Claude Code Prompt — Create Sprint 1 Tickets (Project Ramp)

> Paste everything below the line into Claude Code. It has the Notion connector; it should write one ticket per roadmap milestone directly into Notion.

---

You are the CTO on **Project Ramp**, a multi-tenant B2B SaaS that lets Account Executives spin up branded, secure "deal room" portals for buyers. We're in **Phase 1**: perfect the manual **Input layer** (Seller/admin UI) and the lightweight **Output layer** (Buyer portal). No automation yet.

## Your task

Create **one ticket per Sprint 1 milestone (7 total, 1:1 with the roadmap)** in Notion. The milestones already exist as pages in the Roadmap database but their bodies are blank — your job is to fill each page body with a complete, engineering-ready ticket using the template below. Do not create sub-tickets and do not merge milestones; keep it exactly 7.

**Notion locations:**
- Roadmap database (parent): `https://app.notion.com/p/3968db98da21800b8499dd307b38032e`
- Technical Source of Truth (schema, integration map, gotchas): `https://app.notion.com/p/3968db98da218006b3aedb832b4376ef`

Fetch the Technical Source of Truth first and treat it as canonical. Do not invent schema, field names, or data types — reference the ones defined there.

## Ticket template (write into each milestone page body)

```
## User Story
As a <role>, I want <capability> so that <outcome>.

## Description
<2–4 sentences of implementation context>

## Acceptance Criteria
- [ ] <testable, specific criterion>
- [ ] ...

## Technical Notes
- Tables/fields touched (reference the Master Schema)
- RLS / tenant isolation considerations
- Relevant architectural gotchas

## Dependencies
<other Sprint 1 tickets this blocks or is blocked by>

## Definition of Done
- [ ] Deployed to Vercel preview
- [ ] Tenant isolation verified
- [ ] <ticket-specific check>
```

## The 7 Sprint 1 milestones

Set/keep these properties on each page: **Priority**, **Core Layer**, **Status = Not started**, **Sprint Status = Sprint 1**.

1. **Project Setup & Infrastructure** — P0, Infrastructure. Scaffold Next.js monorepo (App Router), deploy to Vercel with clean `/admin` and `/portal` route separation.
2. **Auth & AE Login** — P0, Control Plane. Supabase Auth; protected `/admin` routes via middleware. AE session maps to `workspaces.created_by` (UUID FK) and ties back to `tenant_id` for RLS. Login unlocks a workspace builder scoped to that AE's tenant only.
3. **Seller Builder UI** — P0, Data Plane (Seller). "Create Workspace" dashboard capturing `target_company_name` and `target_domain`. Persists a row to `workspaces` (`created_by` FK→Auth, `tenant_id` FK→`tenants.id`). `target_domain` feeds the Week 2 branding engine.
4. **Link Aggregator Form** — P0, Data Plane (Seller). Dynamic form to add/remove custom header categories with label + URL. Writes to `links`: `workspace_id` FK, `category_header`, `link_label`, `url_string`, `display_order` (INT default 0, AE-controlled sort).
5. **Security Gate** — P0, Security. Email-domain whitelisting reads `workspaces.target_domain`. Approved emails stored as an **array** on `workspace_id` (multi-stakeholder deals). 4-digit magic-link token on domain match. `noindex` meta tag hard-coded on all `/portal/*` routes.
6. **Buyer Portal Layout** — P0, Data Plane (Buyer). Distraction-free `/portal/[id]` viewer rendering curated links (open in new tabs). Minimalist, responsive, **no platform branding**.
7. **Instant Branding Engine** — P1, Data Plane (Buyer). Auto-scrape buyer favicon/logo from `workspaces.target_domain`. Auto-set portal header title to `"[Buyer Company] x Seller Success Plan"`. Applied on portal load, no manual input.

## Architectural gotchas — bake these into acceptance criteria where relevant

- **Salesforce "Ghost Contact":** if `OpportunityContactRole` is blank, gracefully fall back to parsing the Account website domain for whitelisting — never throw.
- **No hardcoded pipeline stages:** pull the client's custom stages into a Settings screen for manual webhook alignment (design for it now even though webhooks are Phase 2).
- **Email arrays:** the schema must natively handle an array of approved buyer emails per `workspace_id`.

## Phase 1 guardrails (out of scope — do NOT ticket)

- No CRM integrations (HubSpot/Salesforce sync is Phase 2).
- No automated portal provisioning / webhooks.
- No analytics beyond what's specified.

When done, reply with a checklist of the 7 tickets created and links to each Notion page.
