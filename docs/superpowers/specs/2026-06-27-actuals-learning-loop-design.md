# Actuals → Duration Learning Loop — Design

**Date:** 2026-06-27
**Status:** Design approved in brainstorming; pending spec → plan → implementation.
**Module:** Readiness system. Sequel to the multi-room steps (Piece A, PR #24, merged) and the firm-standard library editor (Piece B, in parallel).

## Goal

Turn the actuals already captured per step into a **learning loop**: aggregate real step durations across all projects and suggest revised firm-standard `typical_duration_days`, so the firm's estimates get more accurate as jobs finish. An admin reviews each suggestion and applies it with one click.

## Context — what already exists (so this feature is the loop, not capture)

- **Actuals are captured.** `projectStepStatus` (`apps/web/lib/steps/status.ts`) derives `actualStart` (earliest in-progress event) and `actualEnd` (completion event); `projectAreaStep` (`apps/web/lib/steps/mutations.ts`) writes them to `area_steps.actual_start` / `actual_end` on every status log. No capture work needed.
- `trade_steps.typical_duration_days` (working days) is the estimate this loop revises. `lib/steps/back-schedule.ts` defines the working-day calendar used for planning.
- Firm-standard steps = `trade_steps` with `project_id IS NULL AND source = 'standard'`; `area_steps.step_code` references `trade_steps.code`.
- **Piece B** (parallel) adds a firm-standard write path (RLS + `update_standard_step` + `updated_by`/`updated_at` columns). This feature stays **decoupled** from it (own apply RPC; idempotent column adds) so neither blocks the other.

## Decisions (from brainstorming)

1. **Output = revise firm-standard durations** — suggestions an admin applies (not per-project re-forecast; that's a separate later piece).
2. **Metric = median actual, gated at n ≥ 5** — robust to outliers; below the threshold, show "Belum cukup data," never a suggestion.
3. **"Actual duration" = calendar days between `actual_start` and `actual_end`** — back-schedule uses a **calendar-day** model (`planned_end = addDays(start, typical_duration_days)`; "no working-day calendar", verified `back-schedule.ts:26`), so actuals must be calendar days to be comparable. `durationDays = max(1, wholeDaysBetween(startDate, endDate))` (same-day or <1-day completion = 1; honestly includes real-world friction like blocked gaps).
4. **Surface = a separate admin page** (`/library/durations`, "Analisa Durasi") with one-click apply — file-decoupled from Piece B.
5. **Apply = a dedicated `SECURITY DEFINER` RPC** (manager-gated) that updates only `typical_duration_days` (+ audit). No dependency on Piece B's RLS/RPCs.
6. **Lead-time learning deferred** — order-placed-vs-arrived isn't cleanly captured yet.
7. **On-demand compute** — aggregate when the page loads; no cron/materialized table (data volume is small).

## §1 · Measurement & aggregation (pure, heavily tested)

A pure module `apps/web/lib/learning/durations.ts`:

- `durationDays(start: string, end: string): number` — `max(1, wholeDaysBetween(startDate, endDate))` where `wholeDaysBetween = Math.floor((endMidnight - startMidnight) / 86_400_000)` on the date portions. Calendar days, matching `back-schedule.ts`'s `addDays`-offset model (verified calendar-day, not working-day). Same-day = 1.
- `summarizeDurations(samples: number[]): { median: number; min: number; max: number; n: number }` — median (for even n, the **rounded mean of the two middle values**, e.g. `[1,2,3,6] → round(2.5) = 3`), min, max, count.
- `learnedDurationRows(instances: DurationInstance[], steps: StandardStepRow[]): LearnedRow[]` — per firm-standard step: collect the working-day durations of its completed instances, summarize, and produce `{ code, gate_code, name, estimate, stats | null, suggest: number | null }`. `suggest` is the median **only when** `n ≥ 5` **and** `median !== estimate`; otherwise null. `stats` is null when `n === 0`.

Types:
```
type DurationInstance = { step_code: string; actual_start: string; actual_end: string };
type StandardStepRow = { code: string; gate_code: string; name: string; typical_duration_days: number };
type LearnedRow = { code: string; gate_code: string; gateName: string; name: string; estimate: number;
                    stats: { median: number; min: number; max: number; n: number } | null; suggest: number | null };
```

Only instances with **both** `actual_start` and `actual_end` non-null contribute (a step marked done without ever going in-progress has no `actual_start` → excluded).

## §2 · Data & apply path (decoupled from Piece B)

- **Query** `apps/web/lib/learning/queries.ts` → `getDurationLearning(supabase)`:
  - Fetch active firm-standard steps (`code, gate_code, name, typical_duration_days` where `project_id IS NULL AND source='standard' AND active`).
  - Fetch completed instances: `area_steps.select("step_code, actual_start, actual_end").in("status", ["accepted","done_with_defects"]).not("actual_start","is",null).not("actual_end","is",null)`.
  - Run `learnedDurationRows`, group by gate (reuse `gateShortName`), return `{ gate, gateName, rows }[]`.
- **Migration** `<ts>_learned_duration.sql`:
  - `alter table public.trade_steps add column if not exists updated_by uuid references public.staff(id), add column if not exists updated_at timestamptz;` (idempotent; coexists with Piece B).
  - `apply_learned_duration(p_code text, p_typical_duration_days int) returns void`, `SECURITY DEFINER`, `search_path = public`: re-check `current_can_manage_projects()` (raise if not); validate `p_typical_duration_days >= 1`; `update trade_steps set typical_duration_days = p_days, updated_by = auth.uid(), updated_at = now() where code = p_code and project_id is null and source = 'standard'`; raise if not found. `revoke all ... from public; grant execute ... to authenticated;`
- **Action** `apps/web/lib/learning/actions.ts` → `applyLearnedDuration({ code, days })`: re-gate with `getCurrentStaff` + `canManageAccess`; call the RPC; return `{ ok } | { ok:false, error }`.

## §3 · Surface

`apps/web/app/(app)/library/durations/page.tsx` — admin-gated (`getCurrentStaff` + `canManageAccess`, redirect `/` otherwise), mirroring Piece B's gate. Renders gate-grouped sections; each step row:
`name · Estimasi {estimate}h · Aktual median {median}h (n={n}) · {min}–{max}h · [Terapkan {median}h]`.
The **Terapkan** button shows only when `suggest !== null`; rows with `stats === null` show "Belum cukup data"; rows with data but `n < 5` show the stats greyed with "Belum cukup data untuk saran." A banner notes the opt-in-pull rule (applying changes future seeding only). Client component `DurationLearningView` handles the apply via `useTransition` + `router.refresh()`. Conventions: `{ok}|{error}` actions, `min-h-11 md:min-h-0`, CSS-var Tailwind, Bahasa Indonesia.

A gated nav link "Analisa Durasi" to `/library/durations` (coordinates with Piece B's nav link — sibling entries; trivial merge).

## §4 · Scope, boundaries, reality

- **Durations only.** Lead-time learning is a later piece (needs richer procurement event capture).
- **On-demand**, no cron/stats table.
- **Forward-looking:** with today's data (~one bathroom, mostly not_started) the page reads "Belum cukup data" almost everywhere — expected; value accrues as projects complete steps. The aggregation + apply must behave correctly at n=0.
- **Decoupled from Piece B:** own apply RPC, idempotent audit columns, separate route file. Only shared touch points: the `(app)/library/` folder (sibling files) and the gated nav link.
- **Out of scope:** per-project re-forecasting; lead-time learning; auto-applying suggestions (always admin-reviewed); editing the working-day calendar.

## Testing

- `lib/learning/durations.ts` unit-tested hard: `durationDays` (same-day = 1, multi-day span, week-long, ignores time-of-day), `summarizeDurations` (odd/even n, single sample), `learnedDurationRows` (n=0 → stats null/suggest null; n=4 → stats shown, suggest null; n≥5 & median≠estimate → suggest; n≥5 & median==estimate → no suggest; instances missing actual_start excluded).
- `apply_learned_duration` validated on the local stack (manager updates; non-manager refused; n<1 rejected; unknown code raises).
- Admin-gated page + apply flow browser-verified (post prod `db push`).
