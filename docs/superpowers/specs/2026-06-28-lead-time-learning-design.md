# Lead-Time Learning — Design

**Date:** 2026-06-28
**Status:** Design (autonomous build); spec → plan → implementation.
**Module:** Readiness system. Extends the duration learning loop (#27) to procurement lead times — the deferred half of "learn real timelines."

## Goal (vs the readiness end-goal)

Procurement/import **lead times** are a top slippage cause (the system is explicitly "import-lead-time-sensitive"). #27 learns real *durations* but applies everything to `typical_duration_days`; for **procurement** steps the realized actual is the order→arrival **lead time**, which drives the back-schedule offset. Learning it into `lead_time_days` makes future procurement scheduling accurate — directly serving "finishing work doesn't slip."

## Context — #27's loop (on main)

- `lib/learning/durations.ts`: `durationDays(start,end)` (calendar days), `summarizeDurations`, `learnedDurationRows(instances, steps, gateName)` → per step `{ estimate, stats, suggest }`, where `estimate = typical_duration_days` and `suggest = median when n≥5 && median≠estimate`.
- `lib/learning/queries.ts` `getDurationLearning` → gate-grouped `LearnedRow[]`.
- `apply_learned_duration(p_code, p_typical_duration_days)` RPC (manager-gated) + `applyLearnedDuration` action + `DurationLearningView` ("Terapkan" → `typical_duration_days`).
- Step types: `decision | procurement | site_work | inspection`; `trade_steps.lead_time_days` is the order→arrival offset.

## Decision

Make the learning loop **metric-aware by step type**, integrated into the existing `/library/durations` page (no new page):
- **`procurement` steps → learn into `lead_time_days`** (the realized span of a procurement step is its order→arrival lead time).
- **all other steps → learn into `typical_duration_days`** (unchanged from #27).

**Lead-time semantics (documented assumption):** a procurement step's `actual_start` (marked in-progress = ordered) → `actual_end` (marked done = arrived) is its realized lead time. The same `durationDays` math applies; only the *target column* and *labels* differ. Forward-looking and admin-reviewed, so a wrong assumption is caught before applying.

## §1 · Pure module (`durations.ts`)

- `StandardStepRow` gains `lead_time_days: number` and `step_type: string`.
- `LearnedRow` gains `metric: "duration" | "lead_time"` (so the view labels + routes the apply); `estimate` becomes the routed column's value.
- `learnedDurationRows`: per step, `metric = step_type === "procurement" ? "lead_time" : "duration"`; `estimate = metric === "lead_time" ? lead_time_days : typical_duration_days`; `suggest = median when n≥5 && median !== estimate`. (Median/min/max/n computed from `durationDays` exactly as today.)

## §2 · Query + apply (`queries.ts`, migration, `actions.ts`)

- `getDurationLearning`: also select `step_type, lead_time_days`; pass through to `learnedDurationRows`. (Same instance fetch.)
- **Migration** `<ts>_learned_lead_time.sql`: `apply_learned_lead_time(p_code text, p_lead_time_days int)` — `SECURITY DEFINER`, re-checks `current_can_manage_projects()`, validates `p_lead_time_days >= 0` (lead can be 0), updates `lead_time_days` + `updated_by`/`updated_at` on the firm-standard row; raise if not found. Grants like `apply_learned_duration`. (Parallel to #27's RPC; no change to it.)
- `actions.ts`: `applyLearnedLeadTime({ code, days })` — manager-gated, calls the RPC. (`applyLearnedDuration` unchanged.)

## §3 · View (`DurationLearningView`) + page

- Each row labels its metric: duration rows show `Estimasi {n}h durasi`; lead-time rows show `Estimasi {n}h lead time`. The "Terapkan {median}h" button routes by `row.metric` → `applyLearnedLeadTime` or `applyLearnedDuration`.
- Page header/blurb: "Analisa Durasi & Lead Time" — note procurement rows reflect order→arrival lead time.

## §4 · Scope & boundaries

- Reuses #27's aggregation/threshold (n≥5), page, gate grouping. Additive: new RPC + a `metric` field; `apply_learned_duration` and existing behavior for non-procurement steps unchanged.
- **Out of scope:** distinguishing "ordered" vs "arrived" with dedicated event kinds (uses the existing in_progress→done span); per-project lead-time forecasting; auto-apply.
- apps/web + one migration. The audit columns already exist (idempotent guard if re-added).
- **Verification gap:** the page UI — browser-verify on prod; the pure routing is unit-tested.

## Testing

- `learnedDurationRows` unit tests extended: a `procurement` step routes `metric="lead_time"`, `estimate=lead_time_days`, suggests vs lead time; a `site_work` step routes `metric="duration"`, `estimate=typical_duration_days` (the #27 behavior, unchanged); n<5 → no suggest for both.
- `apply_learned_lead_time` validated on the local stack (manager updates `lead_time_days`; `< 0` rejected; non-manager refused; unknown code raises).
- Page browser-verified (procurement rows show lead-time framing + apply to `lead_time_days`).
