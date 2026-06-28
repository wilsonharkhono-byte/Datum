# Project Step Activity Feed — Design

**Date:** 2026-06-27
**Status:** Design (autonomous build); spec → plan → implementation.
**Module:** Readiness system, feature 4. Surfaces the otherwise write-only step progress log.

## Goal

Give each project a chronological **activity feed of its readiness step events** (`area_step_events` — status changes + progress notes), so a PM/principal can see who logged what, when, across all the project's steps — without opening each step. Today these events are written (via "Tambah update progres" / status buttons) but only read back internally (status projection); the progress notes are effectively invisible.

## Context — what exists

- `area_step_events` rows carry `status`, `note`, `percent_complete`, `occurred_at`, `project_id`, `area_step_id`, `logged_by_staff_id` (written by `updateAreaStep`).
- `getAreaStepEvents(supabase, stepIds)` reads events for specific step ids (per-step history). **No project-level feed exists.**
- The top-level `(app)/activity` page is **card-centric** (`getRecentActivity` in `@datum/core` — new cards, comments) and does NOT include step events.
- `area_steps.step_code → trade_steps.name` gives the step name; `area_steps.area_id → areas.area_name` gives the room; `staff.full_name` gives the author.

## Decision

A **project-scoped** feed at `/project/[slug]/activity`, apps/web only — no change to the shared `@datum/core` activity feed (avoids the cross-package/mobile ripple). Surfaces `area_step_events` filtered by `project_id`, newest first, grouped by day.

## §1 · Query (apps/web)

`apps/web/lib/activity/step-activity.ts`:
```
type StepActivityItem = {
  id: string; occurredAt: string; areaName: string; stepName: string;
  status: string; note: string | null; percentComplete: number | null; authorName: string | null;
};
getProjectStepActivity(supabase, projectId: string, limit = 50): Promise<StepActivityItem[]>
```
One query: `area_step_events.select("id, status, note, percent_complete, occurred_at, created_at, area_step_id, area_steps:area_step_id ( step_code, areas:area_id ( area_name ), trade_steps:step_code ( name ) ), staff:logged_by_staff_id ( full_name )").eq("project_id", projectId).order("occurred_at", { ascending: false }).limit(limit)`. Map each row to `StepActivityItem` (occurredAt = `occurred_at ?? created_at`; areaName/stepName from the joins with `step_code` fallback; authorName from staff). Plus a pure `groupByDay(items): { day: string; items: StepActivityItem[] }[]` (Asia/Jakarta date string, preserve newest-first order) — unit-tested.

## §2 · Page

`apps/web/app/(app)/project/[slug]/activity/page.tsx` — server component: resolve project by `slug` (uppercase `project_code`), `getProjectStepActivity(project.id)`, group by day, render. Header "Aktivitas Langkah", a back link to the project board, empty state ("Belum ada aktivitas langkah"). Each item row: a status chip (reuse the status→label/colour vocabulary from `StepDetail`'s event chips), `{areaName} · {stepName}`, the note (if any), `{percentComplete}%` (if any), relative/short time, author. CSS-var Tailwind, Bahasa, `max-w-3xl` like the top-level activity page.

A link to `/project/{code}/activity` from the project board/nav (match how the schedule/rooms links are placed).

## §3 · Scope & boundaries

- **Read-only**, project-scoped, apps/web only. No `@datum/core` change, no mobile change, no DB change (RLS on `area_step_events` already scopes reads to project members).
- **Out of scope:** merging step events into the global `(app)/activity` feed (a future cross-package enhancement, flagged); filtering by area/author; pagination beyond the 50-row cap (note the cap in the UI); realtime (`area_step_events` isn't in `supabase_realtime`).
- **Verification gap:** UI page — browser-verify on prod (the user), though the query + grouper are unit-tested.

## Testing

- `groupByDay` unit-tested (multiple days, same-day grouping, order preserved, empty).
- `getProjectStepActivity` mapping verified via a typed shape (the join → `StepActivityItem` mapping is the main logic; test the row-map as a pure helper `mapStepActivityRow` if it eases testing).
- Page is typecheck + build gated; browser-verify is the user's.
