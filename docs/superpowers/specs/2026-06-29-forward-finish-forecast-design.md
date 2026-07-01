# Forward-Looking Finish Forecast — Design (capstone)

**Date:** 2026-06-29
**Status:** Design (autonomous build); spec → plan → implementation → adversarial verification.
**Module:** Readiness system. Upgrades the coarse slip-risk overview (#34) into a **precise, day-count projection**: "this project is projected to hand over on DATE — N days past target."

## Goal (vs the readiness end-goal)

The system exists so *finishing work doesn't slip*. #34 answers *which* projects are at risk (a coarse level from signals). This answers the harder, higher-value question: **by how much, and when** — a forward projection of each area's actual finish from today + real progress, versus its handover target. It is the deepest realization of the proactive engine.

## Context — the model to mirror (grounded on main)

- **`back-schedule.ts`** assigns each step a planned window: physical steps (`site_work`/`inspection`) run a **forward** topological pass (`start = max(window.start, latest predecessor planned_end); end = start + duration`); upstream steps (`decision`/`procurement`) run a back pass (`start = end − (lead_time + duration)`). Calendar days, guarded topological loops, `addDays`. Called **per-gate** by `writePlannedDates` with `window = area_gate_status.target_start/end_date`.
- **`getProjectStepSignals`** already fetches, per project in one round-trip: every `area_steps` row (`step_code, status, planned_start, planned_end, actual_start, actual_end, area_id`) joined to `trade_steps` (`step_type, lead_time_days, typical_duration_days`), plus the full `trade_step_deps` graph, grouped by `area_id`. The forecast mirrors this fetch.
- **Targets:** `compute_project_schedule` upserts `area_gate_status.target_end_date` for **every** area×gate (kickoff + gate `active_weeks`). So `max(target_end_date)` per area = the handover target — populated for **all** room types (unlike `planned_*`).
- **Population gap:** `writePlannedDates` runs only for `area_type === "bathroom"` (`area-mutations.ts:66,116`) → `planned_start` is reliable only for bathrooms.
- **`StepStatus`** = `not_started | in_progress | blocked | stalled | done_with_defects | accepted | not_applicable`. **Done** = `accepted` ∪ `done_with_defects`. `not_applicable` is excluded.

## Decision

A **pure forward-forecast engine** (`forecastArea`) that projects each area's finish from *today + actuals* along the dependency graph, plus a query that runs it per project and a rollup, surfaced on `/risiko`. No schema change, no new scheduler infra — it reuses the deps graph, the step fields, and the gate targets.

**Baseline = the area's handover target** (`max(target_end_date)`), not `max(planned_end)` — because targets are universal and `planned_*` is bathroom-only.

**Graceful degradation (a correctness property, not a limitation to hide):**
- Bathrooms have `planned_start` → not-started steps anchor **as-scheduled** (`max(planned_start, today, predFinish)`) → tracks the plan, flags a slip as soon as the plan is threatened. *Precise.*
- Other rooms lack `planned_start` → not-started steps anchor **ASAP** (`max(today, predFinish)`) → the area is flagged as slipping only when *even starting everything today* can't hit target. *Conservative — no false positives.*
- Generalizing `writePlannedDates` to all rooms would sharpen non-bathroom precision — a flagged enabler follow-up, not required here.

## §1 · Pure engine (`lib/steps/forecast.ts`)

```
type ForecastStep = {
  step_code: string; step_type: StepType; status: StepStatus;
  typical_duration_days: number; lead_time_days: number;
  planned_start: string | null; actual_start: string | null; actual_end: string | null;
};
type AreaForecast = {
  target: string | null;          // max(target_end_date); null if none
  projectedFinish: string | null; // max projected_end over applicable steps; null if none
  slipDays: number | null;        // daysBetween(target, projectedFinish); +late / −early; null if either missing
  complete: boolean;              // all applicable steps done
  hasPlan: boolean;               // any applicable step has planned_start (precise vs ASAP)
};
forecastArea(steps: ForecastStep[], deps: TradeStepDep[], today: string, target: string | null): AreaForecast
```

Definitions (calendar-day; reuse `addDays`, add `daysBetween(a,b) = round((Date.parse(b)−Date.parse(a))/DAY_MS)` on the YYYY-MM-DD slices):
- `applicable` = steps with `status !== "not_applicable"`. If none → `{ target, projectedFinish:null, slipDays:null, complete:false, hasPlan:false }`.
- `isDone(s)` = `status ∈ {accepted, done_with_defects}`.
- `span(s)` = `typical_duration_days + (step_type === "procurement" ? lead_time_days : 0)` (coerce NaN/negative → 0).
- **Forward topological pass** over `applicable` by `trade_step_deps` predecessors (only edges whose both ends are in the set; guarded loop like back-schedule; cycle-safe fallback):
  - `predFinish` = `max(projected_end[p])` over resolved in-set predecessors, else `null`.
  - **done:** `projected_end = actual_end ?? actual_start ?? today`.
  - **in_progress:** `elapsed = actual_start ? max(0, daysBetween(actual_start, today)) : 0`; `remaining = max(1, span − elapsed)`; `projected_end = addDays(max(today, predFinish ?? today), remaining)`.
  - **else (not_started / blocked / stalled):** `startBasis = planned_start ? maxIso(planned_start, today) : today`; `anchor = maxIso(startBasis, predFinish ?? startBasis)`; `projected_end = addDays(anchor, span)`.
  - Cycle fallback: any step still unresolved after the guard → `projected_end = addDays(planned_start ? maxIso(planned_start,today) : today, span)` (no preds), mark resolved.
- `projectedFinish` = max `projected_end` over applicable (null if none).
- `complete` = `applicable.length>0 && applicable.every(isDone)`.
- `slipDays` = `(target && projectedFinish) ? daysBetween(target, projectedFinish) : null`.

Pure, no DB, exhaustively unit-tested (see Testing).

## §2 · Query + rollup (`lib/steps/forecast-queries.ts`)

`getProjectForecast(supabase, projectId, today)`:
- Fetch (mirroring `getProjectStepSignals`): `area_steps` (`step_code, status, planned_start, actual_start, actual_end, area_id` + `trade_steps(step_type, lead_time_days, typical_duration_days)`) for the project; `trade_step_deps` once; `area_gate_status` (`area_id, target_end_date`) → per-area `target = max(target_end_date)`; `areas(id, area_name)`.
- Per area → `forecastArea(steps, deps, today, target)` → `AreaForecast` (+ `areaId`, `areaName`).
- **Project rollup** `ProjectForecast`: `targetHandover = max(target)`; `projectedHandover = max(projectedFinish)` over areas that have a target; `slipDays = max(area.slipDays)` (the worst/critical area — null if no area has a slip number); `worstArea = { areaName, slipDays, projectedFinish }` for the max-slip area; `areas: AreaForecast[]` (with names) for a drill-down.
- Returns `{ projectId, ...ProjectForecast }`. Own fetch (isolated from the merged `getProjectStepSignals` hot path — a shared bundle-fetch is a flagged optimization).

## §3 · Surface (`/risiko`)

Extend `getProjectsSlipRisk` (slip-risk-queries.ts) to attach `forecast: ProjectForecast` per project (call `getProjectForecast` inside the existing `Promise.all` map; `today` already computed by the page). Keep #34's level ranking; **secondary-sort within level by `forecast.slipDays` desc** (null last) so the most-behind project floats up.

`/risiko` rows gain a forecast line when `forecast.slipDays != null`:
- `slipDays > 0`: `Perkiraan handover {projectedHandover} · +{slipDays} hari dari target` (red-ish) + `— {worstArea.areaName}` when it's the driver.
- `slipDays <= 0`: `Perkiraan handover {projectedHandover} · sesuai/di depan target` (muted).
- `forecast.slipDays == null` (no targets / unseeded): no forecast line (silent — the level chip still shows).

CSS-var Tailwind, Bahasa. apps/web only.

## §4 · Scope & boundaries

- **No schema change, no new scheduler infrastructure** — reuses deps + step fields + gate targets. Pure engine + one query + a `/risiko` enhancement.
- **Out of scope:** per-area forecast display on the schedule page (fast follow, same engine); generalizing `writePlannedDates` to all rooms (the precision enabler — flagged); working-day/resource-leveled scheduling (back-schedule itself is calendar-day v1); a re-forecast cron / stored projection.
- **Efficiency:** `/risiko` now runs `getProjectStepSignals` + `getProjectForecast` per project (both hit `area_steps`+`trade_step_deps`). Acceptable at the small active-project count; a shared bundle-fetch is the flagged optimization.
- **Verification:** the engine is the risk and **cannot be browser-verified** → it is unit-tested with hand-worked scenarios AND put through an adversarial multi-lens verification (workflow) before PR. The `/risiko` line is browser-verified by the user.

## Testing (exhaustive — the engine is the whole risk)

`forecastArea` unit tests, each with a hand-computed expected date:
1. **On-schedule bathroom** (planned_start present, all not_started, planned within target) → `projectedFinish ≈ target`, `slipDays ≈ 0`.
2. **Late in-progress procurement pushes downstream site work** — an `in_progress` procurement past its plan → its `projected_end` propagates through a `site_work` dependent → area `slipDays > 0` by the propagated amount.
3. **All done** → `complete:true`, `projectedFinish = max(actual_end)`, `slipDays = actual vs target` (can be negative).
4. **ASAP degradation (non-bathroom, no planned_start)** — not_started chain → `projectedFinish = today + critical span`; `slipDays > 0` only when that exceeds target; `hasPlan:false`.
5. **Dependency propagation** — a 3-step chain decision→procurement→site: the procurement's `lead_time` is included in span; the site step starts after the procurement's projected_end.
6. **Edges:** empty steps → all-null; all `not_applicable` → all-null; `target = null` → `slipDays = null`; a dependency cycle → cycle-fallback, no infinite loop (guard).
7. `daysBetween` sign + whole-day rounding; `span` for procurement (lead+duration) vs others (duration only); `isDone` covers both `accepted` and `done_with_defects`.

`getProjectForecast`: rollup picks the worst-area slip as the project slip; areas without targets excluded from `projectedHandover`; verified via a typed shape (mapping is the logic).
