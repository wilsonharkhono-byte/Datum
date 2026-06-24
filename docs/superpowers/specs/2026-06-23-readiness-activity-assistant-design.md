# Readiness Phase 2 — Activity log surfacing + schedule-aware assistant (design)

Date: 2026-06-23 · Status: design (no code) · Builds on slice 2a (`2026-06-23-readiness-step-ui-2a-design.md`) and its §13 roadmap (2b silence detection)

This note captures a gap found while using the step checklist, plus the bigger product
direction it points to: **the assistant becomes a schedule-aware reminder engine** by comparing
the *actual activity log* against the *prescribed to-do list* and the *back-scheduled working
timeline*. Slice 2a finally made all three of those first-class in the data model, so the
comparison is now possible.

---

## 1. The gap (found in use)

In `StepDetail.tsx`, the **"Tambah update progres… → Catat"** input writes a progress note via
`updateAreaStep()` (`apps/web/lib/steps/mutations.ts`), which **inserts a row into
`area_step_events`** (`note`, `status`, `percent_complete`, `logged_by_staff_id`, timestamps) and
then re-projects the step's `area_steps` row.

**But the note is never displayed.** The only read of `area_step_events` is inside
`projectAreaStep()` to *derive* status/actuals — there is no query that returns events for display,
and no UI that lists them. Effects of a note are visible only indirectly:
- `last_progress_at` bumps (feeds the 2b silence backstop);
- a `blocked` status's note becomes the shown `blocking_reason`;
- a plain progress note is otherwise **write-only**.

So today a user records "tukang datang besok, nunggu material" and it vanishes from view. That
both wastes the input and undercuts trust ("did it save?").

## 2. The vision (why this matters now)

The user's framing: there should be a **project activity feed**, and the **assistant should read
that activity against (a) the prescribed to-do list and (b) the working timeline**, then act as a
proactive reminder. Slice 2a made this newly feasible because the architecture now holds, per area,
all three aligned inputs:

| Input | Source (live today) |
|---|---|
| **Actual activity** | `area_step_events` — every status change + progress note, time-stamped, with author |
| **Prescribed to-do list** | `trade_steps` (+ `trade_step_deps`) → instantiated `area_steps` (the ordered 11-step bathroom sequence) |
| **Working timeline** | `area_steps.planned_start/planned_end` (back-scheduled from the Gate B target via `lib/steps/back-schedule.ts`) + `actual_start/end`, `last_progress_at` |

Before 2a, "compare what's happening to what should be happening" was impossible — there was no
machine-readable to-do list or per-step plan. Now it is just a join + a few rules.

## 3. Part A — surface the activity (the immediate fix)

1. **`getAreaStepEvents(supabase, areaStepId)`** in `apps/web/lib/steps/queries.ts` — return the
   step's events (note, status, percent_complete, occurred_at, author name) newest-first, RLS-scoped.
2. **Step timeline in `StepDetail.tsx`** — under the status controls, a calm **"Riwayat update"**
   list: each event = status chip + note + relative time + author. (Level-3 detail per the spec's
   "three calm levels" principle — collapsed by default if long.)
3. **Project activity feed** — a project-level view (and the mobile **Inbox/Activity** tab, which
   already exists) that merges `area_step_events` across the project's areas into one chronological
   feed ("Master Bathroom · Waterproofing → Berjalan: 'aplikator datang, mulai besok'"). This is the
   human-readable spine the assistant also consumes in Part B.

> Note: `area_step_events` is *not yet in the `supabase_realtime` publication*; the mobile build
> added `area_gate_status`/`areas`/`card_areas` (migration `20260622000002`) but not step events.
> If the activity feed should update live, add `area_step_events` to the publication.

## 4. Part B — schedule-aware assistant (the reminder engine)

Evolve the spec's deferred **2b** ("silence detection + escalation … plugs into the existing
`lib/assistant` infra") from a single silence cron into a general **activity-vs-plan-vs-timeline
comparator** that produces advisor signals + assistant reminders.

**Signals (pure, testable — live alongside `lib/steps/flags.ts` / `lib/advisor`):**
- **Silent** — `now - last_progress_at` exceeds the step's expected cadence while it's `in_progress`
  or inside its planned window. ("Waterproofing belum ada update 4 hari — masih jalan?")
- **Behind plan** — `today > planned_end` and status not `done`; or `today > planned_start` and still
  `not_started`. ("Screeding harusnya mulai 2 hari lalu.")
- **Lead-time risk** — a step with `lead_time_days` (e.g. *Booking aplikator waterproofing*) hasn't
  started but its successor's planned_start is within the lead time. ("Book the applicator now or
  Waterproofing slips.") — this is the high-value, schedule-aware nudge the spec §13 already named.
- **Blocking the timeline** — a `blocked` step whose successors' planned windows are imminent.
- **Stale decision/order** — `Pilih/Order sanitair` open past its planned window (cross-refs the
  card-event decision/order loops).

**Surfaces (reuse, don't reinvent):**
- Each signal → an **advisor item** (`lib/advisor`) so it shows in the **morning brief** + the
  mobile **brief** screen, ranked.
- A daily **cron** (mirror `analyze-attachments`) computes signals → writes **notifications**
  (in-app + the now-built **push fan-out**) so reminders reach the responsible staff.
- The **assistant** (`lib/assistant`) gains retrieval over the activity feed + plan, so "Tanya" can
  answer "apa yang telat di proyek X?" and "Catat" / a proactive prompt can suggest the next action.

**The loop the user wants:** staff log activity (one tap) → the comparator reads activity vs the
prescribed steps vs the back-scheduled timeline → the assistant reminds the right person, at the
right time, about the thing that will slip. The data-entry dependency (spec §11) is exactly why the
reminder backstop matters: when activity goes quiet, the assistant notices *because the plan says
something should be happening*.

## 5. Suggested sequencing (folds into the existing roadmap)

- **2a′ (already queued):** manual step add/edit + this note's **Part A** (surface the activity —
  step timeline + project activity feed). Small, high-trust, unblocks the rest.
- **2b (redefined):** the **comparator** — the pure signal rules over activity × plan × timeline,
  + the cron + advisor/notification/push surfaces. (Supersedes the narrower "silence cron only".)
- **2c:** assistant retrieval over the activity feed + plan (Tanya/proactive reminders), once 2b's
  signals exist.

## 6. Reuse / dependencies
- `lib/steps/{queries,mutations,status,flags,back-schedule,types}.ts` — the model + projection.
- `lib/advisor` + the brief surfaces (web `/brief`, mobile brief screen) — ranked signal display.
- `lib/assistant` + `/api/assistant/*` — retrieval + chat (mobile now calls these via Bearer auth).
- Notifications + the **push fan-out** (`apps/web/lib/notifications/push-send.ts`) + producers — delivery.
- Mobile **Inbox/Activity** tab — natural home for the project activity feed on mobile.
- Realtime: add `area_step_events` to `supabase_realtime` if the feed should be live.

## 7. Risks / open questions
- **Cadence thresholds** — "silent" / "behind" need per-step-type expected cadences (a step with a
  3-day typical duration is silent sooner than a 10-day one). Start simple (planned-window + a global
  N-day silence), tune later.
- **Reminder fatigue** — dedupe + escalate (don't re-notify daily for the same unchanged signal;
  escalate to the principal only after the assignee has been nudged). Mirror the notifications
  dedupe concern already noted for the unread badge.
- **Who's responsible** — a reminder needs a target. Use the step's `trade_role` → the project's
  staff in that role (or the area/card members) to address the nudge.
- **Data entry is still the crux** — Part A (making notes visible + satisfying) is what makes staff
  keep logging; the comparator is only as good as the activity it reads.
