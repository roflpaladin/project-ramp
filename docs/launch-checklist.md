# Brava launch checklist (T64 part 1)

Goal: on Sun Nov 1, 2026 a stranger can sign up at https://www.getbrava.tech,
build a deal, hit the free limit and pay by card.

How to read this: tick `[x]` when done. Each line says **WHO** does it, **WHEN**,
and **VERIFY** (how to see it worked). "Founder" = you. "Session A" and
"Session B" are the two Claude sessions. Anything marked **(verify)** was not
confirmed in the code and must be checked before relying on it.

Never delete Paddle entities (products, prices, customers, subscriptions,
payment links). Refund and cancel only.

Reference: [docs/environments.md](./environments.md) (variables, backups,
manual plan override).

---

## 1. Before feature freeze (done by end of Sun Oct 18)

- [ ] **Register `?next=` PR merged** (`sprint-12-ticket-67-register-next`). WHO: Founder merges. WHEN: Oct 16. VERIFY: GitHub shows the PR as Merged and CI green.
- [ ] **Footer links + About + /security PR merged** (`sprint-12-ticket-67-public-site`). WHO: Session A builds, Founder approves the words and merges. WHEN: Oct 16. VERIFY: open https://www.getbrava.tech/security and the footer links on the home page; /security claims nothing untrue (no SSO, SLA or SOC 2).
- [ ] **"Close deal" at the top of the deal page** (`sprint-12-close-deal-top`). WHO: Session A, Founder merges. WHEN: Oct 17. VERIFY: open any deal at /admin/workspaces/<id>, the button is at the top, looks right in light and dark.
- [ ] **Geist font** (`sprint-12-geist-font`). WHO: Session A, Founder merges. WHEN: Oct 17. VERIFY: the home page text looks like Geist in both themes; numbers use the mono look.
- [ ] **CI fixture ids** (`sprint-12-ci-fixture-ids`). WHO: Session B, Founder merges. WHEN: Oct 16, before Oct 19. VERIFY: GitHub, CI tab, the check passes while the other session also pushes.
- [ ] **Backup PR merged** (T63). WHO: Founder merges. WHEN: Oct 16. VERIFY: GitHub, Actions, "Prod backup" has a green run (see section 4c).
- [ ] **T66 Google/Microsoft sign-in: decide.** WHO: Founder decides, Session B builds only if both consoles were ready by Fri Oct 16. VERIFY: if yes, sign-in with each works on a Preview link. If no, write "T66 cut: after launch" in Notion and skip it. Nothing else waits on T66.
- [ ] **Feature freeze confirmed.** WHO: Session A + Session B. WHEN: Sun Oct 18. VERIFY: both sessions say "freeze" in the hand-off; no open feature branches.

## 2. QA week (Mon Oct 19 to Sat Oct 24)

### 2a. Automated (Session B, Mon Oct 19)
- [ ] **Ask for the dev-database slot** ("slot?" then "free"). Tests write to the dev Supabase project, never prod. VERIFY: `.env.local` points at the dev project (see environments.md, "Why the split matters").
- [ ] **Run everything:** `npm test` (all vitest), then `npx vitest run tests/plans`, then `npx playwright test`. Also `npm run typecheck` and `npm run lint`. VERIFY: zero failures; Session B sends the pass counts to Session A. Release the slot afterwards ("slot released").
- [ ] **New e2e checks exist** for footer links, register `?next=`, and the signup button mode. VERIFY: they are in `e2e/` and passed.

### 2b. Manual walk on production (Session A, Oct 20 to 23)
Use a throwaway seller (an email you can discard, e.g. a plus-address). Do each step in **light and dark**, then repeat the key ones on a **phone-width** window.
- [ ] Register at https://www.getbrava.tech/register. VERIFY: you land in the app, no error.
- [ ] Onboarding at /admin/onboarding. VERIFY: a sample deal appears.
- [ ] Build a plan (stages and steps) on a new deal. VERIFY: it saves after a page refresh.
- [ ] Go live ("Make it live"). VERIFY: status shows Live.
- [ ] Buyer portal: open the buyer link in a private window and enter the access code from the email. VERIFY: the buyer sees the plan; the code email arrives (check spam too).
- [ ] Limit wall: on the Free plan (1 deal), try to create a second deal. VERIFY: you see the upgrade wall, not an error page.
- [ ] https://www.getbrava.tech/pricing. VERIFY: prices show, the cards look right, sign-up buttons lead to /register.
- [ ] https://www.getbrava.tech/settings/billing. VERIFY: shows Free and an upgrade path.
- [ ] Contrast and states: text is readable, status always has a dot AND a word. VERIFY: `npm run check:contrast` passes.
- [ ] Bugs found: Session A opens a branch `sprint-12-ticket-64-fix-<short-name>`. VERIFY: each fix has a PR, CI green, and you re-check that step on Preview.
- [ ] Clean up the throwaway seller's data only if you want to; do not touch any Paddle record.

### 2c. Security audit (Session B, by Sat Oct 24)
- [ ] `npm audit` run; every **high** and **critical** finding fixed (branch `sprint-12-ticket-63-audit`). WHO: Session B, Founder signs off. VERIFY: `npm audit --audit-level=high` reports none; Session A has the summary.
- [ ] Founder merges the QA fix PRs. WHEN: Oct 24.

## 3. Code freeze (Sun Oct 25)

- [ ] **Code freeze.** After today only branches named `sprint-12-ticket-64-fix-...` merge, and only for launch blockers. WHO: Session A + Session B. VERIFY: `main` on GitHub has no feature merges after Oct 25.
- [ ] **npm audit re-run + Founder sign-off.** WHO: Session B runs, Founder signs. VERIFY: still no high/critical.

## 4. Launch week (Mon Oct 26 to Sat Oct 31)

### 4a. Email (Resend)
- [ ] **Upgrade Resend to Pro.** WHO: Founder. WHEN: by Oct 27 (earlier is fine). VERIFY: Resend dashboard shows the Pro plan and its daily/monthly sending quota; write the daily quota down.
- [ ] **Raise `EMAIL_DAILY_LIMIT`** in Vercel, **Production** scope only. WHO: Founder (Session A gives the number). WHEN: same day. Set it to the new daily quota minus headroom (the default is 90, sized for the Free plan's 100/day). Then **Redeploy**: env changes only apply on the next build. VERIFY: Vercel shows the variable under Production; the new deployment is "Ready". The per-tenant limits follow automatically (a third of the global day, half of that per hour, minimum 10 a day and 5 an hour, maximum 400 a day and 100 an hour; on the Free plan that is 30/day and 15/hour). Source: `lib/rate-limit.ts`.
- [ ] **Send a real access code** to your own inbox from prod. VERIFY: it arrives within a minute.

### 4b. Paddle (payments)
- [ ] **Paddle approved?** WHO: Founder. VERIFY: Paddle dashboard shows the live account approved. Deadline for the decision: Fri Oct 30.
- **If approved:**
  - [ ] Set the **live default payment link** in the live Paddle dashboard (Checkout settings; exact menu name **(verify)**). WHO: Founder. VERIFY: Paddle shows the link saved.
  - [ ] Confirm Vercel **Production** has the live values (names in environments.md): `NEXT_PUBLIC_PADDLE_ENV` = `production`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (`live_...`), `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, and `PADDLE_PRICE_<TIER>_MONTH` / `_YEAR`. WHO: Founder + Session A. VERIFY: https://www.getbrava.tech/pricing shows real prices (the page is hidden, a 404, if the price ids are missing).
  - [ ] **Real-card Starter test on prod** with a throwaway seller. WHO: Founder pays, Session A watches. VERIFY: (1) /settings/billing says **Starter**; (2) /pricing shows **"Current plan"** on the Starter card.
  - [ ] **Refund AND cancel** that test purchase in the live Paddle dashboard. Never delete anything. WHO: Founder. VERIFY: Paddle shows the transaction refunded and the subscription cancelled.
- **If NOT approved by Fri Oct 30:** launch anyway on Nov 1 with free signup. Paid plans are set by hand for design partners using the SQL in [environments.md, "Granting a manual entitlement by hand"](./environments.md#granting-a-manual-entitlement-by-hand-invoice-customers). WHO: Session A prepares, Founder pastes. VERIFY: the customer's /settings/billing shows the plan; the SQL's step 3 check returns the right company name. Revoke by setting the entitlement back to null, never delete the row. Check what /pricing shows without live Paddle and hide buy buttons if needed **(verify)**.

### 4c. Monitoring and backups
- [ ] **UptimeRobot monitor on `/api/health`** (live since Oct 11). WHO: Founder. VERIFY: UptimeRobot shows https://www.getbrava.tech/api/health as Up; opening it shows `{"ok":true}`. If it shows `{"ok":false}`, search Vercel Logs for `[health]`.
- [ ] **Weekly backup is green** (first run Oct 11; runs Sundays 02:17 UTC). WHO: Session B checks, Founder glances. WHEN: Sun Oct 25 run, and run it by hand once more on Oct 30 (GitHub, Actions, "Prod backup", Run workflow). VERIFY: latest run is green and has an artifact named `prod-backup-<date>-run<id>`.
- [ ] **You can find `BACKUP_PASSPHRASE`** in your password manager. VERIFY: you can open the entry now, not during an emergency.

### 4d. Button flip rehearsal (Session A, Tue Oct 27)
- [ ] In Vercel, set `NEXT_PUBLIC_LANDING_MODE` = `signup` in the **Preview** scope only, then redeploy a preview of `main`. VERIFY: on that preview URL the home page button reads "Create your account" and goes to `/register` (instead of the waitlist form). Production still shows the waitlist.
- [ ] Set Preview back afterwards if you want previews to match prod. Any value other than exactly `waitlist` or `signup` falls back to `waitlist` (`lib/landing/mode.ts`).

### 4e. Go / no-go (Fri Oct 30)
- [ ] **Everything above is ticked** (or Paddle fallback chosen). WHO: Session A + Session B report, Founder decides. VERIFY: no open launch blockers; section 2 bugs closed; latest `main` CI green; `/api/health` ok; last backup green.
- [ ] **Decision written down:** GO or NO-GO, and the Paddle path (live or hand-set). WHO: Founder.

## 5. Launch day (Sun Nov 1)

- [ ] **Flip the button.** Vercel, Settings, Environment Variables: set `NEXT_PUBLIC_LANDING_MODE` = `signup` in **Production** scope. WHO: Founder. WHEN: morning Nov 1.
- [ ] **Redeploy** (Deployments, latest, "Redeploy"). The value is baked in at build time, so without this nothing changes. VERIFY: deployment is "Ready".
- [ ] **Check the home page.** Open https://www.getbrava.tech in a private window. VERIFY: the button says "Create your account" and goes to /register.
- [ ] **Register a test seller** on prod, complete onboarding. VERIFY: lands in the app; the sample deal appears.
- [ ] **Health.** Open https://www.getbrava.tech/api/health. VERIFY: `{"ok":true}`. UptimeRobot is still Up.
- [ ] **Watch for an hour:** Vercel Logs (search `[health]` and `[rate-limit]`), Resend dashboard for failed sends. VERIFY: no repeated errors. A `[rate-limit] shared store unavailable` line means migration 0016 is missing on prod.

## 6. Rollback (if something is wrong)

Do the smallest undo that fixes it.

| What went wrong | Undo | Verify |
| --- | --- | --- |
| Sign-up button should not be live | Vercel Production: set `NEXT_PUBLIC_LANDING_MODE` back to `waitlist` (or delete it; the default is waitlist), then Redeploy | Home page shows the waitlist form again |
| A bad deploy broke the site | Vercel, Deployments, pick the last good deployment, "Instant Rollback" (exact menu wording **(verify)**) | The site works; `/api/health` ok |
| Email limit set wrong | Vercel Production: fix or delete `EMAIL_DAILY_LIMIT` (default 90), Redeploy | A test access code arrives |
| Paddle trouble | Pause by cancelling in the live Paddle dashboard; do not delete entities. Fall back to hand-set plans (section 4b) | /settings/billing shows what you expect |
| Data lost or damaged | Backups are weekly GitHub Actions artifacts (`prod-backup-<date>-run<id>`, kept 90 days, encrypted). Restoring needs `BACKUP_PASSPHRASE` from your password manager. Follow "Real restore" in [environments.md, "Backups (prod)"](./environments.md#backups-prod); restore into a NEW Supabase project, never over the live one, and get a second pair of eyes | Row counts match `prod-counts.tsv` |

Remember: code rolls back instantly; the database does not. Database changes
are pasted by hand (environments.md, "Applying a migration"), so none are
planned for launch week.

## 7. After launch

- [ ] **OTPLESS and Proximus:** when they sign up, give them their plan by hand with the manual entitlement SQL (environments.md, link in 4b). WHO: Founder pastes, Session A prepares. VERIFY: their /settings/billing shows the plan and no limit wall. Neither has signed up yet.
- [ ] **Sentry error tracking:** post-launch backlog, not a launch blocker.
- [ ] **Revisit Supabase Pro** (daily backups) at the first paying customers; today's recovery point is up to 7 days.
- [ ] **Google/Microsoft sign-in (T66)** if it was cut.
