// T47 (Sprint 9, Ticket 47 — public landing page, phase 1). Copy slots kept
// in their own module, deliberately separate from app/page.tsx's layout, so
// T48 (headline A/B test) has exactly one obvious file to edit — swapping
// LANDING_HEADLINE (or adding variants of it) never requires touching the
// page's structure. Voice per the design guideline: active voice, sentence
// case, no hype, no "!", none of the banned words (leverage, synergy,
// supercharge, seamless, unlock, empower, effortless, revolutionise).

export const LANDING_KICKER = "For sellers and buyers, together";

export const LANDING_HEADLINE = "One plan, one next move — for you and your buyer.";

export const LANDING_SUBLINE =
  "Brava is the shared workspace where a seller and a buyer commit to a plan and act on it together.";

export const LANDING_HERO_NOTE = "No spam. One email when we launch.";

export interface ValueProp {
  readonly title: string;
  readonly body: string;
}

// 2-3 value props, mutual-success-plan positioning (seller + buyer both
// present, neither cast as the sole audience).
export const LANDING_VALUE_PROPS: readonly ValueProp[] = [
  {
    title: "One plan, not two inboxes",
    body: "Seller and buyer work from the same plan, so nobody has to reconcile two different stories of where a deal stands.",
  },
  {
    title: "Always clear whose move it is",
    body: "Every step names an owner and a status — done, waiting, or next — so nothing sits quietly for weeks.",
  },
  {
    title: "Progress your buyer can see too",
    body: "Your buyer gets their own view of the same plan, with their own next step, not a forwarded PDF.",
  },
];
