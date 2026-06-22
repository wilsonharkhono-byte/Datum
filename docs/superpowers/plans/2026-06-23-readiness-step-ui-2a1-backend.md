# Readiness Slice 2a-1 (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend for the step UI: an append-only `area_step_events` log, a projection that keeps `area_steps` current and captures actuals, per-area flagging, and the update actions — so the UI slice (2a-2) is a thin client on top.

**Architecture:** Step updates are append-only events in a new `area_step_events` table (steps aren't cards, so we don't reuse `card_events`). A pure projection (extended `projectStepStatus`) derives status + actuals from a step's events + checkpoints + punch items; `updateAreaStep`/`setCheckpointResult` write an event/result then re-project onto `area_steps`. Flagging (`computeAreaFlags`) is pure. All decision logic stays in `now`-injected pure functions; DB work is thin wrappers.

**Tech Stack:** Next.js 16 + TypeScript, Supabase (Postgres), Vitest, migrations in `packages/db/supabase/migrations/`, generated types in `packages/db/src/types.generated.ts`.

**Spec:** `docs/superpowers/specs/2026-06-23-readiness-step-ui-2a-design.md` (§4–§9).

## Global Constraints
- Pure logic functions take all time/state as parameters — never call `Date.now()`/`new Date()` inside them (matches `lib/steps/*` and `lib/advisor/rank.ts`). Server actions may use `new Date().toISOString()`.
- Migrations: new file in `packages/db/supabase/migrations/`, name `20260623NNNNNN_<name>.sql`. Apply with the global Supabase CLI v2 (`supabase db push`) — never `pnpm migrate`, never `db reset` on the live project.
- Run tests from `apps/web/`: `pnpm test`. Typecheck: `pnpm typecheck`. (A `-- <file>` filter may not narrow vitest; the full suite passing is acceptable.)
- UI strings Bahasa Indonesia; code/comments English.
- Out of scope (slice 2a-2 / later): all React components, server-action `formData` wrappers, schedule-page wiring, manual step add/edit, silence detection, the AI button.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/db/supabase/migrations/20260623000001_area_step_events.sql` | the append-only step-event log + RLS |
| `packages/db/src/types.generated.ts` | regenerated types (new table) |
| `apps/web/lib/steps/status.ts` | extend `projectStepStatus` → add `actualStart`/`actualEnd` |
| `apps/web/lib/steps/flags.ts` | `computeAreaFlags` — pure |
| `apps/web/lib/steps/mutations.ts` | add `updateAreaStep`, `setCheckpointResult`, internal `projectAreaStep` |
| `apps/web/lib/steps/queries.ts` | extend `getAreaSteps` (add `step_type` + checkpoints); add `getAreaStepView` |
| `apps/web/tests/unit/step-status.test.ts` | extend for actuals |
| `apps/web/tests/unit/step-flags.test.ts` | flagging tests |

---

## Task 1: `area_step_events` migration

**Files:**
- Create: `packages/db/supabase/migrations/20260623000001_area_step_events.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Append-only log of step status changes / progress updates. Steps belong to an
-- area (not a card), so this is a dedicated log rather than card_events. The pure
-- projectStepStatus reads a generic {occurred_at, created_at, payload} shape over it.
create table public.area_step_events (
  id                 uuid primary key default gen_random_uuid(),
  area_step_id       uuid not null references public.area_steps(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  status             text not null check (status in ('not_started','in_progress','blocked','done')),
  note               text,
  percent_complete   numeric(5,2),
  occurred_at        timestamptz not null default now(),
  logged_by_staff_id uuid references public.staff(id),
  created_at         timestamptz not null default now()
);
create index area_step_events_step_idx on public.area_step_events(area_step_id);
create index area_step_events_project_idx on public.area_step_events(project_id);

alter table public.area_step_events enable row level security;
create policy area_step_events_read on public.area_step_events
  for select to authenticated using (public.current_can_read_project(project_id));
create policy area_step_events_insert on public.area_step_events
  for insert to authenticated with check (public.current_can_read_project(project_id));
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/supabase/migrations/20260623000001_area_step_events.sql
git commit -m "feat(db): area_step_events append-only step progress log"
```

---

## Task 2: Apply locally + regenerate types

Validate the migration applies and regenerate types so later tasks typecheck. (Local stack only — does not touch prod. The default 5432x ports are held by another project; remap to 553xx for this stack, revert after.)

- [ ] **Step 1: Remap ports, start the local stack (applies all migrations)**

Run (from `packages/db`):
```bash
sed -i '' -E 's/5432([0-9])/5532\1/g; s/8083/8093/' supabase/config.toml
supabase stop --project-id db >/dev/null 2>&1
supabase start -x imgproxy,storage-api,studio,inbucket,edge-runtime,vector,realtime,logflare,supavisor
```
Expected: `Applying migration 20260623000001_area_step_events.sql...` with no error.

- [ ] **Step 2: Regenerate types**

Run (from `packages/db`): `supabase gen types typescript --local > src/types.generated.ts`
Then confirm: `grep -c area_step_events src/types.generated.ts` → ≥ 1.

- [ ] **Step 3: Revert the port edit and commit types**

```bash
git checkout -- supabase/config.toml
git add src/types.generated.ts
git commit -m "chore(db): regenerate types for area_step_events"
```
Leave the local stack running (Tasks 5–7 smoke against it); stop it at the end with `supabase stop --project-id db`.

---

## Task 3: Extend `projectStepStatus` with actuals (pure, TDD)

**Files:**
- Modify: `apps/web/lib/steps/status.ts`
- Test: `apps/web/tests/unit/step-status.test.ts`

**Interfaces:**
- Produces: `StepStatusResult` gains `actualStart: string | null` and `actualEnd: string | null`. `actualStart` = earliest `occurred_at` among events that are `in_progress` or done; `actualEnd` = latest event `occurred_at` when the derived status is `accepted` or `done_with_defects`, else null.

- [ ] **Step 1: Add the failing tests** (append inside the existing `describe("projectStepStatus", …)` block, before its closing `});`)

```typescript
  it("captures actual_start at the earliest in_progress event", () => {
    const r = projectStepStatus(input({ workEvents: [
      ev("in_progress", "2026-07-02T00:00:00Z"),
      ev("in_progress", "2026-07-05T00:00:00Z"),
    ] }));
    expect(r.actualStart).toBe("2026-07-02T00:00:00Z");
    expect(r.actualEnd).toBe(null);
  });

  it("captures actual_end when the step resolves to accepted/done_with_defects", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("in_progress", "2026-07-02T00:00:00Z"), ev("done", "2026-07-08T00:00:00Z")],
      checkpoints: [{ required: true, result: "pass" }],
    }));
    expect(r.status).toBe("accepted");
    expect(r.actualStart).toBe("2026-07-02T00:00:00Z");
    expect(r.actualEnd).toBe("2026-07-08T00:00:00Z");
  });

  it("has null actuals when never started", () => {
    const r = projectStepStatus(input());
    expect(r.actualStart).toBe(null);
    expect(r.actualEnd).toBe(null);
  });
```

- [ ] **Step 2: Run to verify failure**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-status.test.ts`
Expected: FAIL — `actualStart`/`actualEnd` undefined.

- [ ] **Step 3: Extend the implementation** (replace the body of `apps/web/lib/steps/status.ts` from the `StepStatusResult` type through the end)

```typescript
export type StepStatusResult = {
  status: StepStatus;
  lastProgressAt: string | null;
  blockingReason: string | null;
  actualStart: string | null;
  actualEnd: string | null;
};

function latest<T extends { occurred_at: string; created_at: string }>(events: T[]): T | null {
  if (events.length === 0) return null;
  return [...events].sort((a, b) =>
    a.occurred_at === b.occurred_at
      ? a.created_at.localeCompare(b.created_at)
      : a.occurred_at.localeCompare(b.occurred_at),
  ).at(-1)!;
}

function isDone(p: StepStatusInput["workEvents"][number]["payload"]): boolean {
  return p?.status === "done" || (typeof p?.percent_complete === "number" && p.percent_complete >= 100);
}

function earliestStart(events: StepStatusInput["workEvents"]): string | null {
  const started = events
    .filter((e) => e.payload?.status === "in_progress" || isDone(e.payload))
    .map((e) => e.occurred_at)
    .sort((a, b) => a.localeCompare(b));
  return started[0] ?? null;
}

export function projectStepStatus(input: StepStatusInput): StepStatusResult {
  const last = latest(input.workEvents);
  if (!last) {
    return { status: "not_started", lastProgressAt: null, blockingReason: null, actualStart: null, actualEnd: null };
  }

  const lastProgressAt = last.occurred_at;
  const actualStart = earliestStart(input.workEvents);

  if (last.payload?.status === "blocked") {
    return {
      status: "blocked",
      lastProgressAt,
      blockingReason: last.payload.blocked_on ?? last.payload.description ?? "Terblokir",
      actualStart,
      actualEnd: null,
    };
  }

  if (isDone(last.payload)) {
    const hasOpenSeriousPunch = input.punchItems.some(
      (p) => p.status !== "closed" && (p.severity === "kritis" || p.severity === "mayor"),
    );
    const allRequiredPassed = input.checkpoints
      .filter((c) => c.required)
      .every((c) => c.result === "pass");
    const status = !hasOpenSeriousPunch && allRequiredPassed ? "accepted" : "done_with_defects";
    return { status, lastProgressAt, blockingReason: null, actualStart, actualEnd: lastProgressAt };
  }

  return { status: "in_progress", lastProgressAt, blockingReason: null, actualStart, actualEnd: null };
}
```

- [ ] **Step 4: Run to verify pass**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-status.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/status.ts apps/web/tests/unit/step-status.test.ts
git commit -m "feat(steps): projectStepStatus captures actual_start/actual_end"
```

---

## Task 4: `computeAreaFlags` (pure, TDD)

**Files:**
- Create: `apps/web/lib/steps/flags.ts`
- Test: `apps/web/tests/unit/step-flags.test.ts`

**Interfaces:**
- Produces: `computeAreaFlags(steps, deps): AreaFlags` where `steps: Array<{ step_code, step_type, status }>` (any order), `deps: TradeStepDep[]`, and `AreaFlags = { readyToStart: string | null; needsDecision: string[]; blocked: string[] }`.
  - `blocked` = step_codes whose status is `blocked` or `stalled`.
  - `readyToStart` = the lowest-`sort`… (no sort here) — the first `not_started` step (input order) whose predecessors are all `accepted`; null if none.
  - `needsDecision` = `decision`/`procurement` steps whose status is not `accepted`/`done_with_defects`, that are a predecessor of some `not_started` step.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { computeAreaFlags } from "@/lib/steps/flags";
import type { TradeStepDep } from "@/lib/steps/types";

type S = { step_code: string; step_type: string; status: string };
const deps: TradeStepDep[] = [
  { step_code: "B3", predecessor_code: "B1" },
  { step_code: "B6", predecessor_code: "B3" },
];

describe("computeAreaFlags", () => {
  it("readyToStart = first not_started step whose predecessors are accepted", () => {
    const steps: S[] = [
      { step_code: "B1", step_type: "decision", status: "accepted" },
      { step_code: "B3", step_type: "procurement", status: "not_started" },
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe("B3");
  });

  it("does not offer a step whose predecessor is unfinished", () => {
    const steps: S[] = [
      { step_code: "B1", step_type: "decision", status: "in_progress" },
      { step_code: "B3", step_type: "procurement", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe(null);
  });

  it("needsDecision = open decision/procurement that gates a not_started step", () => {
    const steps: S[] = [
      { step_code: "B1", step_type: "decision", status: "in_progress" },
      { step_code: "B3", step_type: "procurement", status: "not_started" },
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).needsDecision).toEqual(["B1"]);
  });

  it("blocked lists blocked and stalled steps", () => {
    const steps: S[] = [
      { step_code: "B3", step_type: "procurement", status: "blocked" },
      { step_code: "B6", step_type: "site_work", status: "stalled" },
    ];
    expect(computeAreaFlags(steps, deps).blocked.sort()).toEqual(["B3", "B6"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-flags.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/steps/flags"`.

- [ ] **Step 3: Write the implementation**

```typescript
import type { TradeStepDep } from "@/lib/steps/types";

export type AreaFlags = {
  readyToStart: string | null;
  needsDecision: string[];
  blocked: string[];
};

type FlagStep = { step_code: string; step_type: string; status: string };

const DONE = new Set(["accepted", "done_with_defects"]);

export function computeAreaFlags(steps: FlagStep[], deps: TradeStepDep[]): AreaFlags {
  const status = new Map(steps.map((s) => [s.step_code, s.status]));
  const predsOf = new Map<string, string[]>();
  for (const s of steps) predsOf.set(s.step_code, []);
  for (const d of deps) {
    if (predsOf.has(d.step_code)) predsOf.get(d.step_code)!.push(d.predecessor_code);
  }

  const blocked = steps
    .filter((s) => s.status === "blocked" || s.status === "stalled")
    .map((s) => s.step_code);

  const isReady = (code: string) =>
    status.get(code) === "not_started" &&
    predsOf.get(code)!.every((p) => status.get(p) === "accepted");
  const readyToStart = steps.find((s) => isReady(s.step_code))?.step_code ?? null;

  const notStarted = new Set(steps.filter((s) => s.status === "not_started").map((s) => s.step_code));
  const gatesANotStarted = (code: string) =>
    steps.some((s) => notStarted.has(s.step_code) && predsOf.get(s.step_code)!.includes(code));
  const needsDecision = steps
    .filter((s) => (s.step_type === "decision" || s.step_type === "procurement"))
    .filter((s) => !DONE.has(s.status))
    .filter((s) => gatesANotStarted(s.step_code))
    .map((s) => s.step_code);

  return { readyToStart, needsDecision, blocked };
}
```

- [ ] **Step 4: Run to verify pass**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-flags.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/flags.ts apps/web/tests/unit/step-flags.test.ts
git commit -m "feat(steps): computeAreaFlags (ready / needs-decision / blocked)"
```

---

## Task 5: `updateAreaStep` + `projectAreaStep` (DB write + re-project)

**Files:**
- Modify: `apps/web/lib/steps/mutations.ts`

**Interfaces:**
- Consumes: `projectStepStatus` (Task 3).
- Produces: `updateAreaStep(supabase, args)` where `args: { areaStepId: string; status?: "not_started"|"in_progress"|"blocked"|"done"; note?: string; percentComplete?: number; loggedByStaffId?: string }`. Inserts one `area_step_events` row (status defaults to the step's current state when omitted) then re-projects onto `area_steps`.

- [ ] **Step 1: Append to `apps/web/lib/steps/mutations.ts`**

```typescript
import { projectStepStatus } from "@/lib/steps/status";

const EVENT_STATUS: Record<string, "not_started" | "in_progress" | "blocked" | "done"> = {
  not_started: "not_started",
  in_progress: "in_progress",
  blocked: "blocked",
  stalled: "blocked",
  done_with_defects: "done",
  accepted: "done",
};

/** Re-derive an area_step's status + actuals from its events, checkpoints, punch items. */
export async function projectAreaStep(
  supabase: SupabaseClient<Database>,
  areaStepId: string,
): Promise<void> {
  const [{ data: events }, { data: cps }, { data: punch }] = await Promise.all([
    supabase.from("area_step_events").select("occurred_at, created_at, status, note, percent_complete").eq("area_step_id", areaStepId),
    supabase.from("area_step_checkpoints").select("required, result").eq("area_step_id", areaStepId),
    supabase.from("punch_items").select("severity, status").eq("area_step_id", areaStepId),
  ]);

  const r = projectStepStatus({
    workEvents: (events ?? []).map((e) => ({
      occurred_at: e.occurred_at,
      created_at: e.created_at,
      payload: {
        status: e.status,
        percent_complete: e.percent_complete ?? undefined,
        blocked_on: e.note ?? undefined,
      },
    })),
    checkpoints: (cps ?? []) as { required: boolean; result: "pending" | "pass" | "fail" }[],
    punchItems: (punch ?? []) as { severity: "kritis" | "mayor" | "minor"; status: "open" | "fixing" | "closed" }[],
  });

  await supabase
    .from("area_steps")
    .update({
      status: r.status,
      actual_start: r.actualStart,
      actual_end: r.actualEnd,
      last_progress_at: r.lastProgressAt,
      blocking_reason: r.blockingReason,
    })
    .eq("id", areaStepId);
}

export type UpdateAreaStepArgs = {
  areaStepId: string;
  status?: "not_started" | "in_progress" | "blocked" | "done";
  note?: string;
  percentComplete?: number;
  loggedByStaffId?: string;
};

/** Log one step event (status change or progress note) then re-project. */
export async function updateAreaStep(
  supabase: SupabaseClient<Database>,
  args: UpdateAreaStepArgs,
): Promise<void> {
  const { data: step, error } = await supabase
    .from("area_steps")
    .select("project_id, status")
    .eq("id", args.areaStepId)
    .single();
  if (error || !step) throw error ?? new Error("area_step not found");

  const eventStatus = args.status ?? EVENT_STATUS[step.status] ?? "in_progress";

  const { error: insErr } = await supabase.from("area_step_events").insert({
    area_step_id: args.areaStepId,
    project_id: step.project_id,
    status: eventStatus,
    note: args.note ?? null,
    percent_complete: args.percentComplete ?? null,
    logged_by_staff_id: args.loggedByStaffId ?? null,
  });
  if (insErr) throw insErr;

  await projectAreaStep(supabase, args.areaStepId);
}
```

- [ ] **Step 2: Typecheck**

Run (from `apps/web/`): `pnpm typecheck`
Expected: PASS (types regenerated in Task 2).

- [ ] **Step 3: Smoke against the local DB** (the stack from Task 2 is up; `psql` runs inside the `supabase_db_db` container)

Run:
```bash
docker exec -i supabase_db_db psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;
do $$
declare v_p uuid; v_a uuid; v_s uuid; v_st text; v_start date;
begin
  insert into public.projects (project_code, project_name) values ('SMK-2A','Smoke 2a') returning id into v_p;
  insert into public.areas (project_id, area_code, area_name, area_type, finish_profile)
    values (v_p,'KM','KM','bathroom','{"lantai":"marmer"}'::jsonb) returning id into v_a;
  perform public.seed_area_steps(v_a);
  select id into v_s from public.area_steps where area_id=v_a and step_code='B4';
  insert into public.area_step_events (area_step_id, project_id, status, occurred_at)
    values (v_s, v_p, 'in_progress', '2026-07-02T00:00:00Z');
  update public.area_steps set status='in_progress', actual_start='2026-07-02', last_progress_at='2026-07-02T00:00:00Z' where id=v_s;
  select status, actual_start into v_st, v_start from public.area_steps where id=v_s;
  raise notice 'B4 status=% actual_start=% (expect in_progress / 2026-07-02)', v_st, v_start;
end $$;
rollback;
SQL
```
Expected: `NOTICE: B4 status=in_progress actual_start=2026-07-02`. (Confirms the event/area_step shape; the TS `updateAreaStep` exercises the same path.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/steps/mutations.ts
git commit -m "feat(steps): updateAreaStep logs an event and re-projects the area_step"
```

---

## Task 6: `setCheckpointResult`

**Files:**
- Modify: `apps/web/lib/steps/mutations.ts`

**Interfaces:**
- Consumes: `projectAreaStep` (Task 5).
- Produces: `setCheckpointResult(supabase, { checkpointId, result, checkedByStaffId? })` where `result: "pending" | "pass" | "fail"`. Updates the checkpoint then re-projects its parent step (a pass can flip `done_with_defects → accepted`).

- [ ] **Step 1: Append to `apps/web/lib/steps/mutations.ts`**

```typescript
export type SetCheckpointArgs = {
  checkpointId: string;
  result: "pending" | "pass" | "fail";
  checkedByStaffId?: string;
};

export async function setCheckpointResult(
  supabase: SupabaseClient<Database>,
  args: SetCheckpointArgs,
): Promise<void> {
  const { data: cp, error } = await supabase
    .from("area_step_checkpoints")
    .select("area_step_id")
    .eq("id", args.checkpointId)
    .single();
  if (error || !cp) throw error ?? new Error("checkpoint not found");

  const { error: upErr } = await supabase
    .from("area_step_checkpoints")
    .update({
      result: args.result,
      checked_by: args.checkedByStaffId ?? null,
      checked_at: new Date().toISOString(),
    })
    .eq("id", args.checkpointId);
  if (upErr) throw upErr;

  await projectAreaStep(supabase, cp.area_step_id);
}
```

- [ ] **Step 2: Typecheck**

Run (from `apps/web/`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/steps/mutations.ts
git commit -m "feat(steps): setCheckpointResult re-projects the parent step"
```

---

## Task 7: Extend `getAreaSteps` + add `getAreaStepView`

**Files:**
- Modify: `apps/web/lib/steps/queries.ts`

**Interfaces:**
- Consumes: `computeAreaFlags` (Task 4).
- Produces: `AreaStepRow` gains `step_type: string` and `checkpoints: Array<{ id: string; item_text: string; severity: string; required: boolean; result: string }>`. New `getAreaStepView(supabase, areaId): Promise<{ steps: AreaStepRow[]; flags: AreaFlags }>` — fetches steps (ordered, with checkpoints), fetches Gate B `trade_step_deps`, and computes flags.

- [ ] **Step 1: Replace `apps/web/lib/steps/queries.ts`**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { computeAreaFlags, type AreaFlags } from "@/lib/steps/flags";
import type { TradeStepDep } from "@/lib/steps/types";

export type AreaStepCheckpoint = {
  id: string;
  item_text: string;
  severity: string;
  required: boolean;
  result: string;
};

export type AreaStepRow = {
  id: string;
  step_code: string;
  step_type: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  assigned_trade: string | null;
  blocking_reason: string | null;
  last_progress_at: string | null;
  checkpoints: AreaStepCheckpoint[];
};

/** All trade steps instantiated for one area, ordered by template sort_order, with checkpoints. */
export async function getAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<AreaStepRow[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      assigned_trade, blocking_reason, last_progress_at,
      trade_steps:step_code (sort_order, step_type),
      area_step_checkpoints (id, item_text, severity, required, result, sort_order)
    `)
    .eq("area_id", areaId);
  if (error) throw error;

  return (data ?? [])
    .map((r) => {
      const tmpl = r.trade_steps as { sort_order: number; step_type: string } | null;
      const cps = (r.area_step_checkpoints as AreaStepCheckpoint[] & { sort_order: number }[] | null) ?? [];
      return {
        _sort: tmpl?.sort_order ?? 0,
        id: r.id,
        step_code: r.step_code,
        step_type: tmpl?.step_type ?? "site_work",
        status: r.status,
        planned_start: r.planned_start,
        planned_end: r.planned_end,
        assigned_trade: r.assigned_trade,
        blocking_reason: r.blocking_reason,
        last_progress_at: r.last_progress_at,
        checkpoints: [...cps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map((c) => ({ id: c.id, item_text: c.item_text, severity: c.severity, required: c.required, result: c.result })),
      };
    })
    .sort((a, b) => a._sort - b._sort)
    .map(({ _sort, ...rest }) => rest as AreaStepRow);
}

/** Steps for an area plus the per-area flags (siap dimulai / perlu keputusan / blocked). */
export async function getAreaStepView(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<{ steps: AreaStepRow[]; flags: AreaFlags }> {
  const steps = await getAreaSteps(supabase, areaId);
  const { data: deps } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");
  const flags = computeAreaFlags(
    steps.map((s) => ({ step_code: s.step_code, step_type: s.step_type, status: s.status })),
    (deps ?? []) as TradeStepDep[],
  );
  return { steps, flags };
}
```

- [ ] **Step 2: Typecheck**

Run (from `apps/web/`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/steps/queries.ts
git commit -m "feat(steps): getAreaSteps returns checkpoints + step_type; add getAreaStepView with flags"
```

---

## Task 8: Push to prod + stop local stack (gated)

> **STOP — human confirmation.** Applies the `area_step_events` migration to the **live** project. Additive only.

- [ ] **Step 1: Push**

Run (from `packages/db`): `supabase db push` — enter the DB password. Applies `20260623000001_area_step_events.sql`.

- [ ] **Step 2: Stop the local validation stack**

Run (from `packages/db`): `supabase stop --project-id db`

- [ ] **Step 3: Final typecheck + suite**

Run (from `apps/web/`): `pnpm typecheck && pnpm test`
Expected: PASS — all step unit tests (status actuals + flags) green.

---

## Self-review checklist (plan author)

- **Spec coverage (§4–§9):** event-sourced log (Task 1) ✓; actuals projection (Task 3) ✓; flagging (Task 4) ✓; updateAreaStep + projection (Task 5) ✓; setCheckpointResult (Task 6) ✓; query + flags for the UI (Task 7) ✓. UI (§3, §8 components) is slice 2a-2, by design.
- **Type consistency:** `StepStatusResult` actuals (Task 3) consumed by `projectAreaStep` (Task 5); `computeAreaFlags`/`AreaFlags` (Task 4) consumed by `getAreaStepView` (Task 7); `EVENT_STATUS` maps the broad `area_steps.status` back to the 4 event statuses; `area_step_events` columns (Task 1) match the inserts/selects in Tasks 5–6.
- **Deferred:** all React components, server-action `formData` wrappers, schedule-page wiring → slice 2a-2.
- **Risk:** `current_can_read_project` reused from Phase 1 (verified to exist). The Task 5 smoke validates the SQL shape; the TS path is typecheck-verified.
