# Firm-Standard Step Library Management (Piece B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give principal/admin users a firm-wide "Pustaka Langkah" page to manage the firm-standard step library — edit fields, reorder within a gate, activate/deactivate, and add new standard steps — through an admin-gated write path.

**Architecture:** A migration adds audit columns + a `current_can_manage_projects()`-gated RLS write path + four `SECURITY INVOKER` RPCs on `trade_steps`. A new server query fetches the firm-standard library grouped by gate; server actions (gated again in-app via `canManageAccess`) wrap the RPCs; a new admin-gated page renders gate-grouped editable sections. Edits affect future seeding only (opt-in-pull); existing `area_steps` are untouched.

**Tech Stack:** Next.js 16 App Router, React client components, Supabase (Postgres + RLS + SQL functions), `@datum/core`, Tailwind CSS-var theming, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-26-step-library-management-design.md`

## Global Constraints

- **Edit access = `current_can_manage_projects()` (principal/admin).** RLS gates DB writes; every RPC re-checks it; every server action re-checks `canManageAccess(staff)`; the page 403s/redirects non-managers. Defence in depth.
- Reuse conventions: server actions return `{ ok: true } | { ok: false; error: string }`; `"use client"` editors with `useState`/`useTransition`/`useRouter` + `router.refresh()` on success; `min-h-11 md:min-h-0` touch targets; CSS-var Tailwind; Bahasa Indonesia sentence-case.
- **Deactivate, never delete** — no DELETE grant/policy; `active=false` only.
- **Opt-in-pull:** Piece B mutates `trade_steps` templates only; never rewrites existing `area_steps`. The page shows the propagation banner verbatim (Task 6).
- Firm-standard rows = `project_id IS NULL AND source = 'standard'`. New steps get `std_<uuid>` codes (internal; grouping is by `gate_code`). Valid `area_type`s: `bathroom, kitchen, bedroom, living, dining, garden, circulation, utility, general`. Step types: `decision, procurement, site_work, inspection`.
- **Verify per task:** `pnpm -C apps/web typecheck`; pure logic → vitest TDD; root `pnpm typecheck` + `pnpm test` (turbo, ALL workspaces incl. mobile) + `pnpm -C apps/web build` before any push. Migration apply + authoritative `gen types --local` + prod `db push` are controller/Wilson steps (local stack ports are held by other projects — types committed as a hand-edited stopgap, same as Piece A).

## File structure

| File | Responsibility |
| --- | --- |
| `packages/db/supabase/migrations/<ts>_step_library_mgmt.sql` | `updated_by`/`updated_at` cols; `trade_steps_standard_insert`/`_update` RLS; 4 RPCs; grants |
| `packages/db/src/types.generated.ts` | regenerated (cols + RPC signatures) — stopgap edit |
| `apps/web/lib/library/queries.ts` | `StandardStep` type, pure `groupStandardLibrary`, `getStandardLibrary` |
| `apps/web/lib/library/actions.ts` | `updateStandardStep` / `setStandardStepActive` / `reorderStandardSteps` / `addStandardStep` |
| `apps/web/components/library/StepLibraryView.tsx` | gate-grouped sections + reorder/activate + inline `StepEditor` |
| `apps/web/components/library/AddStandardStepForm.tsx` | per-gate add form |
| `apps/web/app/(app)/library/steps/page.tsx` | admin-gated page; fetch + render + banner |
| app shell nav (e.g. `apps/web/app/(app)/layout.tsx` or its nav component) | gated "Pustaka Langkah" link |

---

## Task 1: Migration — audit columns, RLS write path, RPCs

**Files:**
- Create: `packages/db/supabase/migrations/<ts>_step_library_mgmt.sql` (timestamp later than `20260625000001`, e.g. `20260626000001`)
- Modify: `packages/db/src/types.generated.ts`

**Interfaces:**
- Produces — `trade_steps.updated_by uuid`, `trade_steps.updated_at timestamptz`; RLS allowing manager INSERT/UPDATE on firm-standard rows; RPCs `update_standard_step(p_code, p_name, p_step_type, p_trade_role, p_typical_duration_days, p_lead_time_days, p_applicability jsonb, p_applies_to_area_types text[]) → void`, `set_standard_step_active(p_code, p_active boolean) → void`, `reorder_standard_steps(p_gate_code, p_codes text[]) → void`, `add_standard_step(p_gate_code, p_name, p_step_type, p_trade_role, p_typical_duration_days, p_lead_time_days, p_applies_to_area_types text[]) → text`.

- [ ] **Step 1: Write the migration**

```sql
-- Firm-standard step library management: open trade_steps firm-standard rows to
-- principal/admin editing via RLS + RPCs. Edits affect future seeding only.

-- 1. Audit columns (global edits worth attributing).
alter table public.trade_steps
  add column if not exists updated_by uuid references public.staff(id),
  add column if not exists updated_at timestamptz;

-- 2. RLS: managers may INSERT/UPDATE firm-standard rows. No DELETE (deactivate).
grant update on public.trade_steps to authenticated;  -- INSERT already granted (#22)

drop policy if exists trade_steps_standard_insert on public.trade_steps;
create policy trade_steps_standard_insert on public.trade_steps
  for insert to authenticated
  with check (project_id is null and source = 'standard' and public.current_can_manage_projects());

drop policy if exists trade_steps_standard_update on public.trade_steps;
create policy trade_steps_standard_update on public.trade_steps
  for update to authenticated
  using (project_id is null and source = 'standard' and public.current_can_manage_projects())
  with check (project_id is null and source = 'standard' and public.current_can_manage_projects());

-- 3. RPCs (SECURITY INVOKER → RLS enforces; each re-checks for a clean error).
create or replace function public.update_standard_step(
  p_code text, p_name text, p_step_type text, p_trade_role text,
  p_typical_duration_days int, p_lead_time_days int,
  p_applicability jsonb, p_applies_to_area_types text[]
) returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang mengubah pustaka langkah'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'nama wajib diisi'; end if;
  if p_step_type not in ('decision','procurement','site_work','inspection') then raise exception 'tipe langkah tidak valid: %', p_step_type; end if;
  if coalesce(p_typical_duration_days,0) < 0 or coalesce(p_lead_time_days,0) < 0 then raise exception 'durasi/lead time tidak boleh negatif'; end if;
  if p_applies_to_area_types is not null and exists (
    select 1 from unnest(p_applies_to_area_types) v
    where v not in ('bathroom','kitchen','bedroom','living','dining','garden','circulation','utility','general')
  ) then raise exception 'tipe ruangan tidak valid'; end if;
  update public.trade_steps set
    name = btrim(p_name), step_type = p_step_type, trade_role = p_trade_role,
    typical_duration_days = p_typical_duration_days, lead_time_days = p_lead_time_days,
    applicability = coalesce(p_applicability, '{}'::jsonb),
    applies_to_area_types = p_applies_to_area_types,
    updated_by = auth.uid(), updated_at = now()
  where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;

create or replace function public.set_standard_step_active(p_code text, p_active boolean)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang'; end if;
  update public.trade_steps set active = p_active, updated_by = auth.uid(), updated_at = now()
  where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;

create or replace function public.reorder_standard_steps(p_gate_code text, p_codes text[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang'; end if;
  update public.trade_steps t
    set sort_order = u.ord, updated_by = auth.uid(), updated_at = now()
  from unnest(p_codes) with ordinality as u(code, ord)
  where t.code = u.code and t.gate_code = p_gate_code and t.project_id is null and t.source = 'standard';
end; $$;

create or replace function public.add_standard_step(
  p_gate_code text, p_name text, p_step_type text, p_trade_role text,
  p_typical_duration_days int, p_lead_time_days int, p_applies_to_area_types text[]
) returns text language plpgsql security invoker set search_path = public as $$
declare v_code text; v_sort int;
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang'; end if;
  if not exists (select 1 from public.gates where code = p_gate_code) then raise exception 'gate tidak dikenal: %', p_gate_code; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'nama wajib diisi'; end if;
  if p_step_type not in ('decision','procurement','site_work','inspection') then raise exception 'tipe langkah tidak valid: %', p_step_type; end if;
  if coalesce(p_typical_duration_days,0) < 0 or coalesce(p_lead_time_days,0) < 0 then raise exception 'durasi/lead time tidak boleh negatif'; end if;
  if p_applies_to_area_types is not null and exists (
    select 1 from unnest(p_applies_to_area_types) v
    where v not in ('bathroom','kitchen','bedroom','living','dining','garden','circulation','utility','general')
  ) then raise exception 'tipe ruangan tidak valid'; end if;
  select coalesce(max(sort_order),0)+1 into v_sort from public.trade_steps
    where gate_code = p_gate_code and project_id is null and source = 'standard';
  v_code := 'std_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.trade_steps
    (code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days,
     sort_order, applicability, applies_to_area_types, active, project_id, source, created_by, updated_by, updated_at)
  values
    (v_code, p_gate_code, btrim(p_name), p_step_type, p_trade_role, coalesce(p_typical_duration_days,1), coalesce(p_lead_time_days,0),
     v_sort, '{}'::jsonb, p_applies_to_area_types, true, null, 'standard', auth.uid(), auth.uid(), now());
  return v_code;
end; $$;

-- 4. Grants (RLS + the in-RPC check do the gating).
revoke all on function public.update_standard_step(text,text,text,text,int,int,jsonb,text[]) from public;
grant execute on function public.update_standard_step(text,text,text,text,int,int,jsonb,text[]) to authenticated;
revoke all on function public.set_standard_step_active(text,boolean) from public;
grant execute on function public.set_standard_step_active(text,boolean) to authenticated;
revoke all on function public.reorder_standard_steps(text,text[]) from public;
grant execute on function public.reorder_standard_steps(text,text[]) to authenticated;
revoke all on function public.add_standard_step(text,text,text,text,int,int,text[]) from public;
grant execute on function public.add_standard_step(text,text,text,text,int,int,text[]) to authenticated;
```

- [ ] **Step 2: Update generated types (stopgap — local stack ports are held)**

In `packages/db/src/types.generated.ts`:
- In the `trade_steps` table `Row`/`Insert`/`Update` blocks, add `updated_at: string | null` (Row) / `updated_at?: string | null` (Insert/Update) and `updated_by: string | null` / `updated_by?: string | null`, placed alphabetically (after `typical_duration_days`/before the next key as the generator would; alphabetical order puts `updated_at` then `updated_by` near the end of each block).
- In the `Functions` block, add the four RPC signatures:
```ts
      add_standard_step: {
        Args: {
          p_gate_code: string
          p_name: string
          p_step_type: string
          p_trade_role: string
          p_typical_duration_days: number
          p_lead_time_days: number
          p_applies_to_area_types: string[]
        }
        Returns: string
      }
      reorder_standard_steps: {
        Args: { p_gate_code: string; p_codes: string[] }
        Returns: undefined
      }
      set_standard_step_active: {
        Args: { p_code: string; p_active: boolean }
        Returns: undefined
      }
      update_standard_step: {
        Args: {
          p_code: string
          p_name: string
          p_step_type: string
          p_trade_role: string
          p_typical_duration_days: number
          p_lead_time_days: number
          p_applicability: Json
          p_applies_to_area_types: string[]
        }
        Returns: undefined
      }
```
(Place each alphabetically among the existing `Functions` entries.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C packages/db typecheck` → PASS (`tsc --noEmit`).
```bash
git add packages/db/supabase/migrations/<ts>_step_library_mgmt.sql packages/db/src/types.generated.ts
git commit -m "feat(db): firm-standard step library write path (RLS + audit cols + RPCs)"
```
> Migration apply + authoritative `gen types --local` + prod `db push` are controller/Wilson steps.

---

## Task 2: Library query + pure grouping helper

**Files:**
- Create: `apps/web/lib/library/queries.ts`
- Test: `apps/web/tests/unit/library-grouping.test.ts`

**Interfaces:**
- Consumes — `gateShortName` (`@datum/core`).
- Produces — `type StandardStep`; pure `groupStandardLibrary(steps): StandardLibraryGate[]`; `getStandardLibrary(supabase): Promise<StandardLibraryGate[]>`. `StandardLibraryGate = { gate: string; gateName: string; active: StandardStep[]; inactive: StandardStep[] }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/library-grouping.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupStandardLibrary, type StandardStep } from "@/lib/library/queries";

const mk = (code: string, gate: string, sort: number, active = true): StandardStep => ({
  code, gate_code: gate, name: code, step_type: "site_work", trade_role: null,
  typical_duration_days: 1, lead_time_days: 0, sort_order: sort,
  applies_to_area_types: null, applicability: {}, active,
});

describe("groupStandardLibrary", () => {
  it("groups by gate (A→H), splits active/inactive, sorts by sort_order", () => {
    const out = groupStandardLibrary([
      mk("A2", "A", 2), mk("A1", "A", 1), mk("Ax", "A", 3, false), mk("D1", "D", 1),
    ]);
    expect(out.map((g) => g.gate)).toEqual(["A", "D"]);
    expect(out[0]!.active.map((s) => s.code)).toEqual(["A1", "A2"]);
    expect(out[0]!.inactive.map((s) => s.code)).toEqual(["Ax"]);
    expect(out[0]!.gateName).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm -C apps/web test -- library-grouping`
Expected: FAIL — module/`groupStandardLibrary` not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/library/queries.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { gateShortName } from "@datum/core";

export type StandardStep = {
  code: string;
  gate_code: string;
  name: string;
  step_type: string;
  trade_role: string | null;
  typical_duration_days: number;
  lead_time_days: number;
  sort_order: number;
  applies_to_area_types: string[] | null;
  applicability: Record<string, unknown>;
  active: boolean;
};

export type StandardLibraryGate = {
  gate: string;
  gateName: string;
  active: StandardStep[];
  inactive: StandardStep[];
};

/** Group firm-standard steps by gate (A→H), split active/inactive, each sorted by sort_order. */
export function groupStandardLibrary(steps: StandardStep[]): StandardLibraryGate[] {
  const order: string[] = [];
  const byGate = new Map<string, StandardStep[]>();
  for (const s of steps) {
    if (!byGate.has(s.gate_code)) { byGate.set(s.gate_code, []); order.push(s.gate_code); }
    byGate.get(s.gate_code)!.push(s);
  }
  order.sort((a, b) => a.localeCompare(b));
  return order.map((gate) => {
    const all = byGate.get(gate)!.slice().sort((a, b) => a.sort_order - b.sort_order);
    return {
      gate,
      gateName: gateShortName(gate),
      active: all.filter((s) => s.active),
      inactive: all.filter((s) => !s.active),
    };
  });
}

/** Fetch the whole firm-standard library (active + inactive), grouped by gate. */
export async function getStandardLibrary(
  supabase: SupabaseClient<Database>,
): Promise<StandardLibraryGate[]> {
  const { data, error } = await supabase
    .from("trade_steps")
    .select("code, gate_code, name, step_type, trade_role, typical_duration_days, lead_time_days, sort_order, applies_to_area_types, applicability, active")
    .is("project_id", null)
    .eq("source", "standard")
    .order("gate_code")
    .order("sort_order");
  if (error) throw error;
  return groupStandardLibrary((data ?? []) as unknown as StandardStep[]);
}
```

- [ ] **Step 4: Run → PASS, typecheck, commit**

Run: `pnpm -C apps/web test -- library-grouping` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/library/queries.ts apps/web/tests/unit/library-grouping.test.ts
git commit -m "feat(library): firm-standard library query + gate grouping"
```

---

## Task 3: Server actions (gated wrappers over the RPCs)

**Files:**
- Create: `apps/web/lib/library/actions.ts`

**Interfaces:**
- Consumes — `getCurrentStaff`, `canManageAccess` (`@/lib/auth/require-role`); the four RPCs (Task 1).
- Produces — `LibraryActionResult = { ok: true } | { ok: false; error: string }`; `updateStandardStep`, `setStandardStepActive`, `reorderStandardSteps`, `addStandardStep` (the last returns `{ ok: true; code: string } | { ok: false; error: string }`).

- [ ] **Step 1: Write the actions**

Create `apps/web/lib/library/actions.ts`:
```ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";

export type LibraryActionResult = { ok: true } | { ok: false; error: string };

async function manager() {
  const staff = await getCurrentStaff();
  return staff && canManageAccess(staff) ? staff : null;
}

export async function updateStandardStep(args: {
  code: string;
  name: string;
  stepType: "decision" | "procurement" | "site_work" | "inspection";
  tradeRole: string | null;
  typicalDurationDays: number;
  leadTimeDays: number;
  appliesToAreaTypes: string[] | null;
  /** Passed through unchanged — the v1 editor does not edit finish-profile conditions, but must NOT wipe them. */
  applicability: Record<string, unknown>;
}): Promise<LibraryActionResult> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang mengubah pustaka" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("update_standard_step", {
      p_code: args.code, p_name: args.name, p_step_type: args.stepType, p_trade_role: args.tradeRole,
      p_typical_duration_days: args.typicalDurationDays, p_lead_time_days: args.leadTimeDays,
      p_applicability: args.applicability, p_applies_to_area_types: args.appliesToAreaTypes ?? [],
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function setStandardStepActive(args: { code: string; active: boolean }): Promise<LibraryActionResult> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("set_standard_step_active", { p_code: args.code, p_active: args.active });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function reorderStandardSteps(args: { gateCode: string; codes: string[] }): Promise<LibraryActionResult> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("reorder_standard_steps", { p_gate_code: args.gateCode, p_codes: args.codes });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function addStandardStep(args: {
  gateCode: string;
  name: string;
  stepType: "decision" | "procurement" | "site_work" | "inspection";
  tradeRole: string | null;
  typicalDurationDays: number;
  leadTimeDays: number;
  appliesToAreaTypes: string[] | null;
}): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.rpc("add_standard_step", {
      p_gate_code: args.gateCode, p_name: args.name, p_step_type: args.stepType, p_trade_role: args.tradeRole,
      p_typical_duration_days: args.typicalDurationDays, p_lead_time_days: args.leadTimeDays,
      p_applies_to_area_types: args.appliesToAreaTypes ?? [],
    });
    if (error) throw error;
    return { ok: true, code: data as string };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/library/actions.ts
git commit -m "feat(library): manager-gated server actions for standard-step edits"
```

---

## Task 4: StepLibraryView + inline StepEditor

**Files:**
- Create: `apps/web/components/library/StepLibraryView.tsx`

**Interfaces:**
- Consumes — `getStandardLibrary` result (`StandardLibraryGate[]`); the actions (Task 3); `AddStandardStepForm` (Task 5).
- Produces — `<StepLibraryView library={StandardLibraryGate[]} />`.

- [ ] **Step 1: Write the component**

Create `apps/web/components/library/StepLibraryView.tsx`. Gate sections; each active step is a row with up/down reorder + an "Ubah" editor + an active toggle; inactive steps in a dimmed subsection; `AddStandardStepForm` per gate.
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateStandardStep, setStandardStepActive, reorderStandardSteps } from "@/lib/library/actions";
import type { StandardLibraryGate, StandardStep } from "@/lib/library/queries";
import { AddStandardStepForm } from "./AddStandardStepForm";

export const ROOM_TYPES: { value: string; label: string }[] = [
  { value: "bathroom", label: "Kamar mandi" }, { value: "kitchen", label: "Dapur" },
  { value: "bedroom", label: "Kamar tidur" }, { value: "living", label: "Ruang keluarga" },
  { value: "dining", label: "Ruang makan" }, { value: "garden", label: "Taman" },
  { value: "circulation", label: "Sirkulasi" }, { value: "utility", label: "Servis" },
  { value: "general", label: "Umum" },
];
const TYPE_OPTIONS: { value: StandardStep["step_type"]; label: string }[] = [
  { value: "site_work", label: "Pekerjaan" }, { value: "decision", label: "Keputusan" },
  { value: "procurement", label: "Pengadaan" }, { value: "inspection", label: "Inspeksi" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((t) => [t.value, t.label]));

function StepEditor({ step, onDone }: { step: StandardStep; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(step.name);
  const [stepType, setStepType] = useState(step.step_type);
  const [trade, setTrade] = useState(step.trade_role ?? "");
  const [dur, setDur] = useState(String(step.typical_duration_days));
  const [lead, setLead] = useState(String(step.lead_time_days));
  const [rooms, setRooms] = useState<string[]>(step.applies_to_area_types ?? []);

  function toggleRoom(v: string) {
    setRooms((r) => (r.includes(v) ? r.filter((x) => x !== v) : [...r, v]));
  }
  function save() {
    setError(null);
    startTransition(async () => {
      const r = await updateStandardStep({
        code: step.code, name: name.trim(),
        stepType: stepType as "decision" | "procurement" | "site_work" | "inspection",
        tradeRole: trade.trim() || null,
        typicalDurationDays: Number(dur) || 0, leadTimeDays: Number(lead) || 0,
        appliesToAreaTypes: rooms.length ? rooms : null,
        applicability: step.applicability, // pass through unchanged — don't wipe finish-profile conditions
      });
      if (r.ok) { onDone(); router.refresh(); } else setError(r.error);
    });
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3 text-[12px]">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input value={name} disabled={pending} onChange={(e) => setName(e.target.value)} placeholder="Nama langkah"
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" />
        <select value={stepType} disabled={pending} onChange={(e) => setStepType(e.target.value)}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0">
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input value={trade} disabled={pending} onChange={(e) => setTrade(e.target.value)} placeholder="Trade (mis. tukang_marmer)"
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" />
        <label className="flex items-center gap-1">Durasi
          <input value={dur} disabled={pending} inputMode="numeric" onChange={(e) => setDur(e.target.value.replace(/[^0-9]/g, ""))}
            className="min-h-11 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" /></label>
        <label className="flex items-center gap-1">Lead
          <input value={lead} disabled={pending} inputMode="numeric" onChange={(e) => setLead(e.target.value.replace(/[^0-9]/g, ""))}
            className="min-h-11 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" /></label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ROOM_TYPES.map((rt) => (
          <button key={rt.value} type="button" disabled={pending} onClick={() => toggleRoom(rt.value)}
            className={`min-h-11 rounded border px-2 py-0.5 text-[11px] md:min-h-0 ${rooms.includes(rt.value) ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
            {rt.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">Kosongkan ruangan = berlaku untuk semua tipe ruangan.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={pending || !name.trim()} onClick={save}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">Simpan</button>
        <button type="button" disabled={pending} onClick={onDone}
          className="min-h-11 text-[var(--text-muted)] disabled:opacity-50 md:min-h-0">Batal</button>
        {error ? <span className="text-[11px] text-[var(--flag-critical)]">{error}</span> : null}
      </div>
    </div>
  );
}

function GateSection({ g }: { g: StandardLibraryGate }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    startTransition(async () => { const r = await fn(); if (r.ok) router.refresh(); });
  }
  function move(idx: number, dir: -1 | 1) {
    const codes = g.active.map((s) => s.code);
    const j = idx + dir;
    if (j < 0 || j >= codes.length) return;
    [codes[idx], codes[j]] = [codes[j]!, codes[idx]!];
    run(() => reorderStandardSteps({ gateCode: g.gate, codes }));
  }

  return (
    <details className="rounded border border-[var(--border)] bg-[var(--surface)]" open>
      <summary className="min-h-11 cursor-pointer px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--foreground)] md:min-h-0">
        {g.gate} · {g.gateName} <span className="text-[var(--text-muted)]">({g.active.length})</span>
      </summary>
      {g.active.map((s, i) => (
        <div key={s.code}>
          <div className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2 text-[13px]">
            <div className="flex flex-col">
              <button type="button" disabled={pending || i === 0} onClick={() => move(i, -1)} className="text-[10px] leading-none text-[var(--text-muted)] disabled:opacity-30">▲</button>
              <button type="button" disabled={pending || i === g.active.length - 1} onClick={() => move(i, 1)} className="text-[10px] leading-none text-[var(--text-muted)] disabled:opacity-30">▼</button>
            </div>
            <span className="rounded bg-[var(--sand-tint)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">{TYPE_LABEL[s.step_type] ?? s.step_type}</span>
            <span className="flex-1 text-[var(--foreground)]">{s.name}</span>
            <span className="text-[10px] text-[var(--text-muted)]">{s.typical_duration_days}h/lead {s.lead_time_days}h</span>
            <button type="button" onClick={() => setEditing(editing === s.code ? null : s.code)}
              className="min-h-11 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sand-dark)] md:min-h-0">Ubah</button>
            <button type="button" disabled={pending} onClick={() => run(() => setStandardStepActive({ code: s.code, active: false }))}
              className="min-h-11 text-[11px] text-[var(--text-muted)] hover:text-[var(--flag-critical)] disabled:opacity-50 md:min-h-0">Nonaktifkan</button>
          </div>
          {editing === s.code ? <StepEditor step={s} onDone={() => setEditing(null)} /> : null}
        </div>
      ))}
      <AddStandardStepForm gateCode={g.gate} />
      {g.inactive.length > 0 ? (
        <div className="border-t border-[var(--border)]">
          <button type="button" onClick={() => setShowInactive((v) => !v)}
            className="min-h-11 w-full px-4 py-2 text-left text-[11px] text-[var(--text-muted)] md:min-h-0">
            Nonaktif ({g.inactive.length}) {showInactive ? "▾" : "▸"}
          </button>
          {showInactive ? g.inactive.map((s) => (
            <div key={s.code} className="flex items-center gap-2 border-t border-[var(--border)] px-4 py-2 text-[12px] text-[var(--text-muted)]">
              <span className="flex-1 line-through">{s.name}</span>
              <button type="button" disabled={pending} onClick={() => run(() => setStandardStepActive({ code: s.code, active: true }))}
                className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">Aktifkan</button>
            </div>
          )) : null}
        </div>
      ) : null}
    </details>
  );
}

export function StepLibraryView({ library }: { library: StandardLibraryGate[] }) {
  return (
    <div className="flex flex-col gap-3">
      {library.map((g) => <GateSection key={g.gate} g={g} />)}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS. (`AddStandardStepForm` is created in Task 5 — if typecheck runs before Task 5, create a minimal stub or implement Task 5 first; the subagent executing this plan does Task 5 next, so run typecheck after Task 5 if needed.)
```bash
git add apps/web/components/library/StepLibraryView.tsx
git commit -m "feat(library): gate-grouped library view with inline edit + reorder + activate"
```
> Note for executor: Tasks 4 and 5 are mutually referencing (View imports AddStandardStepForm). Implement Task 5's file before running Task 4's typecheck, then commit both as their respective tasks.

---

## Task 5: AddStandardStepForm

**Files:**
- Create: `apps/web/components/library/AddStandardStepForm.tsx`

**Interfaces:**
- Consumes — `addStandardStep` (Task 3); `ROOM_TYPES` (exported from `StepLibraryView`, Task 4).
- Produces — `<AddStandardStepForm gateCode={string} />`.

- [ ] **Step 1: Write the component**

Create `apps/web/components/library/AddStandardStepForm.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStandardStep } from "@/lib/library/actions";
import { ROOM_TYPES } from "./StepLibraryView";

type StepType = "decision" | "procurement" | "site_work" | "inspection";
const TYPE_OPTIONS: { value: StepType; label: string }[] = [
  { value: "site_work", label: "Pekerjaan" }, { value: "decision", label: "Keputusan" },
  { value: "procurement", label: "Pengadaan" }, { value: "inspection", label: "Inspeksi" },
];

export function AddStandardStepForm({ gateCode }: { gateCode: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [stepType, setStepType] = useState<StepType>("site_work");
  const [trade, setTrade] = useState("");
  const [dur, setDur] = useState("1");
  const [lead, setLead] = useState("0");
  const [rooms, setRooms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reset() { setName(""); setTrade(""); setDur("1"); setLead("0"); setRooms([]); setStepType("site_work"); setError(null); }
  function add() {
    setError(null);
    startTransition(async () => {
      const r = await addStandardStep({
        gateCode, name: name.trim(), stepType, tradeRole: trade.trim() || null,
        typicalDurationDays: Number(dur) || 0, leadTimeDays: Number(lead) || 0,
        appliesToAreaTypes: rooms.length ? rooms : null,
      });
      if (r.ok) { reset(); setOpen(false); router.refresh(); } else setError(r.error);
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-11 w-full border-t border-[var(--border)] px-4 py-2 text-left text-[12px] font-semibold text-[var(--sand-dark)] hover:bg-[var(--sand-tint)] md:min-h-0">
        + Tambah langkah standar
      </button>
    );
  }
  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3 text-[12px]">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <input value={name} disabled={pending} onChange={(e) => setName(e.target.value)} placeholder="Nama langkah baru"
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" />
        <select value={stepType} disabled={pending} onChange={(e) => setStepType(e.target.value as StepType)}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0">
          {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input value={trade} disabled={pending} onChange={(e) => setTrade(e.target.value)} placeholder="Trade"
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" />
        <label className="flex items-center gap-1">Durasi
          <input value={dur} disabled={pending} inputMode="numeric" onChange={(e) => setDur(e.target.value.replace(/[^0-9]/g, ""))}
            className="min-h-11 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" /></label>
        <label className="flex items-center gap-1">Lead
          <input value={lead} disabled={pending} inputMode="numeric" onChange={(e) => setLead(e.target.value.replace(/[^0-9]/g, ""))}
            className="min-h-11 w-14 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 md:min-h-0" /></label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ROOM_TYPES.map((rt) => (
          <button key={rt.value} type="button" disabled={pending}
            onClick={() => setRooms((r) => (r.includes(rt.value) ? r.filter((x) => x !== rt.value) : [...r, rt.value]))}
            className={`min-h-11 rounded border px-2 py-0.5 text-[11px] md:min-h-0 ${rooms.includes(rt.value) ? "border-[var(--sand-dark)] bg-[var(--surface)] text-[var(--foreground)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
            {rt.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-muted)]">Kosongkan ruangan = berlaku untuk semua tipe ruangan.</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={pending || !name.trim()} onClick={add}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">Tambah</button>
        <button type="button" disabled={pending} onClick={() => { reset(); setOpen(false); }}
          className="min-h-11 text-[var(--text-muted)] disabled:opacity-50 md:min-h-0">Batal</button>
        {error ? <span className="text-[11px] text-[var(--flag-critical)]">{error}</span> : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS (Tasks 4+5 together resolve the mutual import).
```bash
git add apps/web/components/library/AddStandardStepForm.tsx
git commit -m "feat(library): add-standard-step form per gate"
```

---

## Task 6: Admin-gated page + nav link

**Files:**
- Create: `apps/web/app/(app)/library/steps/page.tsx`
- Modify: the app shell nav (read `apps/web/app/(app)/layout.tsx` and the nav component it renders to find where links live)

**Interfaces:**
- Consumes — `getStandardLibrary` (Task 2), `StepLibraryView` (Task 4), `getCurrentStaff`/`canManageAccess` (`@/lib/auth/require-role`).

- [ ] **Step 1: Write the page**

Create `apps/web/app/(app)/library/steps/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { getStandardLibrary } from "@/lib/library/queries";
import { StepLibraryView } from "@/components/library/StepLibraryView";

export default async function StepLibraryPage() {
  const caller = await getCurrentStaff();
  if (!caller || !canManageAccess(caller)) redirect("/");

  const supabase = await createSupabaseServerClient();
  const library = await getStandardLibrary(supabase);

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">Pengaturan firma</p>
        <h1 className="text-2xl font-semibold text-[#141210]">Pustaka Langkah</h1>
      </header>
      <div className="mb-4 rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs text-[var(--sand-dark)]">
        Perubahan di sini hanya memengaruhi seeding ruangan BARU dan langkah yang ditambahkan lewat
        &quot;Dari rekomendasi&quot;. Checklist ruangan yang sudah ada tidak berubah.
      </div>
      <StepLibraryView library={library} />
    </div>
  );
}
```

- [ ] **Step 2: Add the gated nav link**

Read `apps/web/app/(app)/layout.tsx` (and whatever nav component it renders) to find how nav links are defined and how the current staff/role is available there. Add a link to `/library/steps` labelled "Pustaka Langkah", rendered only when the current staff passes `canManageAccess`. Follow the exact pattern already used for any existing role-conditional nav item; if the nav has no staff context, fetch it the same way the layout already does. Keep styling consistent with sibling links.

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add "apps/web/app/(app)/library/steps/page.tsx" "apps/web/app/(app)/layout.tsx"
git commit -m "feat(library): Pustaka Langkah admin page + gated nav link"
```

---

## Task 7: Browser verification (controller-run)

> Controller-run; needs the migration on prod (`supabase db push`) + a principal/admin session.

- [ ] As a **principal/admin**, open `/library/steps` → gate sections render with the firm-standard steps; banner present.
- [ ] Edit a step (name + duration + room-tags) → Simpan → value persists after refresh.
- [ ] Reorder two steps in a gate (▲/▼) → order persists.
- [ ] Add a new step in a gate → appears at the bottom; then deactivate it → moves to "Nonaktif"; reactivate → returns.
- [ ] As a **non-manager** (e.g. designer/pic), `/library/steps` redirects to `/`, the nav link is absent, and a direct RPC call is refused (RLS/clean error).
- [ ] Confirm an existing project's room checklists are unchanged (opt-in-pull); a newly-created room seeds using any edits made.
- [ ] Clean up the test step. Screenshot for the user. No console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 surface/access → Task 6 (page gate + nav); §2 data layer → Task 1 (cols/RLS/RPCs) + Task 3 (actions); §3 UI → Tasks 4 (view/editor/reorder/activate) + 5 (add); §4 propagation → Task 6 banner; testing → Task 2 (pure), Task 7 (browser). No promotion / dep-graph / raw-applicability editing (out of scope, honored).
- **Type consistency:** `StandardStep`/`StandardLibraryGate` defined Task 2, consumed Tasks 4/6; `LibraryActionResult` + the 4 actions defined Task 3, consumed Tasks 4/5; `ROOM_TYPES` exported Task 4, consumed Task 5; RPC arg names match Task 1 ↔ Task 3.
- **Verify-during-impl flags:** the nav location + role context (Task 6 Step 2 — read the layout); the `updated_at`/`updated_by` alphabetical placement in the stopgap types (Task 1 Step 2); Tasks 4↔5 mutual import (implement 5's file before 4's typecheck).
- **Operational:** migration apply + `gen types --local` + prod `db push` are Wilson's; Task 7 is post-push. The CSS var `--flag-critical` is used for errors — confirm it exists in the theme (fallback `text-red-700` if not).
