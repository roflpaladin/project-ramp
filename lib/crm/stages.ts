// Static mock pipeline (Sprint 3, Ticket 16). v1.2 ships no live CRM
// handshake, so the Settings dropdown is seeded from this fixed array instead
// of a vendor stage API. Single source of truth for the UI and the save
// action's validation — the webhook filter itself never reads this list; it
// compares against the persisted trigger_stage config only.
export const MOCK_PIPELINE_STAGES = [
  "Discovery",
  "Qualification",
  "Evaluation",
  "Proposal",
  "Closed Won",
] as const;
