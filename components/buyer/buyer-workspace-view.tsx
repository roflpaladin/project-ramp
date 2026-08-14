// THE BUYER WORKSPACE RENDERER. Sprint 7 · Ticket 33
// (plans/sprint-6-7-replan.md §7, decision 6).
//
// ── The module boundary ────────────────────────────────────────────────────
// This file exports EXACTLY ONE thing: BuyerWorkspaceView. Every other
// function below is a private, unexported subcomponent that only this file
// can ever call.
//
// Ticket 25's lib/portal-payload.ts proved the ROOT type is safe: a raw
// WorkspaceRow/PlanTree cannot be passed where a BuyerPayload is expected —
// that's a compile error. It also documents why that guarantee does NOT
// extend to the payload's sub-shapes: BuyerWorkspace / BuyerPlan / BuyerStage
// / BuyerStep are each structurally assignable FROM their raw counterparts
// (extra private fields on a raw row don't break a structural assignment),
// so a component prop literally typed `{ stage: BuyerStage }` would let
// `<StageBlock stage={rawPlanStageRow} />` compile today.
//
// Two things close that gap here, together:
//   1. Every subcomponent below is unexported — nothing outside this file
//      can ever write that call in the first place.
//   2. This file never imports a raw row type (WorkspaceRow, PlanTree,
//      PlanStage, PlanStepRow) at all, so there is no raw value anywhere in
//      this file's scope to pass by mistake either.
// The local type aliases below (Workspace/Plan/Stage/Step, indexed off
// BuyerPayload rather than the named Buyer* interfaces) are the literal
// spelling the ticket asks for on top of that — mechanically greppable for a
// future lint rule, even though the real guarantee is (1) and (2), not the
// spelling. See lib/portal-payload.ts's own header for the full boundary
// rationale.

import { getFaviconUrl } from "@/lib/branding";
import type { BuyerPayload } from "@/lib/portal-payload";
import { groupByCategory } from "@/lib/links";
import { FaviconImage } from "@/app/portal/[id]/favicon-image";
import {
  buildCommitteeInviteHref,
  collectBlockedSteps,
  collectOverdueBuyerSteps,
  computeRunway,
  findNextOpenStep,
  formatPlanDate,
  ownerSideLabel,
  stageStatusLabel,
  stageTone,
  stepStatusLabel,
  stepTone,
  type StatusTone,
} from "./plan-selectors";
import "./buyer-workspace-view.css";

type Workspace = BuyerPayload["workspace"];
type Plan = NonNullable<BuyerPayload["plan"]>;
type Stage = Plan["stages"][number];
type Step = Stage["steps"][number];
type Resource = BuyerPayload["resources"][number];
interface StepLocation {
  readonly stage: Stage;
  readonly step: Step;
}

const TONE_COLOR: Record<StatusTone, string> = {
  done: "var(--state-done)",
  risk: "var(--state-risk)",
  wait: "var(--state-wait)",
};

/** The single public entry point (T33-1). */
export function BuyerWorkspaceView({ payload }: { payload: BuyerPayload }) {
  const { workspace, plan, resources } = payload;

  return (
    <div data-surface="buyer-workspace" data-testid="buyer-workspace">
      <IdentityHeader workspace={workspace} />
      <div className="bw-layout">
        {plan ? <PlanSpine plan={plan} /> : <EmptyPlanState chatUrl={workspace.chat_url} />}
        <Rail workspace={workspace} plan={plan} resources={resources} />
      </div>
    </div>
  );
}

// ── Identity strip — whitelabel confinement (T33-7) ────────────────────────
// The buyer's own scraped accent (distinct from the fixed --seller-marker /
// --buyer-marker "side" tokens used everywhere below for ownership) is
// permitted in exactly one place in this component: the identity-rule
// underline. BuyerPayload carries no accent/logo field yet — no scrape
// pipeline is wired to it — so --buyer-accent always falls back to --ink
// today; the CSS variable seam exists so a future payload field is a
// one-line change here, not a redesign. Logo is capped to the 24px
// guideline maximum in CSS regardless of the favicon service's native size.
function IdentityHeader({ workspace }: { workspace: Workspace }) {
  return (
    <header className="bw-identity">
      <span className="bw-identity-logo" data-testid="buyer-identity-logo">
        <FaviconImage src={getFaviconUrl(workspace.target_domain)} alt="" />
      </span>
      <div>
        <p className="bw-identity-name">{workspace.target_company_name}</p>
        <span className="bw-identity-rule" data-testid="buyer-identity-rule" aria-hidden="true" />
      </div>
    </header>
  );
}

// ── Spine (T33-3): runway banner → the one Signal card → the staged plan ──

function PlanSpine({ plan }: { plan: Plan }) {
  return (
    <div className="bw-spine" data-testid="buyer-spine">
      <RunwayBanner plan={plan} />
      <SignalCard plan={plan} />
      <StagedPlan plan={plan} />
    </div>
  );
}

/** T33-5: a plan with no start/target date renders without a broken banner —
 *  no day count, no position marker, just a plain informational line. */
function RunwayBanner({ plan }: { plan: Plan }) {
  const runway = computeRunway(plan, new Date());

  if (!runway) {
    return (
      <section className="bw-runway" data-testid="buyer-runway-banner" data-has-dates="false">
        <p className="bw-runway-empty">Dates for this plan haven&apos;t been set yet.</p>
      </section>
    );
  }

  return (
    <section className="bw-runway" data-testid="buyer-runway-banner" data-has-dates="true">
      <div className="bw-runway-heading">
        <span className="bw-runway-day bw-mono">
          Day {runway.dayIndex} of {runway.totalDays}
        </span>
        <span className="bw-runway-dates bw-mono">
          {formatPlanDate(runway.startDate)} – {formatPlanDate(runway.targetDate)}
        </span>
      </div>
      <div className="bw-runway-track">
        <span
          className="bw-runway-marker"
          data-testid="buyer-runway-marker"
          aria-hidden="true"
          style={{ left: `${runway.percent}%` }}
        />
      </div>
    </section>
  );
}

/** The plan's one decision-scope Signal (design system MUST: exactly one per
 *  scope). Heading adapts to whose move it actually is — "Nothing pending on
 *  your side, their move" is a named voice example in the live guideline, so
 *  a hardcoded "Your move" string when it is really the seller's turn would
 *  violate "never make them guess" more than it would satisfy this ticket's
 *  literal label. Renders quietly (no amber) once nothing is open. */
function SignalCard({ plan }: { plan: Plan }) {
  const next = findNextOpenStep(plan);

  if (!next) {
    return (
      <section className="bw-signal-card bw-signal-card--quiet" data-testid="buyer-signal-card" data-signal="false">
        <p className="bw-signal-eyebrow">Next move</p>
        <h2 className="bw-signal-heading">{quietMoveMessage(plan)}</h2>
      </section>
    );
  }

  const { step } = next;
  const heading = step.owner_side === "buyer" ? "Your move" : "Their move";

  return (
    <section className="bw-signal-card" data-testid="buyer-signal-card" data-signal="true">
      <p className="bw-signal-eyebrow">Next move</p>
      <h2 className="bw-signal-heading">{heading}</h2>
      <p className="bw-signal-step-label">{step.label}</p>
      <p className="bw-signal-meta">
        <span>
          {ownerSideLabel(step)}
          {step.owner_name ? ` · ${step.owner_name}` : ""}
        </span>
        <span className="bw-mono">{step.due_date ? `Due ${formatPlanDate(step.due_date)}` : "No due date"}</span>
      </p>
    </section>
  );
}

function quietMoveMessage(plan: Plan): string {
  if (plan.stages.length === 0) return "Nothing to act on yet.";
  if (collectBlockedSteps(plan).length > 0) return "Nothing open right now — see what's holding things up in the sidebar.";
  return "You're all caught up here.";
}

/** T33-5: an empty stage list renders a named zero state, never a blank
 *  section. */
function StagedPlan({ plan }: { plan: Plan }) {
  if (plan.stages.length === 0) {
    return (
      <div className="bw-staged-plan" data-testid="buyer-staged-plan">
        <p className="bw-stage-empty" data-testid="buyer-staged-plan-empty">
          No stages have been added to this plan yet.
        </p>
      </div>
    );
  }

  return (
    <div className="bw-staged-plan" data-testid="buyer-staged-plan">
      {plan.stages.map((stage) => (
        <StageBlock key={stage.id} stage={stage} />
      ))}
    </div>
  );
}

/** T33-3: the current stage carries the ramp gesture as its section marker.
 *  T33-6: every step inside keeps its own dot + text ownership marker, and a
 *  seller-owned step is rendered exactly like a buyer-owned one — nothing
 *  here hides it. */
function StageBlock({ stage }: { stage: Stage }) {
  const isCurrent = stage.status === "current";

  return (
    <section className="bw-stage" data-testid="buyer-stage" data-status={stage.status} data-current={isCurrent}>
      <div className="bw-stage-header">
        {isCurrent ? <span className="bw-ramp-gesture" data-testid="buyer-ramp-gesture" aria-hidden="true" /> : null}
        <h3 className="bw-stage-title">{stage.title}</h3>
        <StatusDot tone={stageTone(stage.status)} label={stageStatusLabel(stage.status)} />
      </div>

      {stage.steps.length === 0 ? (
        <p className="bw-stage-empty">No steps in this stage yet.</p>
      ) : (
        <div className="bw-stage-steps">
          {stage.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </section>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <article className="bw-step" data-testid={`buyer-step-${step.id}`} data-owner={step.owner_side} data-status={step.status}>
      <span className="bw-step-rail" aria-hidden="true" />
      <h4 className="bw-step-title">{step.label}</h4>
      <div className="bw-step-row">
        <StatusDot tone={stepTone(step.status)} label={stepStatusLabel(step.status)} />
        <span className="bw-owner-chip" data-side={step.owner_side}>
          {ownerSideLabel(step)}
        </span>
      </div>
      <p className="bw-step-meta">
        {step.owner_name ? <span>{step.owner_name}</span> : null}
        <span className="bw-mono">{step.due_date ? `Due ${formatPlanDate(step.due_date)}` : "No due date"}</span>
      </p>
    </article>
  );
}

/** Status is never colour-only (design system MUST) — always a dot next to
 *  the text label. */
function StatusDot({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="bw-status-badge" data-tone={tone}>
      <span className="bw-status-dot" data-status-dot="" aria-hidden="true" style={{ backgroundColor: TONE_COLOR[tone] }} />
      <span>{label}</span>
    </span>
  );
}

/** T33-5: zero state for a workspace with no plan at all — one sentence
 *  naming what goes here, plus the one action available to a buyer without a
 *  Supabase session: reaching the seller through the shared channel, when
 *  one exists (hidden, not a dead link, when it doesn't — same idiom as the
 *  rail's contact section below). */
function EmptyPlanState({ chatUrl }: { chatUrl: string | null }) {
  return (
    <div className="bw-empty-plan" data-testid="buyer-empty-plan">
      <p>Your success plan hasn&apos;t been built yet.</p>
      {chatUrl ? (
        <a className="bw-rail-link" href={chatUrl} target="_blank" rel="noopener noreferrer">
          Message the seller →
        </a>
      ) : null}
    </div>
  );
}

// ── Rail (T33-4): quiet and Slate throughout ───────────────────────────────

function Rail({
  workspace,
  plan,
  resources,
}: {
  workspace: Workspace;
  plan: Plan | null;
  resources: readonly Resource[];
}) {
  const blocked = plan ? collectBlockedSteps(plan) : [];
  const overdue = plan ? collectOverdueBuyerSteps(plan, new Date()) : [];

  return (
    <aside className="bw-rail" data-testid="buyer-rail" aria-label="Plan status">
      <BlockersSection blocked={blocked} />
      {overdue.length > 0 ? <OverdueSection overdue={overdue} /> : null}
      {resources.length > 0 ? <ResourcesSection resources={resources} workspaceId={workspace.id} /> : null}
      <CommitteeSection targetCompanyName={workspace.target_company_name} />
      {workspace.chat_url ? <ContactSellerSection chatUrl={workspace.chat_url} /> : null}
    </aside>
  );
}

/** Always answers "what's holding up the decision" — even the empty case
 *  states it plainly rather than omitting the section (Notion §10 voice: bad
 *  news stated plainly; good news gets the same treatment). */
function BlockersSection({ blocked }: { blocked: readonly StepLocation[] }) {
  return (
    <section className="bw-rail-section" data-testid="buyer-rail-blockers" aria-label="What's holding things up">
      <h3 className="bw-rail-heading">What&apos;s holding things up</h3>
      {blocked.length === 0 ? (
        <p className="bw-rail-empty">Nothing blocking right now.</p>
      ) : (
        <ul className="bw-rail-list">
          {blocked.map(({ step }) => (
            <li key={step.id} className="bw-rail-item">
              <StatusDot tone="risk" label={stepStatusLabel(step.status)} />
              <span>{step.label}</span>
              <span className="bw-rail-item-owner">
                {ownerSideLabel(step)}
                {step.owner_name ? ` · ${step.owner_name}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** PRD §5 / T33-4: buyer-owned overdue steps stay in the rail for now.
 *  Unlike blockers, this section hides itself entirely when nothing
 *  qualifies — an alert list with nothing to alert on is noise, whereas
 *  "nothing blocking" is itself useful reassurance. */
function OverdueSection({ overdue }: { overdue: readonly StepLocation[] }) {
  return (
    <section className="bw-rail-section" data-testid="buyer-rail-overdue" aria-label="Overdue on your side">
      <h3 className="bw-rail-heading">Overdue on your side</h3>
      <ul className="bw-rail-list">
        {overdue.map(({ step }) => (
          <li key={step.id} className="bw-rail-item">
            <StatusDot tone="risk" label="Overdue" />
            <span>{step.label}</span>
            {step.due_date ? <span className="bw-rail-item-owner">Was due {formatPlanDate(step.due_date)}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** T34-2 (Sprint 7, Ticket 34; plans/sprint-6-7-replan.md §7). Ticket 33
 *  shipped this component without any resources rendering — a gap invisible
 *  until this ticket mounted it as the SOLE rendering for both buyer
 *  surfaces, at which point shared resources would have silently stopped
 *  reaching buyer HTML at all (tests/security/buyer-boundary.spec.ts and
 *  tests/security/link-visibility-toggle.spec.ts both already prove real
 *  resource labels reach /portal/[id]'s rendered HTML — closing this gap is
 *  what keeps that proof, not a new claim). Hidden entirely when the buyer
 *  has nothing shared with them yet, matching every other rail section's
 *  zero-state idiom. Every link routes through /api/track (never a raw
 *  url_string in the DOM) so clicks are logged for the seller's pulse. */
function ResourcesSection({ resources, workspaceId }: { resources: readonly Resource[]; workspaceId: string }) {
  const grouped = groupByCategory([...resources]);

  return (
    <section className="bw-rail-section" data-testid="buyer-rail-resources" aria-label="Shared resources">
      <h3 className="bw-rail-heading">Shared resources</h3>
      {[...grouped.entries()].map(([category, categoryResources]) => (
        <div key={category}>
          <p className="bw-resource-category">{category}</p>
          <ul className="bw-resource-list">
            {categoryResources.map((resource) => (
              <li key={resource.id}>
                <a
                  className="bw-resource-link"
                  href={`/api/track?linkId=${resource.id}&wsId=${workspaceId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span>{resource.link_label}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** BuyerPayload models no committee-membership data yet, so this is a real,
 *  working invite affordance (a mailto: link needing no backend) rather than
 *  a dead control standing in for a feature that doesn't exist. */
function CommitteeSection({ targetCompanyName }: { targetCompanyName: string }) {
  return (
    <section className="bw-rail-section" data-testid="buyer-rail-committee" aria-label="Buying committee">
      <h3 className="bw-rail-heading">Buying committee</h3>
      <p className="bw-rail-empty">Bring in anyone else who needs to see this plan.</p>
      <a className="bw-rail-invite" href={buildCommitteeInviteHref(targetCompanyName)}>
        Invite a colleague
      </a>
    </section>
  );
}

/** Hidden entirely on a null chat_url, matching Ticket 32's established
 *  idiom for this exact field: a missing affordance stays absent rather than
 *  rendering a dead control. */
function ContactSellerSection({ chatUrl }: { chatUrl: string }) {
  return (
    <section className="bw-rail-section" data-testid="buyer-rail-contact" aria-label="Contact the seller">
      <h3 className="bw-rail-heading">Contact the seller</h3>
      <a className="bw-rail-link" href={chatUrl} target="_blank" rel="noopener noreferrer">
        Message your team →
      </a>
    </section>
  );
}
