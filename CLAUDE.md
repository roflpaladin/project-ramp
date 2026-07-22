# Ramp

Shared workspace where a seller and a buyer commit to a mutual success plan and act on it together. Two people, one plan, one next move.

## Source of truth — read before building

Design, product, and technical truth live in **Notion**, not in this repo. Always fetch the live page before acting; local files may lag.

- **UI / brand / design system** → Notion page **"UI/UX and Design Guidelines"**: https://app.notion.com/p/3a48db98da2180f4bcbdd1db6c43b22d
  This page owns tokens, scales, components, and build rules (tiered `MUST` / `SHOULD` / `JUDGEMENT`). If any local copy or the `ramp-brand-guideline` skill disagrees with it, **the Notion page wins.**
- **Product requirements** → the **PRDs** database under the Project Ramp hub (e.g. current sprint: **1.4 PRD**).
- **Technical spec / schema / RLS** → Notion **"Technical Source of Truth."**

### `docs/` is dated snapshots, not law

`docs/ramp-ui-ux-guidelines-SNAPSHOT-<date>.md` is a point-in-time export for offline reference. It is **not** the source of truth. Do not trust it over the Notion page, and do not edit it to change the system — edit Notion, then re-export. When in doubt, fetch the live page.

## Non-negotiable UI rules (summary — full rules in the Notion page)

- One family: Geist (Geist Mono for data/numbers). Weights 400/500/600. Sentence case everywhere.
- Colour does exactly one job: neutrals (the room), sides *whisper* (identity), states *speak* (status), Signal *shouts* (action). Never a fifth loud colour.
- Signal is warm amber, action only. **One Signal per decision scope.** Waiting renders in Slate, never a loud colour.
- Both light and dark themes MUST ship. Never hardcode `#FFF`/`#000`.
- Status is never colour-only — always dot + text label. Contrast floor: body/label ≥ 4.5:1.
- Buyer whitelabel: Ramp owns the chrome; buyer accent only on the identity rule + favicon, max 24px logo, never on a button, never replaces Signal.
