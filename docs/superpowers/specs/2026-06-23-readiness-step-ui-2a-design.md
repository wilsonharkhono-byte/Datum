# Readiness Phase 2 — Slice 2a: visible & updatable steps (design)

- **Date:** 2026-06-23
- **Status:** Approved design (pre-plan)
- **Branch:** `feat/readiness-phase2-step-ui`
- **Builds on:** Phase 1 Gate B model (merged, PR #14) — `trade_steps`, `area_steps`,
  `area_step_checkpoints`, `punch_items`, `seed_area_steps`, and the pure `projectStepStatus` /
  `backScheduleSteps` logic in `apps/web/lib/steps/`.

---

## 1. Problem

Phase 1 built the Gate B trade-step model but it is **invisible** — the tables exist, a bathroom
gets its 11 steps instantiated, but no one can see or touch them. Phase 2 makes the model
*usable by site staff* and turns their use into the progress signal everything else needs.

Two hard requirements from the field (Wilson, 2026-06-23):

1. **Status is not a one-way button.** A step runs for weeks/months. "Mulai → Tandai selesai"
   is too rigid — staff must set status freely (belum mulai / berjalan / terblokir / selesai) and
   log progress updates *along the way*. The current state must always reflect reality.
2. **The system must flag what's next and what's waiting.** Driven by the dependency model, it
   surfaces the next step that's ready to start and any step stalled on an open decision/order —
   so nothing silently waits.

And the screen must **not overwhelm** — progressive disclosure, one action at a time.

## 2. Goals & non-goals

### Goals (slice 2a)
- A **collapsible step checklist** per bathroom area on the schedule page (3-level disclosure).
- **Flexible status control** — set any status freely + log lightweight progress updates.
- **Event-sourced updates** → a projection keeps `area_steps` current and **captures actuals**
  (`actual_start`, `actual_end`, `last_progress_at`) as a by-product of normal use.
- **Flagging**: per-area "Perlu perhatian" (siap dimulai + perlu keputusan) + inline blocked flag.
- **Checkpoint** tick (pass/fail) in the step detail; gates `selesai → accepted`.

### Non-goals (deferred — see §13 roadmap)
- Manual add/edit/remove of steps per project (**slice 2a′**, the immediate follow-up).
- Promote a custom step to the firm standard template.
- Silence detection + escalation (**slice 2b** — reads 2a's `last_progress_at`).
- The AI guidance button (reads accumulated steps/actuals → suggests steps + lessons).
- Rolling step-level acceptance up into the existing gate-level readiness.
- Editable durations + learning-loop analytics (Phase 1 spec §8a).

## 3. UX principle — three calm levels

Minimal by default; reveal on demand. Bahasa Indonesia UI.

- **Level 1 — Area row (collapsed):** area name + a quiet `N/11 selesai` + the next step. A
  chevron opens it. Plus the **Perlu perhatian** line when there's something to flag.
- **Level 2 — Step list (expanded):** the steps in `sort_order`; each row = a status chip + the
  step name. Done steps dimmed; the current/next step highlighted (*Sekarang* / *Siap dimulai*);
  blocked steps show a *Terblokir* flag. No controls, dates, or checkpoints at this level.
- **Level 3 — Step detail (tap a row):** planned window + trade (one quiet line), the **status
  control**, **Tambah update**, the **checkpoint** tick-list, and *Blokir* (secondary).

## 4. Flexible status control (the core fix)

The step detail presents the status as a **settable control**, not a one-way button. Statuses a
user can set: **Belum mulai · Berjalan · Terblokir · Selesai**. (`stalled` is set only by the
silence job in 2b; `accepted` vs `done_with_defects` is *derived* from checkpoints/punch, not set
by hand.)

- **Berjalan** → records `actual_start` on first transition; stays berjalan for as long as the
  real work runs.
- **Tambah update** → log a one-line note (and optional %) *without changing status* — the
  weeks-long heartbeat. Each update refreshes `last_progress_at` (and is what keeps the step from
  reading "silent" in 2b).
- **Terblokir** → requires a short reason (stored as the blocking reason, shown inline).
- **Selesai** → the projection decides: `accepted` if every required checkpoint passed and no open
  kritis/mayor punch; otherwise `done_with_defects` (chip reads *Selesai (ada defect)*). Records
  `actual_end`.

## 5. Event-sourced model + actuals capture

Step updates are **append-only events**, not direct mutations — one source of truth, and actuals
fall out for free.

**Decision:** use a **dedicated `area_step_events` log**, not `card_events`. Steps belong to an
*area*, not a card, so overloading `card_events` (which requires a `card_id`) would be wrong. The
existing pure `projectStepStatus` already reads a generic `{occurred_at, created_at, payload}`
shape, so it works against this table unchanged.

**`area_step_events`** (append-only):

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `area_step_id` | uuid → `area_steps` | |
| `project_id` | uuid → `projects` | for RLS |
| `status` | text | `not_started` \| `in_progress` \| `blocked` \| `done` — the step's state as of this event |
| `note` | text null | progress note / blocking reason |
| `percent_complete` | numeric null | optional |
| `occurred_at` | timestamptz default now() | |
| `logged_by_staff_id` | uuid → `staff` null | |
| `created_at` | timestamptz default now() | tiebreak |

RLS: project-scoped via `current_can_read_project(project_id)` (read + insert for project members).

**Projection (extends Phase 1 `projectStepStatus`, pure):** given an area_step's events +
checkpoints + punch items, return `{ status, actual_start, actual_end, last_progress_at,
blocking_reason }`:
- `status` — as today (latest event wins; done → accepted/done_with_defects via checkpoints/punch).
- `actual_start` — earliest `in_progress` event date.
- `actual_end` — the `done` event date (when status resolves to accepted/done_with_defects).
- `last_progress_at` — latest event `occurred_at`.
- `blocking_reason` — note of the latest `blocked` event.

## 6. Flagging (pure, testable)

**`computeAreaFlags(steps, deps)` → `{ readyToStart, needsDecision[], blocked[] }`**, where each
`step` carries its current status:
- **`readyToStart`** — the first `not_started` step whose predecessors are all `accepted`
  (or done). Rendered as *Siap dimulai*.
- **`needsDecision`** — `decision`/`procurement`-type steps not yet done that gate a not-started
  site step (their being open is what blocks progress). Rendered as *Perlu keputusan: <name>*.
- **`blocked`** — steps whose status is `blocked`/`stalled`.

The area "Perlu perhatian" line shows `readyToStart` + the top `needsDecision`. Empty → the line
is hidden (no noise).

## 7. Server actions

- **`updateAreaStep(supabase, { areaStepId, status?, note?, percentComplete?, blockedReason? })`** —
  (1) resolve `project_id` from the area_step; (2) insert an `area_step_events` row (status defaults
  to the step's current status when only a note is added); (3) re-run the projection over all the
  step's events + checkpoints + punch; (4) persist `status`/`actual_start`/`actual_end`/
  `last_progress_at`/`blocking_reason` to `area_steps`. Returns the updated row. Authorised to any
  project member (mirrors `area_steps` write RLS).
- **`setCheckpointResult(supabase, { checkpointId, result })`** — update
  `area_step_checkpoints.result` (`pass`/`fail`/`pending`) + `checked_by`/`checked_at`; re-run the
  projection for the parent step (a checkpoint pass can flip `done_with_defects → accepted`).

## 8. UI components (thin client)

- **`AreaStepsPanel`** (client) — rendered per bathroom area on
  `app/(app)/project/[slug]/schedule/page.tsx`. Owns the collapse state and the 3 levels.
- **`StepRow`** — chip + name + highlight/flag; expands to **`StepDetail`**.
- **`StepDetail`** — the status control, *Tambah update*, checkpoint tick-list, *Blokir*; calls the
  server actions and refreshes (server action + `router.refresh()`, matching the topics pattern).
- **`PerluPerhatian`** — the per-area flag line, fed by `computeAreaFlags`.

Data comes from an extended **`getAreaSteps`** (Phase 1) that also returns each step's checkpoints
and the computed flags for the area.

## 9. Builds on (reuse, don't reinvent)
- `lib/steps/status.ts` (`projectStepStatus`) — extend to emit actuals; same latest-wins semantics.
- `lib/steps/types.ts`, `queries.ts`, `mutations.ts` — extend.
- `lib/gates/readiness-rules.ts` — the append-only "latest event wins" precedent.
- Topics realtime/`router.refresh()` pattern (`lib/cards/mutations.ts` `createTopic`) for non-realtime UI refresh.
- RLS helpers `current_can_read_project`, `set_updated_at`.

## 10. Testing
- **Pure (Vitest, `now`-injected):** extended `projectStepStatus` (actual_start/end across an event
  series); `computeAreaFlags` (readyToStart / needsDecision / blocked across statuses + deps).
- **Integration:** `updateAreaStep` (event → projection → area_steps) and `setCheckpointResult`,
  verifiable against the local Supabase stack (smoke pattern from Phase 1).
- **UI:** thin components; verify the 3-level collapse + that one action is shown at a time.

## 11. Risks & dependencies
- **Data-entry dependency (still the crux).** 2a only generates signal if staff actually tap. The
  *Tambah update* must be one tap on mobile; 2b's silence alarm is the backstop for when they don't.
- **Status vs derived state confusion.** Users set `selesai`; the system may show *Selesai (ada
  defect)*. Copy must make this legible (e.g. a one-line "2 checkpoint belum lulus").
- **Live Supabase.** New migration (`area_step_events`) is additive; `db push` only, via global CLI.

## 12. Success criteria
1. On the schedule page, a bathroom shows its steps collapsed; expanding reveals the ordered list
   with the current step highlighted; tapping a step reveals exactly one detail panel.
2. A staffer can set a step *Berjalan*, add two progress updates over time, then *Selesai* — and
   `area_steps` shows `actual_start`, `actual_end`, and the latest `last_progress_at`.
3. A bathroom with an open marble decision shows *Perlu keputusan: Pilih material* and its
   dependent site step is not offered as *Siap dimulai*.
4. Marking *Selesai* with a failed required checkpoint yields *Selesai (ada defect)*, not accepted.

## 13. Roadmap (the bigger vision, deferred)
- **2a′ — manual step add/edit/remove per bathroom.** Projects vary (extra fixtures, one-off client
  requests). Needs `area_steps` to carry ad-hoc steps (nullable `step_code` + custom
  name/trade/duration/checkpoints). The immediate next slice after 2a.
- **Promote to standard.** "Simpan ke standar" lifts a proven custom step into `trade_steps` so
  future bathrooms get it — the firm's guide compounds. Needs light governance (who can promote).
- **2b — silence detection + escalation.** Cron reads `last_progress_at` vs the planned window →
  Tier-1 nudge supervisor, Tier-2 warn estimator + principal.
- **AI guidance button.** Claude reads `trade_steps` + `area_steps` + `area_step_events` across past
  bathrooms to (a) suggest steps/checkpoints for a new one, and (b) surface lessons ("waterproofing
  here usually slips — book the applicator earlier"). Plugs into the existing `lib/assistant` infra;
  earns its keep once there's history.
- **Gate rollup.** Reconcile step-level `accepted` with the existing gate-level readiness.
- **Editable durations + learning-loop analytics** (Phase 1 spec §8a).
