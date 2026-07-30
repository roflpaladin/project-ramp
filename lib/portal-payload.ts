// THE BUYER BOUNDARY. Sprint 5 · Ticket 25.
//
// PRD 1.4 §3.3 requires the buyer payload to be *structurally incapable* of
// emitting seller-private data. This file is the only thing that makes that
// true. RLS does not: buyers hold no Supabase Auth session, and /portal and
// /view read through the service-role client, which bypasses RLS entirely.
// Anyone reasoning "RLS protects it" about the buyer path has misunderstood the
// architecture.
//
// ── The one rule ───────────────────────────────────────────────────────────
// ALLOWLIST CONSTRUCTION ONLY. Every output field is copied from a NAMED source
// field. Never spread (`...workspace`). Never `delete payload.crm_amount`.
// Never type an output as `Omit<WorkspaceRow, …>`.
//
// A denylist passes today and fails silently the first time someone adds a
// column. An allowlist fails closed: a new private field is simply never
// copied. Every output type below is hand-written for the same reason — derive
// one from a row type and the next migration widens it without a diff anyone
// reads.
//
// If you are adding a field here, you are making it public to the buyer. That
// is the whole ceremony. Keep this file boring.

import "server-only";

import type { OwnerSide, PlanStatus, PlanTree, StageStatus, StepStatus } from "@/lib/plans/types";

// ── Source shapes ──────────────────────────────────────────────────────────
// Hand-written mirrors of the rows this function consumes, private columns and
// all. Naming the private fields here is deliberate: the input is the full row,
// so the strip is visible in one place instead of being quietly pre-applied by
// whichever SELECT the caller happened to write.

export interface WorkspaceRow {
  id: string;
  tenant_id: string;
  target_company_name: string;
  target_domain: string;
  created_by: string;
  approved_emails: string[];
  /** Buyer-visible shared channel (PRD §2.4). */
  chat_url: string | null;
  /** Seller war room. Named in the §3.3 strip list. */
  internal_chat_url: string | null;
  // Cached CRM reflection (PRD §5.1). Every one of these is seller-private.
  crm_source: string | null;
  crm_object_id: string | null;
  crm_stage: string | null;
  crm_amount: number | null;
  crm_close_date: string | null;
  crm_forecast_category: string | null;
  crm_synced_at: string | null;
}

export interface LinkRow {
  id: string;
  workspace_id: string;
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
  visibility: "shared" | "private";
  resource_type: string | null;
}

// ── Output shapes ──────────────────────────────────────────────────────────
// Hand-written, never derived. Nested rather than flat so that a raw
// WorkspaceRow cannot structurally satisfy BuyerPayload — passing one where a
// BuyerPayload is expected is a compile error, which Ticket 25 requires.

export interface BuyerResource {
  id: string;
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
  resource_type: string | null;
}

export interface BuyerStep {
  id: string;
  label: string;
  /**
   * Kept, not stripped. THE DELIBERATE ASYMMETRY: a buyer must still see
   * seller-owned steps. Visibility of what the seller has committed to is the
   * product (PRD §2.5) — a payload that dropped them would be "safe" and
   * useless. Only the step's private metadata comes off.
   */
  owner_side: OwnerSide;
  owner_name: string | null;
  due_date: string | null;
  status: StepStatus;
  display_order: number;
  completed_at: string | null;
  // NOT copied: private_note (seller commentary, §3.3), owner_email and
  // completed_by_email. The emails are not in the audit's forbidden token list,
  // but nothing buyer-facing renders them — the prototype shows names — and in
  // the Ticket 23 fixture owner_email holds an approved_emails address, which is
  // forbidden. An address that is never needed is never copied.
}

export interface BuyerStage {
  id: string;
  title: string;
  display_order: number;
  status: StageStatus;
  steps: BuyerStep[];
}

export interface BuyerPlan {
  id: string;
  title: string;
  start_date: string | null;
  target_date: string | null;
  status: PlanStatus;
  stages: BuyerStage[];
}

export interface BuyerWorkspace {
  id: string;
  target_company_name: string;
  target_domain: string;
  chat_url: string | null;
}

export interface BuyerPayload {
  workspace: BuyerWorkspace;
  /** null is an ordinary state: a workspace exists before anyone builds a plan. */
  plan: BuyerPlan | null;
  resources: BuyerResource[];
}

// ── The boundary ───────────────────────────────────────────────────────────

function toBuyerStep(step: PlanTree["stages"][number]["steps"][number]): BuyerStep {
  return {
    id: step.id,
    label: step.label,
    owner_side: step.owner_side,
    owner_name: step.owner_name,
    due_date: step.due_date,
    status: step.status,
    display_order: step.display_order,
    completed_at: step.completed_at,
  };
}

function toBuyerStage(stage: PlanTree["stages"][number]): BuyerStage {
  return {
    id: stage.id,
    title: stage.title,
    display_order: stage.display_order,
    status: stage.status,
    steps: stage.steps.map(toBuyerStep),
  };
}

function toBuyerPlan(plan: PlanTree): BuyerPlan {
  return {
    id: plan.id,
    title: plan.title,
    start_date: plan.start_date,
    target_date: plan.target_date,
    status: plan.status,
    stages: plan.stages.map(toBuyerStage),
    // NOT copied: workspace_id, created_at. Neither is private, neither is
    // rendered. The allowlist is not a strip list — absence is the default.
  };
}

/**
 * Everything a buyer is allowed to see, and nothing else.
 *
 * Takes the FULL rows — private columns included — and returns a new object
 * assembled field by field. Callers should `select("*")` rather than
 * hand-picking columns upstream: a narrow SELECT is a second, invisible
 * boundary, and it would make Ticket 26's new-column proof vacuous (a column
 * that was never fetched cannot leak, so the test would pass without the
 * allowlist doing any work).
 */
export function toBuyerPayload(
  workspace: WorkspaceRow,
  plan: PlanTree | null,
  links: LinkRow[],
): BuyerPayload {
  return {
    workspace: {
      id: workspace.id,
      target_company_name: workspace.target_company_name,
      target_domain: workspace.target_domain,
      chat_url: workspace.chat_url,
      // NOT copied: tenant_id, created_by, approved_emails, internal_chat_url,
      // and all seven crm_* fields.
    },
    plan: plan ? toBuyerPlan(plan) : null,
    // Defence in depth: callers also filter in SQL (idx_links_workspace_shared
    // makes that free). Filtering again here means a caller who forgets the
    // WHERE clause still cannot leak a private resource — which is the more
    // likely mistake, since the SQL lives in whichever page needs it.
    resources: links
      .filter((link) => link.visibility === "shared")
      .map((link) => ({
        id: link.id,
        category_header: link.category_header,
        link_label: link.link_label,
        url_string: link.url_string,
        display_order: link.display_order,
        resource_type: link.resource_type,
      })),
  };
}
