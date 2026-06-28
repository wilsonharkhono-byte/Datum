# Cross-Project Slip-Risk Overview — Design

**Date:** 2026-06-28
**Status:** Design (autonomous build); spec → plan → implementation.
**Module:** Readiness system. The headline proactive view — "which projects are slipping, and why."

## Goal (vs the readiness end-goal)

The whole system exists so **finishing work doesn't slip and projects get equal attention**. Every prior piece feeds signals; this is the surface that *uses* them at the project level: a single ranked view of every project's slip risk + its bottleneck, so a principal/PM sees at a glance where to intervene — proactively, across all projects, not one schedule page at a time.

## Context — what exists (reuse, don't rebuild)

- `lib/steps/signals.ts` `computeStepSignals` emits typed `StepSignal { kind, severity, message }` per step — incl. `behind_plan` (computes days-late vs `planned_end`, in the message), `blocked`, `lead_time_risk`, `silent`, `stale_decision`.
- `lib/steps/queries.ts` `getProjectStepSignals(supabase, projectId, today, now)` → `ProjectStepSignalRow[] { areaId, areaName, stepCode, stepName, tradeRole, signal }`, severity-sorted (the schedule page's `SignalSummaryPanel` + the reminder cron use it).
- `lib/steps/reminders.ts` already enumerates active projects for the cron.
- RLS scopes `getProjectStepSignals` to project members; cross-project roles (`current_has_cross_project_read` = principal/admin/estimator) see all.

## Decision

A **rollup over existing signals** — no new scheduler. Per project, summarize its step-signals into a risk verdict + bottleneck; rank all the user's visible active projects. A dedicated `/risiko` page (RLS-scoped, so each user sees their own projects; cross-project roles see all).

## §1 · Pure rollup (`lib/steps/slip-risk.ts`)

```
type RiskLevel = "behind" | "at_risk" | "on_track";
type ProjectRisk = {
  level: RiskLevel;
  behindCount: number;     // # behind_plan signals
  blockedCount: number;    // # blocked
  atRiskCount: number;     // # lead_time_risk + silent + stale_decision
  bottleneck: { areaName: string; stepName: string; message: string; severity: string } | null;
};
summarizeProjectRisk(signals: ProjectStepSignalRow[]): ProjectRisk
```
- `level`: **behind** if any `behind_plan` or `blocked`; **at_risk** if any `lead_time_risk`/`silent`/`stale_decision` (and not behind); **on_track** if no signals.
- counts as above.
- `bottleneck`: the first signal in the (already severity-sorted) list — i.e. the worst one — surfaced with its area/step/message (the message already conveys "N hari melewati tenggat" for behind_plan). Null when on_track.
Pure + unit-tested (no DB).

## §2 · Query (`lib/steps/slip-risk-queries.ts`)

`getProjectsSlipRisk(supabase, today, now)`:
- Fetch the user's visible active projects: `projects.select("id, project_code, project_name").neq("status", "closed")` (RLS scopes to what they can read).
- For each, `getProjectStepSignals(supabase, id, today, now)` → `summarizeProjectRisk` → `{ project, risk, signalCount }`.
- Return sorted: `behind` → `at_risk` → `on_track`, then by `behindCount`+`blockedCount` desc (most-broken first). One `getProjectStepSignals` per project (same shape the cron already runs daily).
- `today` (Asia/Jakarta YYYY-MM-DD) + `now` (ISO) computed by the caller (page), kept out of the pure layer.

## §3 · Page + nav

`apps/web/app/(app)/risiko/page.tsx` — server component (any authed staff; RLS limits the list). Computes `today`/`now` (the same Asia/Jakarta pattern the schedule page uses), calls `getProjectsSlipRisk`, renders a ranked list: each project row = a level chip (Terlambat / Berisiko / Aman), the counts, the bottleneck (area · step · message), linking to `/project/{code}/schedule`. Empty state when no active projects. `max-w-3xl`, CSS-var Tailwind, Bahasa.
A nav link "Risiko" in the app layout header (shown to all staff — it self-scopes via RLS).

## §4 · Scope & boundaries

- **Rollup only** — reuses `getProjectStepSignals`/`computeStepSignals`; no forward-scheduler, no schema change.
- **Coarse, not a day-count forecast:** the level + bottleneck answer "which projects need attention and why." A precise "projected to slip by N days" (a forward-scheduling pass) is a deeper follow-up — noted, out of scope here.
- **RLS-scoped** — the page shows whatever projects the viewer can read; no extra gate. N `getProjectStepSignals` calls per page load (active-project count is small; matches the cron's existing cost).
- **Verification gap:** page UI — browser-verify on prod; the pure rollup is unit-tested.

## Testing

- `summarizeProjectRisk` unit-tested: behind_plan/blocked → `behind`; lead_time_risk/silent only → `at_risk`; empty → `on_track`; bottleneck = first (worst) signal; counts correct; null bottleneck when on_track.
- Page browser-verified (ranked projects, level chips, bottleneck, links).
