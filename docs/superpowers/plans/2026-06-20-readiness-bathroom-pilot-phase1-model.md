# Readiness Pilot — Phase 1 (Gate B Model) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data-driven trade-step model for Gate B (kamar mandi) — template tables, per-bathroom instantiation specialized by finish, deterministic back-scheduling, and step-status projection — so later phases can remind, escalate, and schedule on top of it.

**Architecture:** Two-layer model mirroring the existing `gates`/`gate_checkpoint_templates` (template) and `area_gate_status` (instance) patterns. All decision logic lives in **pure, `now`-injected functions** under `apps/web/lib/steps/` (mirroring `lib/gates/readiness-rules.ts` and `lib/advisor/rank.ts`), unit-tested with Vitest and no Supabase. DB schema, Gate B seed, and instantiation are SQL migrations; wiring reads/writes through thin query/mutation modules.

**Tech Stack:** Next.js 16 + TypeScript, Supabase (Postgres) via `@supabase/supabase-js`, Vitest unit tests, migrations in `packages/db/supabase/migrations/`, types in `packages/db/src/types.generated.ts`.

**Spec:** `docs/superpowers/specs/2026-06-20-readiness-bathroom-pilot-design.md` (§4, §5, §10).

**Scope of this plan (Phase 1 only):** schema + Gate B template seed + `areas.finish_profile` + pure applicability/back-schedule/status functions + `seed_area_steps` + instantiation/query wiring. **Out of scope (own later plans):** Phase 2 silence detection & escalation & punch-item gating UI; Phase 3 advisor signals, personalization, digest. The `punch_items` table is *created* here (so the schema is whole) but its gating logic is exercised in Phase 2.

---

## Conventions (read once)

- **Run unit tests:** from `apps/web/` → `pnpm test -- <file>` (alias for `vitest run`). Watch with `pnpm test:watch`.
- **Typecheck:** from `apps/web/` → `pnpm typecheck`.
- **Migrations:** new file in `packages/db/supabase/migrations/` named `20260620NNNNNN_<name>.sql`. Apply with the **global Supabase CLI v2** (`supabase db push`) — the workspace `pnpm migrate` fails on PG17 config (known gotcha). The Supabase project is **LIVE**: `db push` only, **never** `db reset`.
- **Pure-function tasks are full TDD** (failing test → run → implement → run → commit). Migration/seed tasks are: write exact SQL → `pnpm typecheck` → commit; DB application is the gated Task 12.
- All new code lives under `apps/web/lib/steps/`. UI strings are Bahasa Indonesia; code/comments English (match the codebase).

## File structure (created/modified)

| File | Responsibility |
| --- | --- |
| `packages/db/supabase/migrations/20260620000001_trade_steps_schema.sql` | Template + instance tables, `areas.finish_profile`, indexes, RLS |
| `packages/db/supabase/migrations/20260620000002_seed_gate_b_trade_steps.sql` | Gate B template content (B1–B9, deps, checkpoints) |
| `packages/db/supabase/migrations/20260620000003_seed_area_steps_fn.sql` | `seed_area_steps(area_id)` SQL function |
| `packages/db/src/types.generated.ts` | Regenerated DB types (new tables) |
| `apps/web/lib/steps/types.ts` | Hand-written domain types (StepType, StepStatus, FinishProfile, TradeStepTemplate, AreaStep) |
| `apps/web/lib/steps/applicability.ts` | `applies(applicability, profile)` — pure |
| `apps/web/lib/steps/back-schedule.ts` | `backScheduleSteps(steps, deps, gateWindow)` + `addDays` — pure |
| `apps/web/lib/steps/status.ts` | `projectStepStatus(input)` — pure |
| `apps/web/lib/steps/queries.ts` | `getAreaSteps(supabase, areaId)` — DB read |
| `apps/web/lib/steps/mutations.ts` | `instantiateAreaSteps`, `writePlannedDates` — DB write |
| `apps/web/tests/unit/step-applicability.test.ts` | applicability tests |
| `apps/web/tests/unit/step-back-schedule.test.ts` | back-schedule tests |
| `apps/web/tests/unit/step-status.test.ts` | status projection tests |

---

## Task 1: Schema migration (template + instance tables)

**Files:**
- Create: `packages/db/supabase/migrations/20260620000001_trade_steps_schema.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Readiness Pilot Phase 1 — trade-step model schema (template + instance).
-- Mirrors gates/gate_checkpoint_templates (template) and area_gate_status (instance).

-- 0. Finish profile on areas (drives step applicability alongside area_type).
alter table public.areas
  add column if not exists finish_profile jsonb not null default '{}'::jsonb;

------------------------------------------------------------------------
-- Template layer (firm standard; seeded by migration, global config)
------------------------------------------------------------------------
create table public.trade_steps (
  code                  text primary key,
  gate_code             text not null references public.gates(code),
  name                  text not null,
  step_type             text not null check (step_type in ('decision','procurement','site_work','inspection')),
  trade_role            text,
  typical_duration_days numeric(6,2) not null default 1,
  lead_time_days        numeric(6,2) not null default 0,
  sort_order            integer not null default 0,
  applicability         jsonb not null default '{}'::jsonb,
  active                boolean not null default true
);

create table public.trade_step_deps (
  step_code        text not null references public.trade_steps(code) on delete cascade,
  predecessor_code text not null references public.trade_steps(code) on delete cascade,
  primary key (step_code, predecessor_code)
);

create table public.trade_step_checkpoints (
  id               uuid primary key default gen_random_uuid(),
  step_code        text not null references public.trade_steps(code) on delete cascade,
  item_text        text not null,
  default_severity text not null check (default_severity in ('kritis','mayor','minor')),
  required         boolean not null default true,
  sort_order       integer not null default 0
);

------------------------------------------------------------------------
-- Instance layer (one real bathroom)
------------------------------------------------------------------------
create table public.area_steps (
  id              uuid primary key default gen_random_uuid(),
  area_id         uuid not null references public.areas(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  step_code       text not null references public.trade_steps(code),
  status          text not null default 'not_started'
                    check (status in ('not_started','in_progress','blocked','stalled','done_with_defects','accepted','not_applicable')),
  planned_start   date,
  planned_end     date,
  actual_start    date,
  actual_end      date,
  assigned_trade  text,
  blocking_reason text,
  last_progress_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (area_id, step_code)
);
create index area_steps_area_idx on public.area_steps(area_id);
create index area_steps_project_idx on public.area_steps(project_id);
create trigger trg_area_steps_updated_at
  before update on public.area_steps
  for each row execute function public.set_updated_at();

create table public.area_step_checkpoints (
  id            uuid primary key default gen_random_uuid(),
  area_step_id  uuid not null references public.area_steps(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  item_text     text not null,
  severity      text not null check (severity in ('kritis','mayor','minor')),
  required      boolean not null default true,
  result        text not null default 'pending' check (result in ('pending','pass','fail')),
  checked_by    uuid references public.staff(id),
  checked_at    timestamptz,
  sort_order    integer not null default 0
);
create index area_step_checkpoints_step_idx on public.area_step_checkpoints(area_step_id);

create table public.punch_items (
  id                 uuid primary key default gen_random_uuid(),
  area_step_id       uuid not null references public.area_steps(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  description        text not null,
  severity           text not null check (severity in ('kritis','mayor','minor')),
  caused_by_trade    text,
  fix_owner_trade    text,
  status             text not null default 'open' check (status in ('open','fixing','closed')),
  sano_work_item_ref text,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz
);
create index punch_items_step_idx on public.punch_items(area_step_id);

------------------------------------------------------------------------
-- RLS — template tables readable by all authenticated; instance tables
-- gated by project membership (mirror area_gate_status policies).
------------------------------------------------------------------------
alter table public.trade_steps enable row level security;
alter table public.trade_step_deps enable row level security;
alter table public.trade_step_checkpoints enable row level security;
alter table public.area_steps enable row level security;
alter table public.area_step_checkpoints enable row level security;
alter table public.punch_items enable row level security;

create policy trade_steps_read on public.trade_steps
  for select to authenticated using (true);
create policy trade_step_deps_read on public.trade_step_deps
  for select to authenticated using (true);
create policy trade_step_checkpoints_read on public.trade_step_checkpoints
  for select to authenticated using (true);

create policy area_steps_read on public.area_steps
  for select to authenticated using (public.current_can_read_project(project_id));
create policy area_steps_write on public.area_steps
  for all to authenticated
  using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));

create policy area_step_checkpoints_rw on public.area_step_checkpoints
  for all to authenticated
  using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));

create policy punch_items_rw on public.punch_items
  for all to authenticated
  using (public.current_can_read_project(project_id))
  with check (public.current_can_read_project(project_id));
```

- [ ] **Step 2: Sanity-check references exist**

Run: `grep -rn "current_can_read_project\|function public.set_updated_at" packages/db/supabase/migrations | head`
Expected: both helpers are defined in earlier migrations (used by `areas`/`area_gate_status`). If `current_can_read_project` is named differently, substitute the actual name found.

- [ ] **Step 3: Commit**

```bash
git add packages/db/supabase/migrations/20260620000001_trade_steps_schema.sql
git commit -m "feat(db): trade-step model schema (template + instance tables, RLS)"
```

---

## Task 2: Seed the Gate B template

**Files:**
- Create: `packages/db/supabase/migrations/20260620000002_seed_gate_b_trade_steps.sql`

- [ ] **Step 1: Write the seed SQL** (content from spec §10)

```sql
-- Gate B (Kamar Mandi) trade-step template — v1. Refine item_text with Wilson.

insert into public.trade_steps (code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability) values
  ('B1','B','Pilih material dinding/lantai + shop drawing','decision','desainer',1,7,1,'{}'::jsonb),
  ('B2','B','Pilih sanitair & fixtures','decision','desainer',1,7,2,'{}'::jsonb),
  ('B3','B','Order marmer/batu','procurement','purchasing',1,21,3,'{"lantai":["marmer","batu"]}'::jsonb),
  ('B4','B','Waterproofing','site_work','aplikator_waterproofing',3,0,4,'{}'::jsonb),
  ('B5','B','Screeding + slope','site_work','tukang',2,0,5,'{}'::jsonb),
  ('B6','B','Pasang dinding marmer/batu','site_work','tukang_marmer',5,0,6,'{}'::jsonb),
  ('B7','B','Pasang lantai marmer/batu','site_work','tukang_marmer',3,0,7,'{}'::jsonb),
  ('B8','B','Grouting','site_work','tukang',1,0,8,'{}'::jsonb),
  ('B9','B','Verifikasi titik sanitair','inspection','site_manager',1,0,9,'{}'::jsonb);

insert into public.trade_step_deps (step_code, predecessor_code) values
  ('B3','B1'),
  ('B5','B4'),
  ('B6','B3'), ('B6','B4'),
  ('B7','B5'), ('B7','B3'),
  ('B8','B6'), ('B8','B7'),
  ('B9','B2');

insert into public.trade_step_checkpoints (step_code, item_text, default_severity, required, sort_order) values
  ('B1','Klien sign-off shop drawing dinding/lantai','mayor',true,1),
  ('B2','Spesifikasi sanitair & fixtures terkunci','mayor',true,1),
  ('B3','PO disetujui, tanggal kirim dikonfirmasi','mayor',true,1),
  ('B4','Flood test 24-48 jam: tidak ada rembesan','kritis',true,1),
  ('B5','Kemiringan lantai ke floor drain minimum 1%','mayor',true,1),
  ('B6','Lippage maksimal 1mm untuk marmer','mayor',true,1),
  ('B6','Pola sesuai shop drawing yang disetujui','mayor',true,2),
  ('B7','Slope terjaga; lippage maksimal 1mm','mayor',true,1),
  ('B8','Grouting rapi dan merata, tidak ada void','minor',true,1),
  ('B9','Outlet air dan drain presisi ke posisi sanitair terpilih','mayor',true,1);
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/supabase/migrations/20260620000002_seed_gate_b_trade_steps.sql
git commit -m "feat(db): seed Gate B trade-step template (B1-B9, deps, checkpoints)"
```

---

## Task 3: Domain types

**Files:**
- Create: `apps/web/lib/steps/types.ts`

- [ ] **Step 1: Write the types**

```typescript
/**
 * Trade-step model — hand-written domain types. These intentionally do not
 * depend on the generated DB types so the pure functions below are testable
 * before the migration is applied.
 */

export type StepType = "decision" | "procurement" | "site_work" | "inspection";

export type StepStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "stalled"
  | "done_with_defects"
  | "accepted"
  | "not_applicable";

export type PunchSeverity = "kritis" | "mayor" | "minor";

/** Area profile that applicability is matched against. */
export type FinishProfile = {
  area_type: string; // 'bathroom', etc.
  [finishKey: string]: string | undefined; // lantai, dinding, kusen, plafon...
};

/** One template step (a row of trade_steps). */
export type TradeStepTemplate = {
  code: string;
  gate_code: string;
  name: string;
  step_type: StepType;
  trade_role: string | null;
  typical_duration_days: number;
  lead_time_days: number;
  sort_order: number;
  /** e.g. { lantai: ["marmer","batu"] }; empty object = always applies. */
  applicability: Record<string, string[]>;
};

export type TradeStepDep = { step_code: string; predecessor_code: string };

/** Inclusive date window, YYYY-MM-DD. */
export type DateWindow = { start: string; end: string };

/** A planned window assigned by back-scheduling. */
export type PlannedWindow = { planned_start: string; planned_end: string };
```

- [ ] **Step 2: Typecheck**

Run (from `apps/web/`): `pnpm typecheck`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/steps/types.ts
git commit -m "feat(steps): trade-step domain types"
```

---

## Task 4: Applicability (pure, TDD)

**Files:**
- Create: `apps/web/lib/steps/applicability.ts`
- Test: `apps/web/tests/unit/step-applicability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { applies } from "@/lib/steps/applicability";
import type { FinishProfile } from "@/lib/steps/types";

const marble: FinishProfile = { area_type: "bathroom", lantai: "marmer" };
const ceramic: FinishProfile = { area_type: "bathroom", lantai: "keramik" };

describe("applies", () => {
  it("empty applicability always matches", () => {
    expect(applies({}, marble)).toBe(true);
    expect(applies({}, ceramic)).toBe(true);
  });

  it("matches when the profile value is in the allowed set", () => {
    expect(applies({ lantai: ["marmer", "batu"] }, marble)).toBe(true);
  });

  it("does not match when the profile value is outside the allowed set", () => {
    expect(applies({ lantai: ["marmer", "batu"] }, ceramic)).toBe(false);
  });

  it("does not match when the profile is missing the key entirely", () => {
    expect(applies({ lantai: ["marmer"] }, { area_type: "bathroom" })).toBe(false);
  });

  it("requires ALL keys to match (logical AND across keys)", () => {
    const cond = { lantai: ["marmer"], dinding: ["batu"] };
    expect(applies(cond, { area_type: "bathroom", lantai: "marmer", dinding: "batu" })).toBe(true);
    expect(applies(cond, { area_type: "bathroom", lantai: "marmer", dinding: "cat" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-applicability.test.ts`
Expected: FAIL with "Failed to resolve import \"@/lib/steps/applicability\"".

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { FinishProfile } from "@/lib/steps/types";

/**
 * A step applies to an area when EVERY key in `applicability` has the area's
 * profile value present in the allowed set. An empty condition always applies.
 */
export function applies(
  applicability: Record<string, string[]>,
  profile: FinishProfile,
): boolean {
  for (const [key, allowed] of Object.entries(applicability)) {
    const value = profile[key];
    if (value === undefined || !allowed.includes(value)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-applicability.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/applicability.ts apps/web/tests/unit/step-applicability.test.ts
git commit -m "feat(steps): applicability matcher (pure)"
```

---

## Task 5: Back-scheduling (pure, TDD)

This is the heart: site_work/inspection steps forward-schedule within the gate window by dependency order; `decision`/`procurement` steps back-schedule from the earliest dependent so their deadlines land *before* the work they gate, with lead time.

**Files:**
- Create: `apps/web/lib/steps/back-schedule.ts`
- Test: `apps/web/tests/unit/step-back-schedule.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { addDays, backScheduleSteps } from "@/lib/steps/back-schedule";
import type { TradeStepTemplate, TradeStepDep } from "@/lib/steps/types";

function step(
  code: string,
  step_type: TradeStepTemplate["step_type"],
  dur: number,
  lead = 0,
): TradeStepTemplate {
  return {
    code, gate_code: "B", name: code, step_type, trade_role: null,
    typical_duration_days: dur, lead_time_days: lead, sort_order: 0, applicability: {},
  };
}

describe("addDays", () => {
  it("adds calendar days to an ISO date", () => {
    expect(addDays("2026-07-01", 3)).toBe("2026-07-04");
    expect(addDays("2026-07-05", -22)).toBe("2026-06-13");
  });
});

describe("backScheduleSteps", () => {
  const steps = [
    step("B1", "decision", 1, 7),
    step("B3", "procurement", 1, 21),
    step("B4", "site_work", 3),
    step("B5", "site_work", 2),
    step("B6", "site_work", 5),
  ];
  const deps: TradeStepDep[] = [
    { step_code: "B3", predecessor_code: "B1" },
    { step_code: "B5", predecessor_code: "B4" },
    { step_code: "B6", predecessor_code: "B5" },
    { step_code: "B6", predecessor_code: "B3" },
  ];
  const window = { start: "2026-07-01", end: "2026-09-30" };
  const plan = backScheduleSteps(steps, deps, window);

  it("forward-schedules site steps from the gate window start along site deps", () => {
    expect(plan.get("B4")).toEqual({ planned_start: "2026-07-01", planned_end: "2026-07-04" });
    expect(plan.get("B5")).toEqual({ planned_start: "2026-07-04", planned_end: "2026-07-06" });
    expect(plan.get("B6")).toEqual({ planned_start: "2026-07-06", planned_end: "2026-07-11" });
  });

  it("back-schedules procurement from its earliest dependent minus lead+duration", () => {
    // B3 gates B6 (start 07-06): end = 07-06 - 1 = 07-05; start = 07-05 - (21+1) = 06-13
    expect(plan.get("B3")).toEqual({ planned_start: "2026-06-13", planned_end: "2026-07-05" });
  });

  it("back-schedules a decision from its dependent procurement", () => {
    // B1 gates B3 (start 06-13): end = 06-12; start = 06-12 - (7+1) = 06-04
    expect(plan.get("B1")).toEqual({ planned_start: "2026-06-04", planned_end: "2026-06-12" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-back-schedule.test.ts`
Expected: FAIL with "Failed to resolve import \"@/lib/steps/back-schedule\"".

- [ ] **Step 3: Write minimal implementation**

```typescript
import type {
  DateWindow, PlannedWindow, TradeStepDep, TradeStepTemplate,
} from "@/lib/steps/types";

const DAY_MS = 86_400_000;

/** Add (or subtract) whole calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Assign a planned window to every step.
 *
 * - site_work / inspection: forward pass. start = max(window.start, latest
 *   planned_end of its site/inspection predecessors); end = start + duration.
 * - decision / procurement: back pass. end = (earliest dependent's planned_start
 *   - 1 day); start = end - (lead_time + duration). Dependents are resolved
 *   transitively so a decision gating a procurement gating site work lands first.
 *
 * Calendar days, no working-day calendar or resource leveling (v1, YAGNI).
 */
export function backScheduleSteps(
  steps: TradeStepTemplate[],
  deps: TradeStepDep[],
  window: DateWindow,
): Map<string, PlannedWindow> {
  const byCode = new Map(steps.map((s) => [s.code, s]));
  const predsOf = new Map<string, string[]>();
  const depsOf = new Map<string, string[]>(); // code -> steps that depend on it
  for (const s of steps) { predsOf.set(s.code, []); depsOf.set(s.code, []); }
  for (const d of deps) {
    if (byCode.has(d.step_code) && byCode.has(d.predecessor_code)) {
      predsOf.get(d.step_code)!.push(d.predecessor_code);
      depsOf.get(d.predecessor_code)!.push(d.step_code);
    }
  }

  const planned = new Map<string, PlannedWindow>();
  const isPhysical = (c: string) => {
    const t = byCode.get(c)!.step_type;
    return t === "site_work" || t === "inspection";
  };

  // Forward pass for physical steps (topological by physical predecessors).
  const physical = steps.filter((s) => isPhysical(s.code));
  const done = new Set<string>();
  let guard = physical.length * physical.length + 1;
  while (done.size < physical.length && guard-- > 0) {
    for (const s of physical) {
      if (done.has(s.code)) continue;
      const physicalPreds = predsOf.get(s.code)!.filter(isPhysical);
      if (!physicalPreds.every((p) => done.has(p))) continue;
      const start = physicalPreds.reduce(
        (acc, p) => maxIso(acc, planned.get(p)!.planned_end),
        window.start,
      );
      planned.set(s.code, { planned_start: start, planned_end: addDays(start, s.typical_duration_days) });
      done.add(s.code);
    }
  }

  // Back pass for decision/procurement steps. Resolve from the earliest planned
  // dependent; iterate so chains (decision -> procurement -> site) converge.
  const upstream = steps.filter((s) => !isPhysical(s.code));
  guard = upstream.length * upstream.length + 1;
  const placed = new Set<string>();
  while (placed.size < upstream.length && guard-- > 0) {
    for (const s of upstream) {
      if (placed.has(s.code)) continue;
      const dependents = depsOf.get(s.code)!;
      if (!dependents.every((d) => planned.has(d))) continue; // wait until dependents placed
      const earliestDependentStart = dependents
        .map((d) => planned.get(d)!.planned_start)
        .reduce((a, b) => (a <= b ? a : b));
      const end = addDays(earliestDependentStart, -1);
      const start = addDays(end, -(s.lead_time_days + s.typical_duration_days));
      planned.set(s.code, { planned_start: start, planned_end: end });
      placed.add(s.code);
    }
  }

  return planned;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-back-schedule.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/back-schedule.ts apps/web/tests/unit/step-back-schedule.test.ts
git commit -m "feat(steps): deterministic back-scheduling (pure)"
```

---

## Task 6: Step-status projection (pure, TDD)

Mirrors `evaluateGate`: latest work event per step wins; checkpoints + open punch items decide `accepted` vs `done_with_defects`. (`stalled` is a Phase-2 overlay computed by the silence job, not here.)

**Files:**
- Create: `apps/web/lib/steps/status.ts`
- Test: `apps/web/tests/unit/step-status.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { projectStepStatus, type StepStatusInput } from "@/lib/steps/status";

type WorkEv = StepStatusInput["workEvents"][number];
const ev = (status: string, occurredAt: string, extra: Record<string, unknown> = {}): WorkEv =>
  ({ occurred_at: occurredAt, created_at: occurredAt, payload: { status, ...extra } });

function input(over: Partial<StepStatusInput> = {}): StepStatusInput {
  return { workEvents: [], checkpoints: [], punchItems: [], ...over };
}

describe("projectStepStatus", () => {
  it("not_started when there are no work events", () => {
    expect(projectStepStatus(input()).status).toBe("not_started");
  });

  it("in_progress on a non-terminal work event", () => {
    const r = projectStepStatus(input({ workEvents: [ev("in_progress", "2026-07-02T00:00:00Z")] }));
    expect(r.status).toBe("in_progress");
    expect(r.lastProgressAt).toBe("2026-07-02T00:00:00Z");
  });

  it("blocked when the latest work event is blocked, carrying the reason", () => {
    const r = projectStepStatus(input({ workEvents: [
      ev("in_progress", "2026-07-02T00:00:00Z"),
      ev("blocked", "2026-07-03T00:00:00Z", { blocked_on: "marmer belum datang" }),
    ] }));
    expect(r.status).toBe("blocked");
    expect(r.blockingReason).toBe("marmer belum datang");
  });

  it("done_with_defects when work is done but a kritis/mayor punch is open", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("done", "2026-07-05T00:00:00Z")],
      punchItems: [{ severity: "mayor", status: "open" }],
    }));
    expect(r.status).toBe("done_with_defects");
  });

  it("done_with_defects when work is done but a required checkpoint has not passed", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("done", "2026-07-05T00:00:00Z")],
      checkpoints: [{ required: true, result: "pending" }],
    }));
    expect(r.status).toBe("done_with_defects");
  });

  it("accepted when work done, all required checkpoints pass, no open kritis/mayor punch", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("done", "2026-07-05T00:00:00Z")],
      checkpoints: [{ required: true, result: "pass" }, { required: false, result: "pending" }],
      punchItems: [{ severity: "minor", status: "open" }, { severity: "kritis", status: "closed" }],
    }));
    expect(r.status).toBe("accepted");
  });

  it("done via percent_complete >= 100 counts as done", () => {
    const r = projectStepStatus(input({
      workEvents: [ev("in_progress", "2026-07-05T00:00:00Z", { percent_complete: 100 })],
      checkpoints: [{ required: true, result: "pass" }],
    }));
    expect(r.status).toBe("accepted");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-status.test.ts`
Expected: FAIL with "Failed to resolve import \"@/lib/steps/status\"".

- [ ] **Step 3: Write minimal implementation**

```typescript
import type { PunchSeverity, StepStatus } from "@/lib/steps/types";

export type StepStatusInput = {
  workEvents: Array<{
    occurred_at: string;
    created_at: string;
    payload: { status?: string; percent_complete?: number; blocked_on?: string; description?: string } | null;
  }>;
  checkpoints: Array<{ required: boolean; result: "pending" | "pass" | "fail" }>;
  punchItems: Array<{ severity: PunchSeverity; status: "open" | "fixing" | "closed" }>;
};

export type StepStatusResult = {
  status: StepStatus;
  lastProgressAt: string | null;
  blockingReason: string | null;
};

/** occurred_at, then created_at as the tiebreak (mirrors compareEventTime). */
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

export function projectStepStatus(input: StepStatusInput): StepStatusResult {
  const last = latest(input.workEvents);
  if (!last) return { status: "not_started", lastProgressAt: null, blockingReason: null };

  const lastProgressAt = last.occurred_at;

  if (last.payload?.status === "blocked") {
    return {
      status: "blocked",
      lastProgressAt,
      blockingReason: last.payload.blocked_on ?? last.payload.description ?? "Terblokir",
    };
  }

  if (isDone(last.payload)) {
    const hasOpenSeriousPunch = input.punchItems.some(
      (p) => p.status !== "closed" && (p.severity === "kritis" || p.severity === "mayor"),
    );
    const allRequiredPassed = input.checkpoints
      .filter((c) => c.required)
      .every((c) => c.result === "pass");
    if (!hasOpenSeriousPunch && allRequiredPassed) {
      return { status: "accepted", lastProgressAt, blockingReason: null };
    }
    return { status: "done_with_defects", lastProgressAt, blockingReason: null };
  }

  return { status: "in_progress", lastProgressAt, blockingReason: null };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web/`): `pnpm test -- tests/unit/step-status.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/status.ts apps/web/tests/unit/step-status.test.ts
git commit -m "feat(steps): step-status projection (pure)"
```

---

## Task 7: `seed_area_steps` SQL function

Instantiates `area_steps` + `area_step_checkpoints` for a bathroom area from the templates, filtered by `area_type` + `finish_profile`. Idempotent. Mirrors `seed_default_topics`.

**Files:**
- Create: `packages/db/supabase/migrations/20260620000003_seed_area_steps_fn.sql`

- [ ] **Step 1: Write the function SQL**

```sql
-- Instantiate Gate B steps for a bathroom area. Idempotent: skips steps that
-- already exist for the area. Applicability: every key in trade_steps.applicability
-- must have the area's profile value (area_type + finish_profile) in its allowed set.
create or replace function public.seed_area_steps(p_area_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_area_type  text;
  v_finish     jsonb;
  v_step       record;
  v_new_id     uuid;
  v_ok         boolean;
  v_key        text;
  v_allowed    jsonb;
  v_value      text;
begin
  select project_id, area_type::text, finish_profile
    into v_project_id, v_area_type, v_finish
    from public.areas where id = p_area_id;
  if v_project_id is null then return; end if;

  -- Only bathrooms get the Gate B step set in this pilot.
  if v_area_type <> 'bathroom' then return; end if;

  for v_step in
    select * from public.trade_steps where gate_code = 'B' and active order by sort_order
  loop
    -- Evaluate applicability (AND across keys; value must be in allowed array).
    v_ok := true;
    for v_key, v_allowed in select * from jsonb_each(v_step.applicability)
    loop
      v_value := coalesce(v_finish ->> v_key, null);
      if v_value is null or not (v_allowed ? v_value) then
        v_ok := false;
      end if;
    end loop;
    if not v_ok then continue; end if;

    -- Idempotent insert of the area_step.
    insert into public.area_steps (area_id, project_id, step_code)
    values (p_area_id, v_project_id, v_step.code)
    on conflict (area_id, step_code) do nothing
    returning id into v_new_id;

    -- Copy checkpoint templates only when we actually created the step.
    if v_new_id is not null then
      insert into public.area_step_checkpoints
        (area_step_id, project_id, item_text, severity, required, sort_order)
      select v_new_id, v_project_id, t.item_text, t.default_severity, t.required, t.sort_order
      from public.trade_step_checkpoints t
      where t.step_code = v_step.code;
    end if;
  end loop;
end;
$$;

revoke all on function public.seed_area_steps(uuid) from public;
grant execute on function public.seed_area_steps(uuid) to authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/supabase/migrations/20260620000003_seed_area_steps_fn.sql
git commit -m "feat(db): seed_area_steps(area_id) instantiation function"
```

---

## Task 8: Query module — read area steps

**Files:**
- Create: `apps/web/lib/steps/queries.ts`

- [ ] **Step 1: Write the query** (after Task 11 regenerates types, this typechecks against real tables)

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type AreaStepRow = {
  id: string;
  step_code: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  assigned_trade: string | null;
  blocking_reason: string | null;
  last_progress_at: string | null;
};

/** All trade steps instantiated for one area, ordered by the template sort_order. */
export async function getAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<AreaStepRow[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      assigned_trade, blocking_reason, last_progress_at,
      trade_steps:step_code (sort_order)
    `)
    .eq("area_id", areaId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({ ...r, _sort: (r.trade_steps as { sort_order: number } | null)?.sort_order ?? 0 }))
    .sort((a, b) => a._sort - b._sort)
    .map(({ _sort, trade_steps, ...rest }) => rest as AreaStepRow);
}
```

- [ ] **Step 2: Typecheck** (will fully resolve once Task 11 regenerates `Database` types)

Run (from `apps/web/`): `pnpm typecheck`
Expected: PASS after Task 11. If running before Task 11, expect table-name type errors — proceed to Task 11 then re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/steps/queries.ts
git commit -m "feat(steps): getAreaSteps query"
```

---

## Task 9: Mutation module — instantiate + write planned dates

**Files:**
- Create: `apps/web/lib/steps/mutations.ts`

- [ ] **Step 1: Write the mutations**

```typescript
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { backScheduleSteps } from "@/lib/steps/back-schedule";
import type { TradeStepDep, TradeStepTemplate } from "@/lib/steps/types";

/** Call the SQL instantiation function for an area (idempotent). */
export async function instantiateAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<void> {
  const { error } = await supabase.rpc("seed_area_steps", { p_area_id: areaId });
  if (error) throw error;
}

/**
 * Compute planned windows for an area's Gate B steps from the gate target
 * window and persist them onto area_steps. No-op if the gate window is unset.
 */
export async function writePlannedDates(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<void> {
  const { data: gate } = await supabase
    .from("area_gate_status")
    .select("target_start_date, target_end_date")
    .eq("area_id", areaId)
    .eq("gate_code", "B")
    .maybeSingle();
  if (!gate?.target_start_date || !gate?.target_end_date) return;

  const { data: tmpl } = await supabase
    .from("trade_steps")
    .select("code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability")
    .eq("gate_code", "B");
  const { data: deps } = await supabase
    .from("trade_step_deps")
    .select("step_code, predecessor_code");

  const plan = backScheduleSteps(
    (tmpl ?? []) as unknown as TradeStepTemplate[],
    (deps ?? []) as TradeStepDep[],
    { start: gate.target_start_date, end: gate.target_end_date },
  );

  for (const [code, win] of plan) {
    await supabase
      .from("area_steps")
      .update({ planned_start: win.planned_start, planned_end: win.planned_end })
      .eq("area_id", areaId)
      .eq("step_code", code);
  }
}
```

- [ ] **Step 2: Typecheck**

Run (from `apps/web/`): `pnpm typecheck`
Expected: PASS after Task 11 (RPC + tables in generated types).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/steps/mutations.ts
git commit -m "feat(steps): instantiate + write planned dates mutations"
```

---

## Task 10: Wire instantiation into area creation

Find where areas are created (`apps/web/lib/areas/area-mutations.ts`) and call `instantiateAreaSteps` + `writePlannedDates` after a bathroom area with a finish profile is created/updated. Non-blocking (best-effort), so a failure never breaks area creation.

**Files:**
- Modify: `apps/web/lib/areas/area-mutations.ts`

- [ ] **Step 1: Locate the area create/update path**

Run: `grep -n "from(\"areas\")\|insert\|update" apps/web/lib/areas/area-mutations.ts | head`
Expected: the function(s) that insert/update an `areas` row.

- [ ] **Step 2: Add a best-effort hook after a bathroom area is persisted**

```typescript
// at top of file, with the other imports
import { instantiateAreaSteps, writePlannedDates } from "@/lib/steps/mutations";

// after the area row is successfully inserted/updated, where `area` is the row
// and `supabase` is the client in scope:
if (area.area_type === "bathroom") {
  try {
    await instantiateAreaSteps(supabase, area.id);
    await writePlannedDates(supabase, area.id);
  } catch (e) {
    console.warn("[steps] instantiation failed:", (e as Error).message);
  }
}
```

- [ ] **Step 3: Typecheck**

Run (from `apps/web/`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/areas/area-mutations.ts
git commit -m "feat(steps): instantiate Gate B steps when a bathroom area is created"
```

---

## Task 11: Apply migrations + regenerate types (gated — touches LIVE Supabase)

> **STOP — human confirmation required.** This applies migrations to the **live** Supabase project. Use the **global Supabase CLI v2**, `db push` only, **never** `db reset`. Confirm with Wilson before running.

- [ ] **Step 1: Push the migrations**

Run (repo root): `supabase db push`
Expected: the three `20260620*` migrations apply cleanly. If `current_can_read_project` was renamed in Step 2 of Task 1, fix the policy and re-push.

- [ ] **Step 2: Regenerate DB types**

Run: `supabase gen types typescript --linked > packages/db/src/types.generated.ts`
Expected: `trade_steps`, `area_steps`, `punch_items`, etc. now appear in the generated types.

- [ ] **Step 3: Full typecheck + unit tests green**

Run (from `apps/web/`): `pnpm typecheck && pnpm test`
Expected: PASS — queries/mutations resolve against real tables; all step unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/types.generated.ts
git commit -m "chore(db): regenerate types for trade-step model"
```

---

## Task 12: Manual smoke verification

- [ ] **Step 1: Instantiate on a real bathroom**

In a Supabase SQL console or a scratch server action, pick a real `bathroom` area, set its `finish_profile` (e.g. `{"lantai":"marmer"}`), and call `select public.seed_area_steps('<area_id>');`.
Expected: 9 `area_steps` rows (B1–B9) + their `area_step_checkpoints`. Set `finish_profile` to `{"lantai":"keramik"}` on another bathroom and confirm **B3 is absent** (8 rows).

- [ ] **Step 2: Confirm planned windows**

Run `writePlannedDates` for the marble area (or call it via the wired path) with Gate B `target_start_date`/`target_end_date` set on `area_gate_status`.
Expected: `B1` planned_start is weeks *before* `B6`, and `B3` falls between them — the back-scheduled decision/order land ahead of the install.

- [ ] **Step 3: Final commit (if any tidy-ups)**

```bash
git commit -am "test(steps): phase 1 smoke verification notes" --allow-empty
```

---

## Self-review checklist (completed by plan author)

- **Spec coverage (§4, §10):** schema (Task 1) ✓; Gate B template content (Task 2) ✓; finish profile source (Task 1 + spec §4.4) ✓; applicability (Task 4) ✓; back-scheduling decisions/procurement ahead of work (Task 5) ✓; step lifecycle states (Task 6; `stalled` deferred to Phase 2, noted) ✓; instantiation idempotent (Task 7) ✓; query/mutation/wiring (Tasks 8–10) ✓; punch_items table created, gating exercised Phase 2 (noted) ✓.
- **Deferred, by design:** silence detection/escalation, digest, personalization, per-trade calendar view, SANO link, Gates A & C–H — each its own later plan.
- **Type consistency:** `TradeStepTemplate`/`TradeStepDep`/`FinishProfile`/`StepStatus` defined in Task 3 and used unchanged in Tasks 4–9; `seed_area_steps(p_area_id)` RPC name matches Task 9's `.rpc("seed_area_steps", { p_area_id })`; `area_steps`/`area_step_checkpoints`/`punch_items` column names consistent across Tasks 1, 6, 7, 8.
- **Risk:** `current_can_read_project` helper name is assumed from memory — Task 1 Step 2 verifies it before pushing.
```
