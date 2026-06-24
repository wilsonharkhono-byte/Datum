# Readiness — Per-Bathroom Step Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any project member add (from the recommended catalog or as a brand-new custom step) and reversibly remove work steps on a bathroom, from the schedule page's per-bathroom checklist.

**Architecture:** A custom step is a **project-scoped `trade_steps` row** (`project_id` set, `source='custom'`) plus a normal `area_steps` row pointing at it, so the existing readiness engine (`getAreaSteps`/`computeAreaFlags`/projection) is reused unchanged. "Remove" is a reversible soft-delete (`area_steps.removed_at`). Two atomic RPCs (`add_catalog_area_step`, `add_custom_area_step`) plus two TS mutations (`removeAreaStep`/`restoreAreaStep`) back four `"use server"` action wrappers; the UI adds an `AddStepForm`, a "Hapus langkah" control, and a "Langkah dihapus" restore list.

**Tech Stack:** Next.js 16 App Router, React client components, Supabase (Postgres + RLS + SQL functions), Tailwind with CSS-var colors, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-24-readiness-step-editing-design.md`.

## Global Constraints

- Match the slice 2a-2 conventions verbatim: `"use client"`, `useState`/`useTransition`/`useRouter`, server action returns `{ ok: true } | { ok: false; error: string }`, `router.refresh()` on success, mobile-first touch targets (`min-h-11 md:min-h-0`), Tailwind CSS vars (`var(--surface)`, `var(--border)`, `var(--foreground)`, `var(--text-muted)`, `var(--sand-dark)`, `var(--sand-tint)`).
- UI strings Bahasa Indonesia, sentence case. Uncluttered: the add form and the removed-steps list are both collapsed by default.
- No new deps.
- Custom steps store `gate_code='B'`, `source='custom'`, `project_id=<area's project>`, `sort_order=900`, `applicability='{}'`, `code='cst_'||<uuid>`.
- **Verification:** pure-logic tasks use vitest TDD (`apps/web/tests/unit/**`, run with `pnpm -C apps/web test`). DB/integration/UI tasks verify with **root** `pnpm typecheck` + `pnpm test` (turbo, ALL workspaces incl. mobile — a shared `@datum/db`/types change can break mobile fixtures) and `pnpm -C apps/web build`. Browser verification is controller-run (Task 9).
- Types are regenerated from the **applied** schema (`supabase gen types typescript --local > packages/db/src/types.generated.ts`) so the new columns/RPCs are typed; prod `supabase db push` is a controller/Wilson step before deploy.

---

## Task 1: DB migration + regenerated types

**Files:**
- Create: `packages/db/supabase/migrations/20260624000001_step_editing.sql`
- Modify: `packages/db/src/types.generated.ts` (regenerated)

**Interfaces:**
- Produces — columns `trade_steps.project_id|source|created_by|created_at`, `area_steps.removed_at`; RPCs `add_catalog_area_step(p_area_id uuid, p_step_code text) returns uuid` and `add_custom_area_step(p_area_id uuid, p_name text, p_step_type text) returns uuid`; updated `seed_area_steps` (firm-standard only); RLS `trade_steps_read` (scoped) + `trade_steps_custom_write`.

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/20260624000001_step_editing.sql`:

```sql
-- Per-bathroom step editing: add/remove work steps.
-- Custom steps = project-scoped trade_steps rows; removal = reversible soft-delete.

-- 1. trade_steps scoping. NULL project_id = firm standard; set = project-scoped custom.
alter table public.trade_steps
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists source     text not null default 'standard' check (source in ('standard','custom')),
  add column if not exists created_by uuid references public.staff(id),
  add column if not exists created_at timestamptz not null default now();

-- 2. area_steps reversible soft-remove.
alter table public.area_steps
  add column if not exists removed_at timestamptz;

-- 3. Seeding stays pristine: only firm-standard steps auto-seed (project_id is null).
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
  if v_area_type <> 'bathroom' then return; end if;

  for v_step in
    select * from public.trade_steps
    where gate_code = 'B' and active and project_id is null   -- <-- new: firm-standard only
    order by sort_order
  loop
    v_ok := true;
    for v_key, v_allowed in select * from jsonb_each(v_step.applicability)
    loop
      v_value := coalesce(v_finish ->> v_key, null);
      if v_value is null or not (v_allowed ? v_value) then
        v_ok := false;
      end if;
    end loop;
    if not v_ok then continue; end if;

    insert into public.area_steps (area_id, project_id, step_code)
    values (p_area_id, v_project_id, v_step.code)
    on conflict (area_id, step_code) do nothing
    returning id into v_new_id;

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

-- 4. RLS: everyone reads firm standards; custom rows only to their project's members.
drop policy if exists trade_steps_read on public.trade_steps;
create policy trade_steps_read on public.trade_steps
  for select to authenticated
  using (project_id is null or public.current_can_read_project(project_id));

-- project members CRUD their own project's CUSTOM steps; never firm-standard rows.
drop policy if exists trade_steps_custom_write on public.trade_steps;
create policy trade_steps_custom_write on public.trade_steps
  for all to authenticated
  using  (project_id is not null and public.current_can_read_project(project_id))
  with check (project_id is not null and source = 'custom' and public.current_can_read_project(project_id));

-- Table-level write grant so the SECURITY INVOKER RPC can insert custom rows.
-- RLS (above) still confines writes to project-scoped custom rows; firm-standard
-- rows (project_id is null) are unmatched by USING, so they remain protected.
grant insert, update, delete on public.trade_steps to authenticated;

-- 5a. Add a firm-standard Gate B step (one-step seed). INVOKER so RLS enforces membership.
create or replace function public.add_catalog_area_step(p_area_id uuid, p_step_code text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_step_id    uuid;
begin
  select project_id into v_project_id from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;

  if not exists (
    select 1 from public.trade_steps
    where code = p_step_code and project_id is null and gate_code = 'B'
  ) then
    raise exception 'not a standard Gate B step: %', p_step_code;
  end if;

  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, p_step_code)
  on conflict (area_id, step_code) do nothing
  returning id into v_step_id;

  if v_step_id is not null then
    insert into public.area_step_checkpoints
      (area_step_id, project_id, item_text, severity, required, sort_order)
    select v_step_id, v_project_id, t.item_text, t.default_severity, t.required, t.sort_order
    from public.trade_step_checkpoints t
    where t.step_code = p_step_code;
  end if;

  return v_step_id;
end;
$$;
revoke all on function public.add_catalog_area_step(uuid, text) from public;
grant execute on function public.add_catalog_area_step(uuid, text) to authenticated;

-- 5b. Add a custom step (atomic: trade_steps row + area_step). INVOKER so RLS enforces.
create or replace function public.add_custom_area_step(p_area_id uuid, p_name text, p_step_type text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_project_id uuid;
  v_code       text;
  v_step_id    uuid;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  if p_step_type not in ('decision','procurement','site_work','inspection') then
    raise exception 'invalid step_type: %', p_step_type;
  end if;

  select project_id into v_project_id from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;

  v_code := 'cst_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.trade_steps
    (code, gate_code, name, step_type, source, project_id, created_by, sort_order, applicability, active)
  values
    (v_code, 'B', btrim(p_name), p_step_type, 'custom', v_project_id, auth.uid(), 900, '{}'::jsonb, true);

  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, v_code)
  returning id into v_step_id;

  return v_step_id;
end;
$$;
revoke all on function public.add_custom_area_step(uuid, text, text) from public;
grant execute on function public.add_custom_area_step(uuid, text, text) to authenticated;
```

- [ ] **Step 2: Apply locally and smoke-test**

Run (from `packages/db/`):
```bash
supabase start            # if not already running
supabase db reset         # applies all migrations incl. the new one
```
Expected: reset completes with no error (the migration applies). If local ports conflict with another stack, remap temporarily per the project's known gotcha, then revert; if the local stack cannot run here, report BLOCKED so the controller applies it.

Smoke (psql against the local DB — `supabase status` prints the connection string; substitute a real bathroom `area_id` from `select id from areas where area_type='bathroom' limit 1`):
```sql
-- custom add creates a scoped trade_steps row + area_step
select public.add_custom_area_step('<AREA_ID>', 'Tes langkah custom', 'site_work');
select code, source, project_id, name from trade_steps where source='custom';   -- 1 row, project scoped
-- remove/restore toggles removed_at
update area_steps set removed_at = now() where step_code like 'cst_%';
update area_steps set removed_at = null where step_code like 'cst_%';
-- seed still excludes customs: re-seeding the area does not error and adds no cst_ rows elsewhere
select public.seed_area_steps('<AREA_ID>');
```
Expected: the custom row exists `source='custom'` with a non-null `project_id`; `removed_at` toggles; `seed_area_steps` runs clean.

- [ ] **Step 3: Regenerate types**

Run (from `packages/db/`):
```bash
supabase gen types typescript --local > src/types.generated.ts
```
Expected: `src/types.generated.ts` now contains `add_catalog_area_step` / `add_custom_area_step` under `Functions`, and `removed_at` / `project_id` / `source` columns.

- [ ] **Step 4: Typecheck + commit**

Run (from repo root): `pnpm typecheck` → PASS.
```bash
git add packages/db/supabase/migrations/20260624000001_step_editing.sql packages/db/src/types.generated.ts
git commit -m "feat(db): step-editing schema — custom trade_steps scoping, area_steps.removed_at, add_*_area_step RPCs"
```

---

## Task 2: `computeAreaFlags` — absent-predecessor refinement (pure, TDD)

**Files:**
- Modify: `apps/web/lib/steps/flags.ts:25-27`
- Test: `apps/web/tests/unit/step-flags.test.ts`

**Interfaces:**
- Consumes/Produces — `computeAreaFlags(steps, deps)` signature unchanged; only the readiness predicate changes so an absent predecessor no longer blocks.

- [ ] **Step 1: Add the failing tests**

Append to `apps/web/tests/unit/step-flags.test.ts` (inside the `describe("computeAreaFlags", …)` block; `deps` already declares `B6 ← B3 ← B1`):

```ts
  it("treats an absent predecessor as satisfied (removed/excluded prerequisite does not block)", () => {
    // B6 depends on B3, but B3 is absent from the area's active steps.
    const steps: S[] = [
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe("B6");
  });

  it("a present-but-unfinished predecessor still blocks (regression)", () => {
    const steps: S[] = [
      { step_code: "B3", step_type: "procurement", status: "in_progress" },
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe(null);
  });
```

- [ ] **Step 2: Run to verify the new ready-when-absent test fails**

Run: `pnpm -C apps/web test -- step-flags`
Expected: the "treats an absent predecessor as satisfied" case FAILS (`readyToStart` is `null`, not `"B6"`); the regression case passes.

- [ ] **Step 3: Implement the refinement**

In `apps/web/lib/steps/flags.ts`, change `isReady`:
```ts
  const isReady = (code: string) =>
    status.get(code) === "not_started" &&
    predsOf.get(code)!.every((p) => !status.has(p) || status.get(p) === "accepted");
```

- [ ] **Step 4: Run to verify all pass**

Run: `pnpm -C apps/web test -- step-flags`
Expected: PASS (all cases, including the existing ones).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/flags.ts apps/web/tests/unit/step-flags.test.ts
git commit -m "fix(steps): computeAreaFlags treats an absent predecessor as satisfied"
```

---

## Task 3: Queries — active filter, removed list, addable catalog

**Files:**
- Modify: `apps/web/lib/steps/queries.ts`
- Test: `apps/web/tests/unit/step-addable.test.ts` (create)

**Interfaces:**
- Consumes — Supabase `area_steps`/`trade_steps` (incl. new `removed_at`/`project_id`).
- Produces — `getAreaSteps` (now active-only, ordered `(sort_order, created_at)`); `getRemovedAreaSteps(sb, areaId): Promise<RemovedStep[]>`; `getAddableCatalogSteps(sb, areaId): Promise<CatalogStep[]>`; pure `addableCatalog(catalog, existingCodes): CatalogStep[]`; types `CatalogStep = { code: string; name: string }`, `RemovedStep = { id: string; step_code: string; name: string }`.

- [ ] **Step 1: Write the failing test for the pure filter**

Create `apps/web/tests/unit/step-addable.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { addableCatalog } from "@/lib/steps/queries";

describe("addableCatalog", () => {
  it("returns catalog steps whose code is not already on the area", () => {
    const catalog = [
      { code: "B1", name: "Pilih material" },
      { code: "B4", name: "Waterproofing" },
      { code: "B5", name: "Screeding" },
    ];
    expect(addableCatalog(catalog, ["B1", "B5"])).toEqual([{ code: "B4", name: "Waterproofing" }]);
  });

  it("excludes a code that exists even if removed (it lives in the removed list)", () => {
    const catalog = [{ code: "B1", name: "Pilih material" }];
    // B1 already has a row (removed or not) → not addable from catalog.
    expect(addableCatalog(catalog, ["B1"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C apps/web test -- step-addable`
Expected: FAIL — `addableCatalog` is not exported from `@/lib/steps/queries`.

- [ ] **Step 3: Implement the pure filter, the active-filter change, and the two new queries**

In `apps/web/lib/steps/queries.ts`:

(a) Add the exported types + pure helper near the top (after `AreaStepRow`):
```ts
export type CatalogStep = { code: string; name: string };
export type RemovedStep = { id: string; step_code: string; name: string };

/** Pure: standard catalog steps whose code is not already instantiated on the area. */
export function addableCatalog(catalog: CatalogStep[], existingCodes: string[]): CatalogStep[] {
  const have = new Set(existingCodes);
  return catalog.filter((c) => !have.has(c.code));
}
```

(b) In `getAreaSteps`, add `created_at` to the select, filter to active rows, and order by `(sort_order, created_at)`. Replace the query + the sort/strip tail:
```ts
  const { data, error } = await supabase
    .from("area_steps")
    .select(`
      id, step_code, status, planned_start, planned_end,
      assigned_trade, blocking_reason, last_progress_at, created_at,
      trade_steps:step_code (sort_order, step_type, name),
      area_step_checkpoints (id, item_text, severity, required, result, sort_order)
    `)
    .eq("area_id", areaId)
    .is("removed_at", null);
  if (error) throw error;

  return (data ?? [])
    .map((r) => {
      const tmpl = r.trade_steps as { sort_order: number; step_type: string; name: string } | null;
      const cps = (r.area_step_checkpoints as Array<AreaStepCheckpoint & { sort_order: number }> | null) ?? [];
      return {
        _sort: tmpl?.sort_order ?? 0,
        _created: r.created_at as string,
        id: r.id,
        step_code: r.step_code,
        name: tmpl?.name ?? r.step_code,
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
    .sort((a, b) => a._sort - b._sort || a._created.localeCompare(b._created))
    .map(({ _sort, _created, ...rest }) => rest as AreaStepRow);
```

(c) Append the two new queries at the end of the file:
```ts
/** Steps the user soft-removed from this area (for the restore list). */
export async function getRemovedAreaSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<RemovedStep[]> {
  const { data, error } = await supabase
    .from("area_steps")
    .select("id, step_code, trade_steps:step_code (name)")
    .eq("area_id", areaId)
    .not("removed_at", "is", null);
  if (error) throw error;
  return (data ?? []).map((r) => {
    const tmpl = r.trade_steps as { name: string } | null;
    return { id: r.id, step_code: r.step_code, name: tmpl?.name ?? r.step_code };
  });
}

/** Firm-standard Gate B steps not yet instantiated on this area (the catalog picker). */
export async function getAddableCatalogSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<CatalogStep[]> {
  const [{ data: existing, error: e1 }, { data: catalog, error: e2 }] = await Promise.all([
    supabase.from("area_steps").select("step_code").eq("area_id", areaId),
    supabase.from("trade_steps").select("code, name")
      .eq("gate_code", "B").eq("active", true).is("project_id", null).order("sort_order"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  return addableCatalog(
    (catalog ?? []) as CatalogStep[],
    (existing ?? []).map((r) => r.step_code),
  );
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm -C apps/web test -- step-addable` → PASS.
Run: `pnpm -C apps/web typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/queries.ts apps/web/tests/unit/step-addable.test.ts
git commit -m "feat(steps): active-only getAreaSteps + getRemovedAreaSteps + getAddableCatalogSteps"
```

---

## Task 4: Mutations + server actions

**Files:**
- Modify: `apps/web/lib/steps/mutations.ts` (append)
- Modify: `apps/web/lib/steps/actions.ts`

**Interfaces:**
- Consumes — `add_catalog_area_step` / `add_custom_area_step` RPCs (Task 1); `createSupabaseServerClient`, `getCurrentStaff`.
- Produces — `removeAreaStep(sb, { areaStepId })`, `restoreAreaStep(sb, { areaStepId })`; actions `addCatalogStep({ areaId, stepCode })`, `addCustomStep({ areaId, name, stepType })`, `removeStep({ areaStepId })`, `restoreStep({ areaStepId })`, all `Promise<StepActionResult>`.

- [ ] **Step 1: Add the two mutations**

Append to `apps/web/lib/steps/mutations.ts`:
```ts
/** Reversibly soft-remove a step from its area. */
export async function removeAreaStep(
  supabase: SupabaseClient<Database>,
  args: { areaStepId: string },
): Promise<void> {
  const { error } = await supabase
    .from("area_steps")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", args.areaStepId);
  if (error) throw error;
}

/** Restore a soft-removed step. */
export async function restoreAreaStep(
  supabase: SupabaseClient<Database>,
  args: { areaStepId: string },
): Promise<void> {
  const { error } = await supabase
    .from("area_steps")
    .update({ removed_at: null })
    .eq("id", args.areaStepId);
  if (error) throw error;
}
```

- [ ] **Step 2: Add the four action wrappers**

In `apps/web/lib/steps/actions.ts`, extend the mutations import and append the actions:
```ts
import { updateAreaStep, setCheckpointResult, removeAreaStep, restoreAreaStep } from "@/lib/steps/mutations";
```
```ts
export async function addCatalogStep(args: { areaId: string; stepCode: string }): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk menambah langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("add_catalog_area_step", { p_area_id: args.areaId, p_step_code: args.stepCode });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function addCustomStep(args: {
  areaId: string;
  name: string;
  stepType: "decision" | "procurement" | "site_work" | "inspection";
}): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk menambah langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("add_custom_area_step", {
      p_area_id: args.areaId, p_name: args.name, p_step_type: args.stepType,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function removeStep(args: { areaStepId: string }): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk menghapus langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    await removeAreaStep(supabase, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function restoreStep(args: { areaStepId: string }): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk memulihkan langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    await restoreAreaStep(supabase, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS (requires Task 1's regenerated types for the RPC names).
```bash
git add apps/web/lib/steps/mutations.ts apps/web/lib/steps/actions.ts
git commit -m "feat(steps): remove/restore mutations + add/remove/restore server actions"
```

---

## Task 5: `AddStepForm` component

**Files:**
- Create: `apps/web/components/schedule/AddStepForm.tsx`

**Interfaces:**
- Consumes — `addCatalogStep`, `addCustomStep` (Task 4); `CatalogStep` (Task 3).
- Produces — `<AddStepForm areaId={string} addableCatalog={CatalogStep[]} />` (client).

- [ ] **Step 1: Write the component**

Create `apps/web/components/schedule/AddStepForm.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCatalogStep, addCustomStep } from "@/lib/steps/actions";
import type { CatalogStep } from "@/lib/steps/queries";

type StepType = "decision" | "procurement" | "site_work" | "inspection";
const TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: "site_work", label: "Pekerjaan" },
  { value: "decision", label: "Keputusan" },
  { value: "procurement", label: "Pengadaan" },
  { value: "inspection", label: "Inspeksi" },
];

export function AddStepForm({ areaId, addableCatalog }: { areaId: string; addableCatalog: CatalogStep[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"catalog" | "custom">(addableCatalog.length > 0 ? "catalog" : "custom");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [stepType, setStepType] = useState<StepType>("site_work");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { setName(""); setCode(""); setOpen(false); router.refresh(); }
      else setError(res.error);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => { setError(null); setOpen(true); }}
        className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2.5 text-left text-[12px] font-semibold text-[var(--sand-dark)] hover:bg-[var(--sand-tint)] md:min-h-0">
        + Tambah langkah
      </button>
    );
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3">
      <div className="mb-2 flex gap-1.5">
        {addableCatalog.length > 0 ? (
          <button type="button" disabled={pending} onClick={() => setMode("catalog")}
            className={`min-h-11 rounded border px-2.5 py-1 text-[11px] font-semibold md:min-h-0 ${mode === "catalog" ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
            Dari rekomendasi
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => setMode("custom")}
          className={`min-h-11 rounded border px-2.5 py-1 text-[11px] font-semibold md:min-h-0 ${mode === "custom" ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
          Baru
        </button>
      </div>

      {mode === "catalog" && addableCatalog.length > 0 ? (
        <div className="flex items-center gap-1.5">
          <select value={code} disabled={pending} onChange={(e) => setCode(e.target.value)}
            className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] md:min-h-0">
            <option value="">Pilih langkah…</option>
            {addableCatalog.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <button type="button" disabled={pending || !code}
            onClick={() => run(() => addCatalogStep({ areaId, stepCode: code }))}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
            Tambah
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <input value={name} disabled={pending} onChange={(e) => setName(e.target.value)}
            placeholder="Nama langkah baru…"
            className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0" />
          <select value={stepType} disabled={pending} onChange={(e) => setStepType(e.target.value as StepType)}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] md:min-h-0">
            {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <button type="button" disabled={pending || !name.trim()}
            onClick={() => run(() => addCustomStep({ areaId, name: name.trim(), stepType }))}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
            Tambah
          </button>
        </div>
      )}

      <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); }}
        className="mt-2 min-h-11 text-[11px] text-[var(--text-muted)] hover:text-[var(--foreground)] disabled:opacity-50 md:min-h-0">
        Batal
      </button>
      {error ? <p className="mt-2 text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/schedule/AddStepForm.tsx
git commit -m "feat(schedule): AddStepForm — catalog picker + custom step form"
```

---

## Task 6: `StepDetail` — "Hapus langkah" control

**Files:**
- Modify: `apps/web/components/schedule/StepDetail.tsx`

**Interfaces:**
- Consumes — `removeStep` (Task 4).

- [ ] **Step 1: Wire the remove control**

In `apps/web/components/schedule/StepDetail.tsx`:

(a) Extend the actions import:
```ts
import { submitStepUpdate, submitCheckpointResult, removeStep } from "@/lib/steps/actions";
```

(b) Add a `remove` handler after `setStatus`:
```ts
  function remove() {
    if (!window.confirm("Hapus langkah ini dari kamar mandi? Bisa dipulihkan nanti.")) return;
    run(() => removeStep({ areaStepId: step.id }));
  }
```

(c) Insert a remove control just before the closing `{error ? … }` line (after the checkpoints block):
```tsx
      <div className="mt-3 border-t border-[var(--border)] pt-2">
        <button type="button" disabled={pending} onClick={remove}
          className="min-h-11 text-[11px] font-semibold text-[var(--text-muted)] hover:text-red-700 disabled:opacity-50 md:min-h-0">
          Hapus langkah
        </button>
      </div>

      {error ? <p className="mt-2 text-[11px] text-red-700">{error}</p> : null}
```
(Replace the existing bare `{error ? … }` line with the block above so the remove control sits above the error.)

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/schedule/StepDetail.tsx
git commit -m "feat(schedule): StepDetail — Hapus langkah (soft-remove) control"
```

---

## Task 7: `AreaStepsPanel` — add form + removed-steps restore list

**Files:**
- Modify: `apps/web/components/schedule/AreaStepsPanel.tsx`

**Interfaces:**
- Consumes — `AddStepForm` (Task 5), `restoreStep` (Task 4), `CatalogStep`/`RemovedStep` (Task 3).
- Produces — `<AreaStepsPanel areaId areaName steps flags addableCatalog removedSteps />`.

- [ ] **Step 1: Update imports and props**

Replace the top imports + the component signature in `apps/web/components/schedule/AreaStepsPanel.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StepDetail } from "@/components/schedule/StepDetail";
import { AddStepForm } from "@/components/schedule/AddStepForm";
import { restoreStep } from "@/lib/steps/actions";
import type { AreaStepRow, CatalogStep, RemovedStep } from "@/lib/steps/queries";
import type { AreaFlags } from "@/lib/steps/flags";
```
```tsx
export function AreaStepsPanel({ areaId, areaName, steps, flags, addableCatalog, removedSteps }: {
  areaId: string;
  areaName: string;
  steps: AreaStepRow[];
  flags: AreaFlags;
  addableCatalog: CatalogStep[];
  removedSteps: RemovedStep[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const done = steps.filter((s) => s.status === "accepted" || s.status === "done_with_defects").length;
  const nameOf = (code: string | null) => steps.find((s) => s.step_code === code)?.name ?? code;

  function restore(areaStepId: string) {
    startTransition(async () => {
      const res = await restoreStep({ areaStepId });
      if (res.ok) router.refresh();
    });
  }
```
(The `CHIP` constant and the `return (…)` header + flags strip + `steps.map(...)` are unchanged.)

- [ ] **Step 2: Render the add form + removed list inside the open block**

Inside the `{open ? (<div className="border-t …">…</div>) : null}` block, after the `{steps.map(...)}` expression and before that `</div>`, insert:
```tsx
          <AddStepForm areaId={areaId} addableCatalog={addableCatalog} />

          {removedSteps.length > 0 ? (
            <div className="border-t border-[var(--border)]">
              <button type="button" onClick={() => setShowRemoved((v) => !v)}
                className="min-h-11 w-full px-4 py-2.5 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
                Langkah dihapus ({removedSteps.length}) <span>{showRemoved ? "▾" : "▸"}</span>
              </button>
              {showRemoved ? removedSteps.map((r) => (
                <div key={r.id} className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2 text-[12px] text-[var(--text-muted)]">
                  <span className="flex-1 line-through">{r.name}</span>
                  <button type="button" disabled={pending} onClick={() => restore(r.id)}
                    className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
                    Pulihkan
                  </button>
                </div>
              )) : null}
            </div>
          ) : null}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/schedule/AreaStepsPanel.tsx
git commit -m "feat(schedule): AreaStepsPanel — Tambah langkah form + Langkah dihapus restore list"
```

---

## Task 8: Wire the queries into the schedule page

**Files:**
- Modify: `apps/web/app/(app)/project/[slug]/schedule/page.tsx`

**Interfaces:**
- Consumes — `getAddableCatalogSteps`, `getRemovedAreaSteps` (Task 3); `AreaStepsPanel` new props (Task 7).

- [ ] **Step 1: Extend the imports**

In `apps/web/app/(app)/project/[slug]/schedule/page.tsx`, change the queries import:
```ts
import { getAreaStepView, getAddableCatalogSteps, getRemovedAreaSteps } from "@/lib/steps/queries";
```

- [ ] **Step 2: Fetch addable catalog + removed steps per bathroom**

Replace the `stepViews` fetch:
```ts
  const stepViews = await Promise.all(
    bathroomAreas.map(async (a) => ({
      area: a,
      view: await getAreaStepView(supabase, a.id),
      addableCatalog: await getAddableCatalogSteps(supabase, a.id),
      removedSteps: await getRemovedAreaSteps(supabase, a.id),
    })),
  );
```

- [ ] **Step 3: Pass the new props to the panel**

Replace the `stepViews.map(...)` render:
```tsx
            {stepViews.map(({ area, view, addableCatalog, removedSteps }) => (
              <AreaStepsPanel
                key={area.id}
                areaId={area.id}
                areaName={area.area_name}
                steps={view.steps}
                flags={view.flags}
                addableCatalog={addableCatalog}
                removedSteps={removedSteps}
              />
            ))}
```

- [ ] **Step 4: Typecheck, build, commit**

Run: `pnpm -C apps/web typecheck` → PASS.
Run: `pnpm -C apps/web build` → PASS (route `/project/[slug]/schedule` builds).
```bash
git add "apps/web/app/(app)/project/[slug]/schedule/page.tsx"
git commit -m "feat(schedule): wire add/remove step editing into the schedule page"
```

---

## Task 9: Browser verification (controller-run)

> Run by the controller, not a subagent — needs the dev server (worktree branch on a distinct port), an authenticated session, and the prod migration applied (Task 1 pushed via `supabase db push` from the worktree's `packages/db`, Wilson entering the DB password).

- [ ] Confirm the migration is on prod (or local stack the dev server points at) so `add_*_area_step` RPCs and `removed_at` exist; regenerate `--linked` types if the prod push changed them.
- [ ] Start the dev server; open `/project/ARCH-DHARMAHUSADA-C2-39-RUSDY/schedule`, expand the "Master Bathroom" panel.
- [ ] **Add custom:** "+ Tambah langkah" → "Baru" → name "Tes waterproofing ulang", type Pekerjaan → Tambah. Confirm it renders with its name, a "Belum mulai" chip, and (since it has no predecessors) can surface as "Siap dimulai".
- [ ] **Add catalog:** if any standard step is addable, "Dari rekomendasi" → pick one → Tambah; confirm it appears with its checkpoints in StepDetail.
- [ ] **Remove:** open a step → "Hapus langkah" → confirm; it drops from the list and the X/Y count, and appears under "Langkah dihapus (N)".
- [ ] **Restore:** "Langkah dihapus" → "Pulihkan"; the step returns to the list.
- [ ] Screenshot for the user. Verify no console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 data model → Task 1; §2 backend (mutations/RPCs/queries + flags refinement) → Tasks 1–4; §3 actions → Task 4; §4 UI → Tasks 5–8; §5 ordering (sort_order 900 + created_at tiebreak) → Tasks 1 & 3; §6 testing → Tasks 2,3 (unit) + 8 (build) + 9 (browser); §7 constraints → Global Constraints; §9 future hooks (source/created_by/project_id columns) → Task 1.
- **Type consistency:** `CatalogStep`/`RemovedStep` defined in Task 3, consumed in Tasks 4/5/7/8; `removeAreaStep`/`restoreAreaStep` (Task 4) consumed by actions (Task 4); RPC names `add_catalog_area_step`/`add_custom_area_step` consistent across Task 1 (DDL), Task 4 (`supabase.rpc`); `AreaStepsPanel` gains `areaId`/`addableCatalog`/`removedSteps` in Task 7, supplied in Task 8.
- **Ordering:** Task 1 (types) precedes Task 4 (RPC typing) and all TS tasks; Task 5 precedes Task 7 (imports `AddStepForm`); Task 3 precedes Tasks 7–8 (types/queries).
- **Known constraint:** custom steps have no deps/checkpoints/reordering this round (name+type only) — deferred per spec §9.
