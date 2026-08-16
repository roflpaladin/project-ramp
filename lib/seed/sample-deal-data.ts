// Sprint 8, Ticket 42 — sample-deal seed engine: the content builders.
//
// Split from lib/seed/sample-deal.ts for the same reason
// scripts/demo-plan-data.mjs is split from scripts/seed-demo.mjs — content
// vs. procedure. This file has no Supabase client and does no I/O; it is a
// pure function from (tenantId, userId, seller identity, run timestamp) to
// the exact row shapes lib/seed/sample-deal.ts inserts.
//
// The story (founder decision, Sprint 8 Ticket 42): a seller mid-flight
// closing a B2B SaaS deal with a fictional mid-market buyer, positioned
// ~40% through an 8-step plan — some done, one stage "current", future work
// still visible — so a brand-new workspace shows momentum instead of an
// empty shell. Seller-side steps carry the REAL seller's identity (passed in
// by the caller, which fetches it via admin.auth.admin.getUserById); buyer-
// side steps carry a single fictional Meridian persona.
//
// DATES ARE RELATIVE TO `runAt`, not literal — a sample deal seeded once and
// left alone must not visibly age into the past. All offsets are named
// constants so the story stays legible without re-deriving it from raw
// numbers (mirrors scripts/demo-plan-data.mjs's PLAN_START_OFFSET pattern).
//
// Every id is a fresh randomUUID() generated HERE, not left for Postgres to
// assign — that is what lets lib/seed/sample-deal.ts insert steps against a
// known stage_id in one batch call per table instead of depending on
// PostgREST's row-return order matching insert order, and what lets a failed
// insert be compensated by id without a read-back.

import { randomUUID } from "node:crypto";

import type { OwnerSide, PlanStatus, StageStatus, StepStatus } from "@/lib/plans/types";

const DAY_MS = 24 * 60 * 60 * 1000;

// Plan runway: 14 days of history, 30 days of runway ahead — both relative to
// `runAt`, so "day X of Y" never reads as expired.
const PLAN_START_OFFSET_DAYS = -14;
const PLAN_TARGET_OFFSET_DAYS = 30;

// Step dates, in story order. Named per step so the offset and the step it
// belongs to can't drift apart in a future edit.
const STEP_ALIGN_SELLER_DONE_OFFSET_DAYS = -12;
const STEP_ALIGN_BUYER_DONE_OFFSET_DAYS = -10;
const STEP_TECH_SELLER_DONE_OFFSET_DAYS = -4;
const STEP_TECH_BUYER_DUE_OFFSET_DAYS = 2;
const STEP_TECH_SELLER_DUE_OFFSET_DAYS = 5;
const STEP_SECURITY_BUYER_DUE_OFFSET_DAYS = 12;
const STEP_COMMERCIAL_BUYER_DUE_OFFSET_DAYS = 20;
const STEP_GO_LIVE_SELLER_DUE_OFFSET_DAYS = 26;

const MERIDIAN_BUYER_NAME = "Dana Whitfield";
const MERIDIAN_BUYER_EMAIL = "dana@meridian-retail.example.com";

const WORKSPACE_TARGET_COMPANY_NAME = "Sample deal — Meridian Retail Group";
const WORKSPACE_TARGET_DOMAIN = "meridian-retail.example.com";
const PLAN_TITLE = "Rollout success plan — Meridian Retail Group";

/** Postgres `date` — "YYYY-MM-DD", not a timestamp. */
function planDate(runAt: Date, dayOffset: number): string {
  return new Date(runAt.getTime() + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

/** Postgres `timestamptz` — full ISO-8601. */
function planTimestamp(runAt: Date, dayOffset: number): string {
  return new Date(runAt.getTime() + dayOffset * DAY_MS).toISOString();
}

export interface SampleWorkspaceRow {
  id: string;
  tenant_id: string;
  target_company_name: string;
  target_domain: string;
  created_by: string;
  approved_emails: string[];
}

export interface SamplePlanRow {
  id: string;
  workspace_id: string;
  title: string;
  start_date: string;
  target_date: string;
  status: PlanStatus;
}

export interface SampleStageRow {
  id: string;
  plan_id: string;
  title: string;
  display_order: number;
  status: StageStatus;
}

export interface SampleStepRow {
  id: string;
  stage_id: string;
  label: string;
  owner_side: OwnerSide;
  owner_name: string;
  owner_email: string;
  /** "YYYY-MM-DD", or null for a step that is already done. */
  due_date: string | null;
  status: StepStatus;
  display_order: number;
  completed_at: string | null;
  completed_by_email: string | null;
}

export interface SampleLinkRow {
  id: string;
  workspace_id: string;
  category_header: string;
  link_label: string;
  url_string: string;
  display_order: number;
  visibility: "shared";
}

export interface SampleDealData {
  workspace: SampleWorkspaceRow;
  plan: SamplePlanRow;
  stages: SampleStageRow[];
  steps: SampleStepRow[];
  links: SampleLinkRow[];
}

/** The real seller's identity, resolved by the caller before building the deal. */
export interface SampleDealSeller {
  readonly email: string;
  readonly name: string;
}

export interface BuildSampleDealDataInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly seller: SampleDealSeller;
  /** Single timestamp for the whole run — every date derives from this one value. */
  readonly runAt: Date;
}

function buildStages(planId: string, stageIds: Record<StageKey, string>): SampleStageRow[] {
  return [
    { id: stageIds.align, plan_id: planId, title: "Align on goals", display_order: 0, status: "done" },
    { id: stageIds.technical, plan_id: planId, title: "Technical validation", display_order: 1, status: "current" },
    { id: stageIds.security, plan_id: planId, title: "Security review", display_order: 2, status: "upcoming" },
    { id: stageIds.commercial, plan_id: planId, title: "Commercial approval", display_order: 3, status: "upcoming" },
    { id: stageIds.goLive, plan_id: planId, title: "Go-live", display_order: 4, status: "upcoming" },
  ];
}

type StageKey = "align" | "technical" | "security" | "commercial" | "goLive";

function buildSteps(
  stageIds: Record<StageKey, string>,
  seller: SampleDealSeller,
  runAt: Date,
): SampleStepRow[] {
  return [
    {
      id: randomUUID(),
      stage_id: stageIds.align,
      label: "Success criteria agreed with Meridian",
      owner_side: "seller",
      owner_name: seller.name,
      owner_email: seller.email,
      due_date: null,
      status: "done",
      display_order: 0,
      completed_at: planTimestamp(runAt, STEP_ALIGN_SELLER_DONE_OFFSET_DAYS),
      completed_by_email: seller.email,
    },
    {
      id: randomUUID(),
      stage_id: stageIds.align,
      label: "Stakeholder map shared",
      owner_side: "buyer",
      owner_name: MERIDIAN_BUYER_NAME,
      owner_email: MERIDIAN_BUYER_EMAIL,
      due_date: null,
      status: "done",
      display_order: 1,
      completed_at: planTimestamp(runAt, STEP_ALIGN_BUYER_DONE_OFFSET_DAYS),
      completed_by_email: MERIDIAN_BUYER_EMAIL,
    },
    {
      id: randomUUID(),
      stage_id: stageIds.technical,
      label: "Sandbox environment delivered",
      owner_side: "seller",
      owner_name: seller.name,
      owner_email: seller.email,
      due_date: null,
      status: "done",
      display_order: 0,
      completed_at: planTimestamp(runAt, STEP_TECH_SELLER_DONE_OFFSET_DAYS),
      completed_by_email: seller.email,
    },
    {
      id: randomUUID(),
      stage_id: stageIds.technical,
      label: "Data-import dry run on Meridian's sample file",
      owner_side: "buyer",
      owner_name: MERIDIAN_BUYER_NAME,
      owner_email: MERIDIAN_BUYER_EMAIL,
      due_date: planDate(runAt, STEP_TECH_BUYER_DUE_OFFSET_DAYS),
      status: "open",
      display_order: 1,
      completed_at: null,
      completed_by_email: null,
    },
    {
      id: randomUUID(),
      stage_id: stageIds.technical,
      label: "SSO configuration walkthrough",
      owner_side: "seller",
      owner_name: seller.name,
      owner_email: seller.email,
      due_date: planDate(runAt, STEP_TECH_SELLER_DUE_OFFSET_DAYS),
      status: "open",
      display_order: 2,
      completed_at: null,
      completed_by_email: null,
    },
    {
      id: randomUUID(),
      stage_id: stageIds.security,
      label: "Security questionnaire returned",
      owner_side: "buyer",
      owner_name: MERIDIAN_BUYER_NAME,
      owner_email: MERIDIAN_BUYER_EMAIL,
      due_date: planDate(runAt, STEP_SECURITY_BUYER_DUE_OFFSET_DAYS),
      status: "open",
      display_order: 0,
      completed_at: null,
      completed_by_email: null,
    },
    {
      id: randomUUID(),
      stage_id: stageIds.commercial,
      label: "Legal review of order form",
      owner_side: "buyer",
      owner_name: MERIDIAN_BUYER_NAME,
      owner_email: MERIDIAN_BUYER_EMAIL,
      due_date: planDate(runAt, STEP_COMMERCIAL_BUYER_DUE_OFFSET_DAYS),
      status: "open",
      display_order: 0,
      completed_at: null,
      completed_by_email: null,
    },
    {
      id: randomUUID(),
      stage_id: stageIds.goLive,
      label: "Launch plan and training schedule agreed",
      owner_side: "seller",
      owner_name: seller.name,
      owner_email: seller.email,
      due_date: planDate(runAt, STEP_GO_LIVE_SELLER_DUE_OFFSET_DAYS),
      status: "open",
      display_order: 0,
      completed_at: null,
      completed_by_email: null,
    },
  ];
}

function buildLinks(workspaceId: string): SampleLinkRow[] {
  return [
    {
      id: randomUUID(),
      workspace_id: workspaceId,
      category_header: "Getting started",
      link_label: "Implementation guide",
      url_string: "https://resources.example.com/implementation-guide",
      display_order: 0,
      visibility: "shared",
    },
    {
      id: randomUUID(),
      workspace_id: workspaceId,
      category_header: "Trust & security",
      link_label: "Security & compliance overview",
      url_string: "https://resources.example.com/security-compliance-overview",
      display_order: 1,
      visibility: "shared",
    },
    {
      id: randomUUID(),
      workspace_id: workspaceId,
      category_header: "Business case",
      link_label: "ROI worksheet — Meridian",
      url_string: "https://resources.example.com/roi-worksheet-meridian",
      display_order: 2,
      visibility: "shared",
    },
  ];
}

/**
 * Builds one full sample-deal row graph with fresh ids. Pure — no I/O, safe
 * to call repeatedly for the same tenant to produce distinct workspaces
 * (Ticket 42 has no idempotency requirement, unlike scripts/seed-demo.mjs's
 * singleton demo tenant).
 */
export function buildSampleDealData(input: BuildSampleDealDataInput): SampleDealData {
  const { tenantId, userId, seller, runAt } = input;

  const workspace: SampleWorkspaceRow = {
    id: randomUUID(),
    tenant_id: tenantId,
    target_company_name: WORKSPACE_TARGET_COMPANY_NAME,
    target_domain: WORKSPACE_TARGET_DOMAIN,
    created_by: userId,
    // The seller invites their own inbox in the onboarding flow (Ticket 43) —
    // no buyer email exists yet to pre-approve.
    approved_emails: [],
  };

  const plan: SamplePlanRow = {
    id: randomUUID(),
    workspace_id: workspace.id,
    title: PLAN_TITLE,
    start_date: planDate(runAt, PLAN_START_OFFSET_DAYS),
    target_date: planDate(runAt, PLAN_TARGET_OFFSET_DAYS),
    status: "active",
  };

  const stageIds: Record<StageKey, string> = {
    align: randomUUID(),
    technical: randomUUID(),
    security: randomUUID(),
    commercial: randomUUID(),
    goLive: randomUUID(),
  };

  return {
    workspace,
    plan,
    stages: buildStages(plan.id, stageIds),
    steps: buildSteps(stageIds, seller, runAt),
    links: buildLinks(workspace.id),
  };
}
