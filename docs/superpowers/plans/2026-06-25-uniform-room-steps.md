# Uniform Phase-Based Readiness for All Rooms — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe Gate B from "Kamar Mandi" into the "Pekerjaan Basah / Waterproofing" phase, give every room a phase-tagged A–H readiness checklist seeded from a firm-standard library, and surface it on the Rooms page with an active-focused view + an AI-assistant entry point.

**Architecture:** A single DB migration renames Gate B, adds `trade_steps.applies_to_area_types`, retires the old B1–B11, seeds the reconciled ~84-step library (Appendix A of the spec) with deps, and generalizes `seed_area_steps` beyond bathroom/Gate-B. Backend pins (`getAddableCatalogSteps`, `add_catalog_area_step`, `writePlannedDates`) generalize off Gate B. The Rooms page (`RoomsView`→`RoomRow`) gains a per-room step panel (active-focused, phase-grouped) reusing the #22 editing; the schedule page drops its bathroom-only step section. The readiness rule engine is **unchanged** (verified generic).

**Tech Stack:** Next.js 16 App Router, React client components, Supabase (Postgres + RLS + SQL functions), `@datum/core`, Tailwind CSS-var theming, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-24-multi-room-readiness-steps-design.md` (Appendix A = the seed source).

## Global Constraints

- Reuse slice-2a-2/#22 conventions: `"use client"`, `useState`/`useTransition`/`useRouter`, server actions return `{ ok: true } | { ok: false; error: string }`, `router.refresh()` on success, `min-h-11 md:min-h-0` touch targets, CSS-var Tailwind, Bahasa Indonesia sentence-case, uncluttered (collapsed by default).
- The `gate_code` enum (`A`–`H`) is **unchanged**; only Gate B's *name/meaning* and the *step templates* change. `RULE_VERSION` stays `2`. No `evaluateGate`/`area_gate_status` logic change.
- Seed-by-room-type + prune: `applies_to_area_types` scopes by room; `applicability` jsonb keeps **floor-material** conditionals only (D6, H3); other ⟨…⟩ conditionals seed broadly.
- Custom-step scoping/RLS from #22 is unchanged (`project_id`/`source`, `trade_steps_custom_write`, `add_custom_area_step`).
- **Verify before each task:** `pnpm -C apps/web typecheck`. Pure logic → vitest TDD (`apps/web/tests/unit/**`). DB/UI → root `pnpm typecheck` + `pnpm test` (turbo, all workspaces incl. mobile) + `pnpm -C apps/web build`. Browser verification is controller-run (final task).
- Migration ordering: prod history must include `20260623000002` (readiness-reminder sync, PR #23) before pushing, or `db push` collides. Types regenerated from the applied schema (`supabase gen types --local`); prod `db push` is a controller/Wilson step.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/db/supabase/migrations/<ts>_uniform_room_steps.sql` | rename gate B; `trade_steps.applies_to_area_types`; deactivate old B1–B11; seed reconciled library + deps; generalize `seed_area_steps`, `add_catalog_area_step`, `add_custom_area_step` (gains `p_gate_code`) |
| `packages/db/src/types.generated.ts` | regenerated |
| `packages/core/src/gates/labels.ts` | `GATE_SHORT_NAME.B: "Kamar Mandi"` → `"Pekerjaan Basah"` (matrix label follows) |
| `apps/web/lib/steps/queries.ts` | generalize `getAddableCatalogSteps` off Gate B; add `gate_code` to `getAreaSteps`/`AreaStepRow`; add `groupStepsByGate`/`activeSteps`/`getRoomStepView` |
| `apps/web/lib/steps/mutations.ts` | generalize `writePlannedDates` to all gates |
| `apps/web/lib/steps/actions.ts` | `addCustomStep` gains `gateCode`; calls now hit the generalized RPCs |
| `apps/web/components/schedule/AddStepForm.tsx` | custom mode gains a phase (gate) `<select>` |
| `apps/web/components/schedule/StepDetail.tsx` | remove-confirm copy generalized off "kamar mandi" |
| `apps/web/components/rooms/RoomStepsPanel.tsx` | new: per-room active-focused, phase-grouped step view + editing reuse |
| `apps/web/components/rooms/RoomAssistantButton.tsx` | new: "Tanya asisten" entry point |
| `apps/web/components/rooms/RoomRow.tsx` | expand into `RoomStepsPanel` |
| `apps/web/app/(app)/project/[slug]/rooms/page.tsx` | fetch per-room step views (batched) |
| `apps/web/app/(app)/project/[slug]/schedule/page.tsx` | remove the bathroom-only step section |

---

## Task 1: DB migration — reframe Gate B, schema, seed library, generalize seeding

**Files:**
- Create: `packages/db/supabase/migrations/<ts>_uniform_room_steps.sql` (timestamp later than `20260624000001`, e.g. `20260625000001`)
- Modify: `packages/db/src/types.generated.ts` (regenerated)

**Interfaces:**
- Produces — `trade_steps.applies_to_area_types text[]`; gate `B.name='Pekerjaan Basah'`; deactivated old `B1`–`B11`; ~84 new firm-standard `trade_steps` rows (codes per Appendix A) + `trade_step_deps`; generalized `seed_area_steps(area_id)` (all gates, area-type + finish applicability); generalized `add_catalog_area_step(area_id, step_code)` (any applicable gate, not just B).

- [ ] **Step 1: Write the migration — schema + reframe**

Create the migration file. Start with the additive schema + the gate rename + retiring old B steps:
```sql
-- Uniform phase-based readiness for all rooms: reframe Gate B → wet-works,
-- add room-type scoping, seed the reconciled A–H step library, generalize seeding.

-- 1. Room-type scoping on the firm-standard step library.
alter table public.trade_steps
  add column if not exists applies_to_area_types text[];  -- NULL = all room types

-- 2. Reframe Gate B from "Kamar Mandi" to the wet-works phase.
update public.gates set name = 'Pekerjaan Basah / Waterproofing' where code = 'B';

-- 3. Retire the old bundled bathroom steps (their content is redistributed below
--    into B-wet / D / G). Deactivate (don't delete) — area_steps may FK-reference them.
update public.trade_steps set active = false
  where project_id is null and code in ('B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11');
```

- [ ] **Step 2: Write the migration — seed the reconciled library**

Append the firm-standard seed. **Transcribe every row from the spec's Appendix A** (gates A, B-wet, C, D, E, F, G, H) using exactly this column order and `applies_to_area_types` mapping (rooms key `allint`→`'{bathroom,living,kitchen,bedroom,general}'`, `+grd` adds `garden`; a step listing specific rooms uses just those). Floor-material conditionals (D6, H3) carry `applicability`; all other rows use `'{}'`.

Pattern (showing 3 representative rows — transcribe **all** Appendix-A rows verbatim; Appendix A already uses collision-safe codes: `A1…A11, BW1…BW4` (wet-works), `C1…C11, D1…D10, E1…E12, F1…F11, G1…G15, H1…H11`. The deactivated old bathroom rows are `B1…B11`, so the `BW*` codes don't collide — verify no *active* code collides):
```sql
insert into public.trade_steps
  (code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability, applies_to_area_types, active, project_id, source)
values
  ('A1','A','Koordinasi MEP & sign-off shop drawing','decision','desainer',3,5,1,'{}'::jsonb,'{bathroom,living,kitchen,bedroom,general,garden}',true,null,'standard'),
  ('BW1','B','Booking aplikator waterproofing','procurement','aplikator_wp',1,7,1,'{}'::jsonb,'{bathroom,kitchen,general}',true,null,'standard'),
  ('D6','D','Pasang lantai (keramik/marmer/vinyl/parket)','site_work','tukang_lantai',6,0,6,'{"lantai":["marmer","batu","keramik","vinyl","parket"]}'::jsonb,'{bathroom,living,kitchen,bedroom,general}',true,null,'standard')
  -- … transcribe ALL remaining Appendix-A rows (A2–A11, BW2–BW4, C1–C11, D1–D10, E1–E12, F1–F11, G1–G15, H1–H11) …
;
```
> The implementer transcribes the full ~84-row set from Appendix A. `sort_order` = the per-gate ordinal in Appendix A; display order is `(gate_code, sort_order)`. Codes are used verbatim from Appendix A (wet-works is already `BW1–BW4`, under `gate_code='B'`).

- [ ] **Step 3: Write the migration — dependencies**

Append `trade_step_deps` from each Appendix-A row's `preds` column (within-gate). Pattern:
```sql
insert into public.trade_step_deps (step_code, predecessor_code) values
  ('A11','A9'),
  ('BW2','BW1'), ('BW3','BW2'), ('BW4','BW3'),
  ('D6','D3'), ('D6','D5'), ('D9','D6'), ('D9','D7'), ('D10','D6'), ('D10','D8'), ('D10','D9')
  -- … transcribe every (step, predecessor) pair from Appendix A …
on conflict do nothing;
```

- [ ] **Step 4: Write the migration — generalize `seed_area_steps`**

Replace the function to seed across all gates by room-type + finish applicability (drop the `area_type='bathroom'` and `gate_code='B'` filters):
```sql
create or replace function public.seed_area_steps(p_area_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid; v_area_type text; v_finish jsonb;
  v_step record; v_new_id uuid; v_ok boolean; v_key text; v_allowed jsonb; v_value text;
begin
  select project_id, area_type::text, finish_profile
    into v_project_id, v_area_type, v_finish
    from public.areas where id = p_area_id;
  if v_project_id is null then return; end if;

  for v_step in
    select * from public.trade_steps
    where active and project_id is null
      and (applies_to_area_types is null or v_area_type = any(applies_to_area_types))
    order by gate_code, sort_order
  loop
    v_ok := true;
    for v_key, v_allowed in select * from jsonb_each(v_step.applicability)
    loop
      v_value := coalesce(v_finish ->> v_key, null);
      if v_value is null or not (v_allowed ? v_value) then v_ok := false; end if;
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
      from public.trade_step_checkpoints t where t.step_code = v_step.code;
    end if;
  end loop;
end;
$$;
```

- [ ] **Step 5: Write the migration — generalize `add_catalog_area_step` + `add_custom_area_step`**

Replace the RPC's Gate-B validation with room-type applicability (so the catalog picker works for any room):
```sql
create or replace function public.add_catalog_area_step(p_area_id uuid, p_step_code text)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_project_id uuid; v_area_type text; v_step_id uuid;
begin
  select project_id, area_type::text into v_project_id, v_area_type
    from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;

  if not exists (
    select 1 from public.trade_steps
    where code = p_step_code and project_id is null and active
      and (applies_to_area_types is null or v_area_type = any(applies_to_area_types))
  ) then
    raise exception 'not an applicable standard step: %', p_step_code;
  end if;

  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, p_step_code)
  on conflict (area_id, step_code) do nothing
  returning id into v_step_id;

  if v_step_id is not null then
    insert into public.area_step_checkpoints
      (area_step_id, project_id, item_text, severity, required, sort_order)
    select v_step_id, v_project_id, t.item_text, t.default_severity, t.required, t.sort_order
    from public.trade_step_checkpoints t where t.step_code = p_step_code;
  end if;
  return v_step_id;
end;
$$;
revoke all on function public.add_catalog_area_step(uuid, text) from public;
grant execute on function public.add_catalog_area_step(uuid, text) to authenticated;
```

Then generalize `add_custom_area_step` to accept the phase (it currently hard-codes `gate_code='B'`). Drop the old 3-arg version and create the 4-arg one:
```sql
drop function if exists public.add_custom_area_step(uuid, text, text);
create or replace function public.add_custom_area_step(p_area_id uuid, p_name text, p_step_type text, p_gate_code text default 'H')
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_project_id uuid; v_code text; v_step_id uuid;
begin
  select project_id into v_project_id from public.areas where id = p_area_id;
  if v_project_id is null then raise exception 'area not found'; end if;
  if not exists (select 1 from public.gates where code = p_gate_code) then
    raise exception 'unknown gate: %', p_gate_code;
  end if;
  v_code := 'cst_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.trade_steps
    (code, gate_code, name, step_type, source, project_id, created_by, sort_order, applicability, active)
  values
    (v_code, p_gate_code, btrim(p_name), p_step_type, 'custom', v_project_id, auth.uid(), 900, '{}'::jsonb, true);
  insert into public.area_steps (area_id, project_id, step_code)
  values (p_area_id, v_project_id, v_code) returning id into v_step_id;
  return v_step_id;
end;
$$;
revoke all on function public.add_custom_area_step(uuid, text, text, text) from public;
grant execute on function public.add_custom_area_step(uuid, text, text, text) to authenticated;
```

- [ ] **Step 6: Apply locally, smoke-test, regenerate types**

Run from `packages/db/` (local Supabase; remap ports if SANO/Data_Price_Memory hold them — see `datum-supabase-cli-gotcha`): `supabase start -x logflare,vector,studio,realtime,storage-api,imgproxy,edge-runtime,pgbouncer,mailpit` then `supabase db reset`.
Smoke via `docker exec supabase_db_db psql -U postgres -d postgres -c "…"`:
- `select count(*) from trade_steps where project_id is null and active;` → ~84.
- `select name from gates where code='B';` → `Pekerjaan Basah / Waterproofing`.
- `select count(*) from trade_steps where active and code in ('B1','B11');` → 0 (old retired).
- Insert a test living-room area, `select seed_area_steps('<id>')`, then count its `area_steps` → the A/C/D/E/F/G/H steps applicable to `living` (no wet-works B unless wet).
Then `supabase gen types typescript --local > src/types.generated.ts`; `supabase stop`; `git checkout -- supabase/config.toml` (revert the port remap).

- [ ] **Step 7: Typecheck + commit**

Run (root): `pnpm typecheck` → PASS.
```bash
git add packages/db/supabase/migrations/<ts>_uniform_room_steps.sql packages/db/src/types.generated.ts
git commit -m "feat(db): reframe Gate B to wet-works + seed uniform A–H room step library + generalize seeding"
```

---

## Task 2: Reframe the Gate-B label + generalize the backend pins

**Files:**
- Modify: `packages/core/src/gates/labels.ts`
- Modify: `apps/web/lib/steps/queries.ts` (`getAddableCatalogSteps`)
- Modify: `apps/web/lib/steps/mutations.ts` (`writePlannedDates`)
- Test: `apps/web/tests/unit/step-addable.test.ts` (extend if needed — pure helper unchanged)

**Interfaces:**
- Consumes — `applies_to_area_types`, generalized `add_catalog_area_step` (Task 1).
- Produces — `getAddableCatalogSteps` returns applicable-by-room-type steps; `writePlannedDates` plans all gates.

- [ ] **Step 1: Rename the gate label**

In `packages/core/src/gates/labels.ts`, change the `B` entry of `GATE_SHORT_NAME` (the matrix renders via `gateShortName`, so this flips the column label automatically):
```ts
  B: "Pekerjaan Basah",
```

- [ ] **Step 2: Generalize `getAddableCatalogSteps`**

In `apps/web/lib/steps/queries.ts`, the catalog query currently pins `.eq("gate_code", "B")`. Replace the `trade_steps` fetch to select firm-standard active steps applicable to the area's `area_type` (fetch the area's `area_type` first):
```ts
export async function getAddableCatalogSteps(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<CatalogStep[]> {
  const { data: area } = await supabase.from("areas").select("area_type").eq("id", areaId).single();
  const areaType = area?.area_type ?? null;
  const [{ data: existing, error: e1 }, { data: catalog, error: e2 }] = await Promise.all([
    supabase.from("area_steps").select("step_code").eq("area_id", areaId),
    supabase.from("trade_steps").select("code, name, applies_to_area_types")
      .eq("active", true).is("project_id", null).order("gate_code").order("sort_order"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const applicable = (catalog ?? []).filter((c) => {
    const types = (c.applies_to_area_types as string[] | null) ?? null;
    return types === null || (areaType !== null && types.includes(areaType));
  });
  return addableCatalog(
    applicable.map((c) => ({ code: c.code, name: c.name })),
    (existing ?? []).map((r) => r.step_code),
  );
}
```

- [ ] **Step 3: Generalize `writePlannedDates`**

In `apps/web/lib/steps/mutations.ts`, `writePlannedDates` currently computes planned windows for `gate_code='B'` from the area's Gate-B target window. Generalize to **every gate**: for each gate that has a target window on `area_gate_status`, back-schedule that gate's steps. Replace the function body to loop gates:
```ts
export async function writePlannedDates(
  supabase: SupabaseClient<Database>,
  areaId: string,
): Promise<void> {
  const { data: gates } = await supabase
    .from("area_gate_status")
    .select("gate_code, target_start_date, target_end_date")
    .eq("area_id", areaId);
  const { data: deps } = await supabase
    .from("trade_step_deps").select("step_code, predecessor_code");

  for (const g of gates ?? []) {
    if (!g.target_start_date || !g.target_end_date) continue;
    const { data: tmpl } = await supabase
      .from("trade_steps")
      .select("code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applicability")
      .eq("gate_code", g.gate_code).eq("active", true).is("project_id", null);
    const plan = backScheduleSteps(
      (tmpl ?? []) as unknown as TradeStepTemplate[],
      (deps ?? []) as TradeStepDep[],
      { start: g.target_start_date, end: g.target_end_date },
    );
    for (const [code, win] of plan) {
      await supabase.from("area_steps")
        .update({ planned_start: win.planned_start, planned_end: win.planned_end })
        .eq("area_id", areaId).eq("step_code", code);
    }
  }
}
```

- [ ] **Step 4: Let custom steps pick their phase (gate)**

#22's `add_custom_area_step` hard-codes `gate_code='B'`; with the reframe that drops every custom step into wet-works. Task 1 added `p_gate_code` to the RPC (default `'H'`). Thread the chosen gate through the action + form.

In `apps/web/lib/steps/actions.ts`, extend `addCustomStep`:
```ts
export async function addCustomStep(args: {
  areaId: string;
  name: string;
  stepType: "decision" | "procurement" | "site_work" | "inspection";
  gateCode: string;
}): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk menambah langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("add_custom_area_step", {
      p_area_id: args.areaId, p_name: args.name, p_step_type: args.stepType, p_gate_code: args.gateCode,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

In `apps/web/components/schedule/AddStepForm.tsx`, add a phase `<select>` to the custom mode (import `GATE_SHORT_NAME` from `@datum/core`), default `gateCode='D'`, and pass it to `addCustomStep`:
```tsx
import { GATE_SHORT_NAME } from "@datum/core";
// …inside the component, with the other useState calls:
const [gateCode, setGateCode] = useState("D");
// …in the custom branch, next to the step-type <select>:
<select value={gateCode} disabled={pending} onChange={(e) => setGateCode(e.target.value)}
  className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] md:min-h-0">
  {Object.entries(GATE_SHORT_NAME).map(([code, label]) => (
    <option key={code} value={code}>{code} · {label}</option>
  ))}
</select>
// …and the add handler:
onClick={() => run(() => addCustomStep({ areaId, name: name.trim(), stepType, gateCode }))}
```

- [ ] **Step 5: Typecheck (web + core) + commit**

Run: `pnpm -C packages/core typecheck && pnpm -C apps/web typecheck` → PASS.
```bash
git add packages/core/src/gates/labels.ts apps/web/lib/steps/queries.ts apps/web/lib/steps/mutations.ts apps/web/lib/steps/actions.ts apps/web/components/schedule/AddStepForm.tsx
git commit -m "feat(steps): reframe Gate-B label + generalize catalog/planned-dates + custom-step phase picker"
```

---

## Task 3: Per-room gate-grouped step view query

**Files:**
- Modify: `apps/web/lib/steps/queries.ts`
- Test: `apps/web/tests/unit/step-room-grouping.test.ts` (create)

**Interfaces:**
- Consumes — `getAreaStepView`, `getAddableCatalogSteps`, `getRemovedAreaSteps` (existing); `gateShortName`/`GATE_SHORT_NAME` (`@datum/core`, verified exported at `packages/core/src/index.ts`).
- Produces — `AreaStepRow` gains `gate_code: string`; pure `groupStepsByGate(steps): { gate: string; gateName: string; steps: AreaStepRow[]; done: number }[]` (grouped by real `gate_code`, ordered A→H) and `activeSteps(steps, flags): AreaStepRow[]`; `getRoomStepView(sb, areaId): Promise<{ steps, flags, addableCatalog, removedSteps, grouped, active }>`.

- [ ] **Step 1: Add `gate_code` to `getAreaSteps` + `AreaStepRow`**

Grouping must use the real gate, not a code prefix — custom steps are `cst_<uuid>` and wet-works are `BW*`, so a prefix heuristic mis-buckets them. In `apps/web/lib/steps/queries.ts`:
- Add `gate_code: string;` to the `AreaStepRow` type (after `step_type`).
- In `getAreaSteps`, extend the template join select from `trade_steps:step_code (sort_order, step_type, name)` to `trade_steps:step_code (sort_order, step_type, name, gate_code)`.
- In the `.map`, widen the `tmpl` cast to include `gate_code: string` and add `gate_code: tmpl?.gate_code ?? "?",` to the returned object.

- [ ] **Step 2: Write failing tests for the pure groupers**

Create `apps/web/tests/unit/step-room-grouping.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupStepsByGate, activeSteps } from "@/lib/steps/queries";

const mk = (id: string, gate: string, code: string, status: string) => ({
  id, step_code: code, name: code, step_type: "site_work", gate_code: gate, status,
  planned_start: null, planned_end: null, assigned_trade: null,
  blocking_reason: null, last_progress_at: null, checkpoints: [],
});

describe("groupStepsByGate", () => {
  it("groups by gate_code, ordered A→H, with done counts; custom cst_ codes group by their gate", () => {
    const steps = [mk("1","A","A1","accepted"), mk("2","A","A2","not_started"),
                   mk("3","D","cst_abc","not_started"), mk("4","D","D1","not_started")];
    const g = groupStepsByGate(steps as never);
    expect(g.map((x) => x.gate)).toEqual(["A", "D"]);
    expect(g[0]!.done).toBe(1);
    expect(g[1]!.steps.map((s) => s.step_code)).toEqual(["cst_abc", "D1"]);
  });
});

describe("activeSteps", () => {
  it("returns in_progress/blocked steps plus the readyToStart step", () => {
    const steps = [mk("1","A","A1","in_progress"), mk("2","A","A2","not_started"), mk("3","A","A3","accepted")];
    const out = activeSteps(steps as never, { readyToStart: "A2", needsDecision: [], blocked: [] });
    expect(out.map((s) => s.step_code).sort()).toEqual(["A1", "A2"]);
  });
});
```

- [ ] **Step 3: Run → FAIL**

Run: `pnpm -C apps/web test -- step-room-grouping`
Expected: FAIL — `groupStepsByGate`/`activeSteps` not exported.

- [ ] **Step 4: Implement the groupers + `getRoomStepView`**

In `apps/web/lib/steps/queries.ts` add (import `gateShortName` from `@datum/core`):
```ts
import { gateShortName } from "@datum/core";

/** Group steps by their real gate_code, in A→H order, with done counts. */
export function groupStepsByGate(steps: AreaStepRow[]): { gate: string; gateName: string; steps: AreaStepRow[]; done: number }[] {
  const order: string[] = [];
  const byGate = new Map<string, AreaStepRow[]>();
  for (const s of steps) {
    const gate = s.gate_code || "?";
    if (!byGate.has(gate)) { byGate.set(gate, []); order.push(gate); }
    byGate.get(gate)!.push(s);
  }
  order.sort((a, b) => a.localeCompare(b)); // A→H
  return order.map((gate) => {
    const gs = byGate.get(gate)!;
    const done = gs.filter((s) => s.status === "accepted" || s.status === "done_with_defects").length;
    return { gate, gateName: gateShortName(gate), steps: gs, done };
  });
}

/** The steps worth acting on now: in_progress/blocked/stalled + the readyToStart step. */
export function activeSteps(steps: AreaStepRow[], flags: AreaFlags): AreaStepRow[] {
  return steps.filter((s) =>
    s.status === "in_progress" || s.status === "blocked" || s.status === "stalled" || s.step_code === flags.readyToStart);
}

/** Everything the Rooms-page per-room panel needs. */
export async function getRoomStepView(supabase: SupabaseClient<Database>, areaId: string) {
  const [view, addableCatalog, removedSteps] = await Promise.all([
    getAreaStepView(supabase, areaId),
    getAddableCatalogSteps(supabase, areaId),
    getRemovedAreaSteps(supabase, areaId),
  ]);
  return { ...view, addableCatalog, removedSteps, grouped: groupStepsByGate(view.steps), active: activeSteps(view.steps, view.flags) };
}
```
> `AreaFlags` is already imported in this file (`import { computeAreaFlags, type AreaFlags } from "@/lib/steps/flags"`).

- [ ] **Step 5: Tests + typecheck → PASS, commit**

Run: `pnpm -C apps/web test -- step-room-grouping` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/steps/queries.ts apps/web/tests/unit/step-room-grouping.test.ts
git commit -m "feat(steps): per-room gate-grouped + active-step view (getRoomStepView)"
```

---

## Task 4: `RoomStepsPanel` — active-focused, phase-grouped, editing reuse

**Files:**
- Create: `apps/web/components/rooms/RoomStepsPanel.tsx`

**Interfaces:**
- Consumes — `getRoomStepView` result (`grouped`, `active`, `flags`, `addableCatalog`, `removedSteps`); `StepDetail`, `AddStepForm` (existing, #22); `restoreStep` (actions).
- Produces — `<RoomStepsPanel areaId areaName view />` where `view` = `Awaited<ReturnType<typeof getRoomStepView>>`.

- [ ] **Step 1: Write the component**

Create `apps/web/components/rooms/RoomStepsPanel.tsx`. Default shows `flags` ("Perlu perhatian") + the `active` steps (each tappable into `StepDetail`); a "Lihat semua langkah" toggle reveals the `grouped` phase sub-sections (collapsible, done/total), plus the `AddStepForm` and the "Langkah dihapus" restore list (reuse the #22 `AreaStepsPanel` patterns):
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StepDetail } from "@/components/schedule/StepDetail";
import { AddStepForm } from "@/components/schedule/AddStepForm";
import { restoreStep } from "@/lib/steps/actions";
import type { getRoomStepView } from "@/lib/steps/queries";

type View = Awaited<ReturnType<typeof getRoomStepView>>;
const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  blocked: { label: "Terblokir", cls: "bg-red-100 text-red-800" },
  stalled: { label: "Mandek", cls: "bg-red-100 text-red-800" },
  accepted: { label: "Selesai", cls: "bg-green-100 text-green-800" },
  done_with_defects: { label: "Selesai (ada defect)", cls: "bg-amber-100 text-amber-800" },
};

export function RoomStepsPanel({ areaId, areaName, view }: { areaId: string; areaName: string; view: View }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const nameOf = (code: string | null) => view.steps.find((s) => s.step_code === code)?.name ?? code;

  function restore(areaStepId: string) {
    startTransition(async () => { const r = await restoreStep({ areaStepId }); if (r.ok) router.refresh(); });
  }

  function StepRow({ s }: { s: View["steps"][number] }) {
    const chip = (CHIP[s.status] || CHIP.not_started)!;
    const isOpen = openStep === s.id;
    const dimmed = s.status === "accepted" || s.status === "done_with_defects";
    return (
      <div key={s.id}>
        <button type="button" onClick={() => setOpenStep(isOpen ? null : s.id)}
          className={`flex w-full items-center gap-2.5 border-t border-[var(--border)] px-4 py-2.5 text-left ${dimmed ? "opacity-60" : ""}`}>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
          <span className="text-[13px] text-[var(--foreground)]">{s.name}</span>
          <span className="flex-1" />
          {view.flags.readyToStart === s.step_code ? <span className="text-[10px] text-[var(--sand-dark)]">siap</span> : null}
          <span className="text-[var(--text-muted)]">{isOpen ? "▾" : "▸"}</span>
        </button>
        {isOpen ? <StepDetail step={s} /> : null}
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--border)]">
      {view.flags.readyToStart || view.flags.needsDecision.length > 0 ? (
        <div className="bg-[var(--sand-tint)] px-4 py-2 text-[11px] text-[var(--sand-dark)]">
          {view.flags.readyToStart ? <span className="mr-3">Siap dimulai: {nameOf(view.flags.readyToStart)}</span> : null}
          {view.flags.needsDecision.length > 0 ? <span>Perlu keputusan: {view.flags.needsDecision.map(nameOf).join(", ")}</span> : null}
        </div>
      ) : null}

      {!showAll ? (
        <>
          {view.active.length > 0
            ? view.active.map((s) => <StepRow key={s.id} s={s} />)
            : <p className="border-t border-[var(--border)] px-4 py-3 text-[12px] text-[var(--text-muted)]">Tidak ada langkah aktif.</p>}
          <button type="button" onClick={() => setShowAll(true)}
            className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2.5 text-left text-[12px] font-semibold text-[var(--sand-dark)] hover:bg-[var(--sand-tint)] md:min-h-0">
            Lihat semua langkah ({view.steps.length})
          </button>
        </>
      ) : (
        <>
          {view.grouped.map((g) => (
            <details key={g.gate} className="border-t border-[var(--border)]" open={g.steps.some((s) => view.active.includes(s))}>
              <summary className="min-h-11 cursor-pointer px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] md:min-h-0">
                {g.gate} · {g.gateName} — {g.done}/{g.steps.length}
              </summary>
              {g.steps.map((s) => <StepRow key={s.id} s={s} />)}
            </details>
          ))}
          <AddStepForm areaId={areaId} addableCatalog={view.addableCatalog} />
          {view.removedSteps.length > 0 ? (
            <div className="border-t border-[var(--border)]">
              <button type="button" onClick={() => setShowRemoved((v) => !v)}
                className="min-h-11 w-full px-4 py-2.5 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
                Langkah dihapus ({view.removedSteps.length}) <span>{showRemoved ? "▾" : "▸"}</span>
              </button>
              {showRemoved ? view.removedSteps.map((r) => (
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
          <button type="button" onClick={() => setShowAll(false)}
            className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2.5 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
            ▴ Tampilkan ringkas
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Generalize the shared `StepDetail` remove copy**

`StepDetail` (reused here for every room) has a bathroom-specific confirm. In `apps/web/components/schedule/StepDetail.tsx`, change:
```tsx
    if (!window.confirm("Hapus langkah ini dari kamar mandi? Bisa dipulihkan nanti.")) return;
```
to:
```tsx
    if (!window.confirm("Hapus langkah ini dari ruang ini? Bisa dipulihkan nanti.")) return;
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/rooms/RoomStepsPanel.tsx apps/web/components/schedule/StepDetail.tsx
git commit -m "feat(rooms): RoomStepsPanel — active-focused + phase-grouped step view"
```

---

## Task 5: AI-assistant entry point

**Files:**
- Create: `apps/web/components/rooms/RoomAssistantButton.tsx`

**Interfaces:**
- Consumes — the room's `view` (steps/flags) for context; the existing assistant open mechanism (verify: `ChatDock` open handler or `/api/assistant`).
- Produces — `<RoomAssistantButton areaName view />` (client).

- [ ] **Step 1: Verify the assistant open mechanism**

Inspect `apps/web/components/chat/ChatDock.tsx` for how it opens / accepts an initial message (e.g. an exported store/action, a `sendPrompt`, or a URL param). Note the exact entry point. If none accepts a seeded prompt, the button falls back to copying a ready prompt to the clipboard.

- [ ] **Step 2: Write the component**

Create `apps/web/components/rooms/RoomAssistantButton.tsx`. Build a compact Bahasa-Indonesia context string from the room's steps (ready / blocked / lead-time-critical procurement) + a scheduling/next-to-do prompt, then open the assistant via the mechanism found in Step 1 (shown here with a clipboard fallback):
```tsx
"use client";

import type { getRoomStepView } from "@/lib/steps/queries";

type View = Awaited<ReturnType<typeof getRoomStepView>>;

function buildPrompt(areaName: string, view: View): string {
  const ready = view.flags.readyToStart ? view.steps.find((s) => s.step_code === view.flags.readyToStart)?.name : null;
  const blocked = view.steps.filter((s) => s.status === "blocked" || s.status === "stalled").map((s) => s.name);
  const procurement = view.steps.filter((s) => s.step_type === "procurement" && s.status === "not_started").map((s) => s.name);
  return [
    `Bantu saya soal jadwal & langkah berikutnya untuk ruang "${areaName}".`,
    ready ? `Siap dimulai: ${ready}.` : null,
    blocked.length ? `Terblokir: ${blocked.join(", ")}.` : null,
    procurement.length ? `Perlu diorder (lead time): ${procurement.join(", ")}.` : null,
    `Apa urutan terbaik dan apa yang harus saya kerjakan/putuskan minggu ini?`,
  ].filter(Boolean).join(" ");
}

export function RoomAssistantButton({ areaName, view }: { areaName: string; view: View }) {
  function open() {
    const prompt = buildPrompt(areaName, view);
    // Step-1 finding wires the real open here; clipboard fallback otherwise:
    if (typeof window !== "undefined" && (window as unknown as { __openAssistant?: (p: string) => void }).__openAssistant) {
      (window as unknown as { __openAssistant: (p: string) => void }).__openAssistant(prompt);
    } else {
      void navigator.clipboard?.writeText(prompt);
    }
  }
  return (
    <button type="button" onClick={open}
      className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] md:min-h-0">
      Tanya asisten: jadwal & langkah berikutnya
    </button>
  );
}
```
> Replace the `__openAssistant` shim with the real `ChatDock` entry point found in Step 1; if the assistant can't accept a seeded prompt yet, keep the clipboard fallback and note it for the later AI scheduling piece.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/rooms/RoomAssistantButton.tsx
git commit -m "feat(rooms): Tanya asisten entry point seeded with room step context"
```

---

## Task 6: Wire the Rooms page (RoomRow expand + page fetch)

**Files:**
- Modify: `apps/web/components/rooms/RoomRow.tsx`
- Modify: `apps/web/app/(app)/project/[slug]/rooms/page.tsx`

**Interfaces:**
- Consumes — `getRoomStepView` (Task 3), `RoomStepsPanel` (Task 4), `RoomAssistantButton` (Task 5).

- [ ] **Step 1: Fetch per-room step views on the page (batched)**

In `apps/web/app/(app)/project/[slug]/rooms/page.tsx`, after `getProjectRooms`, batch-fetch each room's step view and pass a map to `RoomsView`:
```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRoomStepView } from "@/lib/steps/queries";
// …
const supabase = await createSupabaseServerClient();
const stepViews = new Map(
  await Promise.all(
    data.rooms.map(async (r) => [r.areaId, await getRoomStepView(supabase, r.areaId)] as const),
  ),
);
return <RoomsView data={data} now={Date.now()} stepViews={stepViews} />;
```
Thread `stepViews` through `RoomsView` → each `RoomRow` (add the prop to both component signatures).

- [ ] **Step 2: Expand `RoomRow` into the panel**

In `apps/web/components/rooms/RoomRow.tsx`, add an expand toggle that renders `<RoomStepsPanel areaId={room.areaId} areaName={room.areaName} view={view} />` + `<RoomAssistantButton areaName={room.areaName} view={view} />` when expanded (only if `view` has steps). Keep the existing read-only glance as the collapsed header.

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add "apps/web/app/(app)/project/[slug]/rooms/page.tsx" apps/web/components/rooms/RoomRow.tsx
git commit -m "feat(rooms): expand each room into its step panel + assistant button"
```

---

## Task 7: Remove the bathroom-only step section from the schedule page

**Files:**
- Modify: `apps/web/app/(app)/project/[slug]/schedule/page.tsx`

- [ ] **Step 1: Drop the step section + its fetches**

Remove the `stepViews`/`stepEventsMap` fetch block and the `{stepViews.length > 0 ? (<section>… Langkah pekerjaan — kamar mandi …</section>) : null}` render (per-room checklists now live on the Rooms page). Keep `SignalSummaryPanel`, the matrix, Gantt, and targets. Remove now-unused imports (`getAreaStepView`, `getRemovedAreaSteps`, `getAddableCatalogSteps`, `getAreaStepEvents`, `AreaStepsPanel`).

- [ ] **Step 2: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add "apps/web/app/(app)/project/[slug]/schedule/page.tsx"
git commit -m "refactor(schedule): move per-room step checklists to the Rooms page"
```

---

## Task 8: Backfill existing areas (controller-run)

> Controller-run; needs the migration on the target DB.

- [ ] After Task 1's migration is applied (local for verification; prod via `supabase db push`), re-seed every existing area so current projects' rooms get their checklist:
```sql
do $$ declare a record; begin
  for a in select id from public.areas loop
    perform public.seed_area_steps(a.id);
  end loop;
end $$;
```
- [ ] Spot-check: the live bathroom (Dharmahusada) now has its steps under D (tiling) / G (sanitair) / B (wet-works) rather than the retired B1–B11; a living room has A/C/D/E/F/G/H steps.

---

## Task 9: Browser verification (controller-run)

> Controller-run; needs the prod migration + backfill + an authed session.

- [ ] Open `/project/<CODE>/rooms`; expand a **non-bathroom** room (e.g. a living room) → active-focused view shows flags + ready/in-progress; "Lihat semua langkah" reveals A–H phase groups with names.
- [ ] Expand the **bathroom** → its steps now appear under Pekerjaan Basah / D / G (not the old B bundle); "Kamar Mandi" label is gone (matrix column reads "Pekerjaan Basah").
- [ ] Add a custom step + a catalog step (any room); remove + restore one — confirm #22 editing works per room.
- [ ] Click "Tanya asisten" → assistant opens with the room's step context (or the prompt is copied, per Task 5).
- [ ] Confirm the schedule page no longer shows the per-room step section but still shows the signal summary + matrix.
- [ ] Screenshot for the user. No console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** Part 0 reframe → Task 1 (rename + retire + re-seed) + Task 2 (label + pins); §1 schema/seeding → Task 1; §2 content → Task 1 (Appendix A); §3 screen → Tasks 4 (panel) + 6 (wiring) + 7 (schedule cleanup) + 5 (AI); §4 reuse → Tasks 2/3 (generalized catalog) + 8 (backfill); rule-engine-unchanged honored (no rule task).
- **Type consistency:** `getRoomStepView` (Task 3) consumed by Tasks 4/5/6; `groupStepsByGate`/`activeSteps` defined Task 3, used Task 4; `AreaStepRow.gate_code` added Task 3, drives grouping; `applies_to_area_types` defined Task 1, consumed Tasks 2/3; `gateShortName`/`GATE_SHORT_NAME` confirmed exported (`packages/core/src/index.ts:265`); `addCustomStep({…, gateCode})` (Task 2) matches `add_custom_area_step(…, p_gate_code)` (Task 1).
- **Grounded against source:** `AreaStepRow`/`AreaFlags`/`StepStatus`/`restoreStep`/`StepDetail`(`{step, events?}`)/`AddStepForm`(`{areaId, addableCatalog}`)/`backScheduleSteps` all verified in code; custom steps are `cst_<uuid>` (so grouping is by `gate_code`, not code-prefix).
- **Known follow-ups:** AI deep scheduling intelligence + the firm-standard library management UI (Piece B, incl. drag-reorder) are out of scope; per-step checkpoints deferred; per-room step history (events) omitted from the Rooms panel for load (StepDetail renders `events=[]`).
- **Verify-during-impl flags:** the `ChatDock` open mechanism (Task 5 Step 1); confirm no active `trade_steps.code` collides with the reconciled seed codes (Task 1 Step 2); confirm `writePlannedDates`' caller + that `area_gate_status` carries per-gate target windows (Task 2 Step 3).
