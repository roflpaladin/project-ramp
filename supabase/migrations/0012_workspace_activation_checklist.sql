-- Sprint 11, Ticket 58: "In-App Onboarding Checklist".
--
-- Dismissal of the per-workspace activation checklist (populated / invited /
-- live) persists here rather than in localStorage — founder decision: it
-- must follow the workspace itself across devices/browsers/sessions, the
-- same reasoning every other per-workspace flag in this schema (workspaces.
-- approved_emails, chat_url, crm_*) already lives in the row rather than
-- client storage. Nullable timestamptz, not a boolean: null means "never
-- dismissed" and a real value both flags the dismissal AND records when it
-- happened, for free, without a second column.
--
-- No RLS policy change needed: this column rides the same "AE manages own
-- tenant workspaces" policy (0001) every other workspaces column already
-- does — no new access shape is introduced.

begin;

alter table workspaces
  add column if not exists activation_checklist_dismissed_at timestamptz;

commit;

-- Down / rollback (manual -- uncomment and run only to reverse this migration):
--   begin;
--     alter table workspaces drop column if exists activation_checklist_dismissed_at;
--   commit;
