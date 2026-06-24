# Readiness — Per-Bathroom Step Editing (add / remove work steps)

**Date:** 2026-06-24
**Status:** Design approved; pending spec review → implementation plan.

## Goal

Let any project member **add and remove work steps on a bathroom** from the schedule page's per-bathroom checklist (slice 2a-2 UI, already on prod). The auto-seeded Gate B steps are DATUM's **recommendations**; a real bathroom may need extra steps or have steps that don't apply. Edits must be cheap to make and uncluttered, and the data model must be shaped so a later **learning loop can "derive future works"** from these edits (out of scope for this round — see §9).

## Context (existing model)

The readiness step system (slice 2a-1 backend, on prod) has a clean **template ↔ instance** split:

- **Template (firm standard, global config):** `trade_steps` (`code` PK, `gate_code`, `name`, `step_type` ∈ decision/procurement/site_work/inspection, `trade_role`, `typical_duration_days`, `lead_time_days`, `sort_order`, `applicability` jsonb, `active`), plus `trade_step_deps` and `trade_step_checkpoints`.
- **Instance (one real bathroom):** `area_steps` (`step_code` **FK → `trade_steps.code`**, `unique(area_id, step_code)`, `status`, planned/actual dates, `assigned_trade`, …), plus `area_step_checkpoints`, `punch_items`.
- **Seeding:** `seed_area_steps(area_id)` copies active Gate B `trade_steps` (filtered by `applicability` vs the area's `area_type` + `finish_profile`) into `area_steps`, copying checkpoint templates.
- **Read/flags:** `getAreaSteps` joins `trade_steps` for `name`/`sort_order`/`step_type`; `computeAreaFlags` and status projection key on `step_code`.

The crux: today an `area_step` **must** reference an existing `trade_steps` template, and the whole engine keys on `step_code`. Adding an off-template custom step needs a deliberate data path.

## Decisions (from brainstorming)

1. **Scope:** build per-area add/remove editing **now**; the "derive future works" learning loop is a **later** phase the data model is designed for (§9).
2. **Add model:** **both** — re-add a recommended Gate B step that wasn't auto-included, **and** create a brand-new custom step.
3. **Remove model:** **soft-remove, reversible** — removed steps drop out of the list and the X/Y count, keep their history, and can be restored. Re-seeding never resurrects them.
4. **Custom-step form:** **name + step type** only (type ∈ decision/procurement/site_work/inspection, default site_work; type drives the attention flags). Trade/dates/checkpoints are edited afterward in the existing detail panel.
5. **Permissions:** **any project member** (same as today's status/progress updates).
6. **Data-model approach (chosen): B — a custom step is a project-scoped `trade_steps` row.** Reuses the engine unchanged, gives custom steps flag behavior for free, and makes the future learning loop a promotion flag-flip. (Rejected: A — instance-only columns on `area_steps`; cleaner separation but touches the tested `getAreaSteps`/flags core and excludes custom steps from flags.)

## §1. Data model

### `trade_steps` — additive scoping columns
```sql
alter table public.trade_steps
  add column project_id uuid references public.projects(id) on delete cascade,  -- NULL = firm standard; set = project-scoped custom
  add column source     text not null default 'standard' check (source in ('standard','custom')),
  add column created_by uuid references public.staff(id),
  add column created_at timestamptz not null default now();
```
A **custom step** is a `trade_steps` row with `source='custom'`, `project_id=<this project>`, `gate_code='B'`, `code='cst_'||<uuid>`, `name`/`step_type` from the form, `sort_order=900` (sorts after standard B-steps), `applicability='{}'`, `created_by=auth.uid()`.

### `area_steps` — soft-remove
```sql
alter table public.area_steps add column removed_at timestamptz;  -- NULL = active
```
"Remove" sets `removed_at=now()`; "restore" clears it. Chosen over overloading `status='not_applicable'` because the status projection (`projectAreaStep`) could clobber a status value, whereas it never touches `removed_at`. Re-seeding's `on conflict (area_id, step_code) do nothing` leaves a removed standard step removed.

### Seeding stays pristine
`seed_area_steps` adds one filter so project-scoped customs never auto-spread:
```sql
select * from public.trade_steps
where gate_code = 'B' and active and project_id is null  -- <-- new
order by sort_order
```

### RLS
```sql
-- read: everyone sees firm standards; custom rows only to their project's members
drop policy trade_steps_read on public.trade_steps;
create policy trade_steps_read on public.trade_steps
  for select to authenticated
  using (project_id is null or public.current_can_read_project(project_id));

-- write: project members may CRUD their own project's CUSTOM steps; never firm-standard rows
create policy trade_steps_custom_write on public.trade_steps
  for all to authenticated
  using  (project_id is not null and public.current_can_read_project(project_id))
  with check (project_id is not null and source = 'custom' and public.current_can_read_project(project_id));
```
`area_steps_write` (existing) already gates on `current_can_read_project`, covering remove/restore and the custom `area_step` insert.

## §2. Backend (`lib/steps/`, `packages/db`)

**Mutations** (TS, single-table, testable — like `updateAreaStep`):
- `removeAreaStep(sb, { areaStepId })` → `update area_steps set removed_at = now() where id = …`.
- `restoreAreaStep(sb, { areaStepId })` → `update area_steps set removed_at = null where id = …`.

**RPCs** (atomic, mirror the `seed_area_steps` precedent; both **SECURITY INVOKER** so the existing RLS policies — not a manual gate — enforce membership uniformly):
- `add_catalog_area_step(p_area_id uuid, p_step_code text)` — a one-step `seed_area_steps`: insert the `area_step` (`on conflict (area_id, step_code) do nothing`) and copy that step's `trade_step_checkpoints`, atomically. Validates `p_step_code` is a **firm-standard** Gate B code (`trade_steps where code=p_step_code and project_id is null and gate_code='B'`) and raises otherwise, so a caller can't smuggle another project's custom code.
- `add_custom_area_step(p_area_id uuid, p_name text, p_step_type text)` — atomic two-insert: a `trade_steps` row (`code = 'cst_' || replace(gen_random_uuid()::text,'-','')`, `gate_code='B'`, `source='custom'`, `project_id` from the area, `created_by=auth.uid()`, `sort_order=900`, `applicability='{}'`) + the `area_step`. Returns the new `area_step.id`. RLS (`trade_steps_custom_write` + `area_steps_write`) enforces membership. Validates `p_name` is non-empty and `p_step_type ∈ (decision,procurement,site_work,inspection)`.

(Both RPCs: `revoke all from public; grant execute to authenticated`, matching `seed_area_steps`.)

**Queries** (`lib/steps/queries.ts`):
- `getAreaSteps` — add `where removed_at is null`; order by `(sort_order, created_at)` so customs sort stably after standard steps.
- `getRemovedAreaSteps(sb, areaId)` → `{ id, step_code, name }[]` (join for name) for the restore list.
- `getAddableCatalogSteps(sb, areaId)` → `{ code, name }[]`: firm-standard Gate B steps (`project_id is null, active`) whose `code` has **no** `area_step` row on this area. (A removed standard step has a row → it appears in the removed list, not here — no duplication.)

**Flags — one refinement (motivated by remove).** Custom steps carry real `step_code` + `step_type`, so `computeAreaFlags` treats them as standalone nodes: a no-predecessor `not_started` custom step can become `readyToStart`; it won't fire `needsDecision` (nothing depends on it) — acceptable. **But** today `isReady(code)` requires `predsOf.get(code).every(p => status.get(p) === 'accepted')`, which blocks a step whose predecessor is *absent* from the area's active set (`status.get(absent)` is `undefined`). Removing a prerequisite step (or an applicability-excluded prerequisite) would then strand its dependents forever. Fix: treat an absent predecessor as satisfied —
```ts
predsOf.get(code)!.every((p) => !status.has(p) || status.get(p) === "accepted")
```
This is behavior-preserving when all predecessors are present (every existing case), and strictly more correct otherwise. `getAreaStepView` passes only active steps (`removed_at is null`); the deps query is unchanged. Status projection (`projectAreaStep`) is per `area_step_id` — untouched, works for customs.

## §3. Server actions (`lib/steps/actions.ts`)

Thin `"use server"` wrappers, auth-guarded via `getCurrentStaff`, return `{ ok: true } | { ok: false; error: string }`, Bahasa Indonesia errors:
- `addCatalogStep({ areaId, stepCode })` → `add_catalog_area_step` RPC.
- `addCustomStep({ areaId, name, stepType })` → `add_custom_area_step` RPC.
- `removeStep({ areaStepId })` → `removeAreaStep`.
- `restoreStep({ areaStepId })` → `restoreAreaStep`.

## §4. UI (`components/schedule/`)

Match the `StepDetail`/`AreaTargetEditor` idiom: `"use client"`, `useTransition` + `useRouter().refresh()` on success, inline error, `min-h-11 md:min-h-0` touch targets, CSS-var Tailwind, Bahasa Indonesia sentence-case, collapsed-by-default.

- **`AreaStepsPanel`** (expanded) gains a single **"+ Tambah langkah"** button at the bottom, opening a new extracted **`AddStepForm.tsx`**:
  - Segmented toggle **"Dari rekomendasi" | "Baru"**.
  - *Dari rekomendasi:* `<select>` of `addableCatalog` options + "Tambah" (→ `addCatalogStep`). Hidden/disabled when the catalog is empty.
  - *Baru:* name `<input>` + type `<select>` (Keputusan/Pengadaan/Pekerjaan/Inspeksi) + "Tambah" (→ `addCustomStep`). "Tambah" disabled until name is non-empty.
- **`StepDetail`** (Level 3) gains a **"Hapus langkah"** control (in the detail, not the row, to avoid accidental taps) → `removeStep`.
- **`AreaStepsPanel`** gains a collapsible **"Langkah dihapus (N)"** section at the bottom; each removed step shows its name + **"Pulihkan"** → `restoreStep`. Rendered only when `removedSteps.length > 0`.
- **`schedule/page.tsx`** passes `addableCatalog` + `removedSteps` per bathroom area (fetched alongside `getAreaStepView`), via `getAddableCatalogSteps` + `getRemovedAreaSteps`.

## §5. Ordering & deps (this round)

Custom steps append after standard steps (`sort_order=900`, tie-broken by `created_at`). **No reordering UI** and **no custom deps/checkpoints** this round (matches the name+type decision). Reordering and per-custom checkpoints are future polish.

## §6. Testing

- **DB migration** (columns + RLS + 2 RPCs + seed filter), validated via local `supabase` apply + in-DB smoke: catalog-add → `area_step` + copied checkpoints; custom-add → `trade_steps` (`source=custom`, scoped) + `area_step`; remove/restore toggles `removed_at`; `seed_area_steps` still excludes customs; a non-member cannot write another project's custom step (RLS).
- **Unit:** `getAddableCatalogSteps` filter (area codes + catalog → addable); `computeAreaFlags` cases — (a) a standalone custom `not_started` step becomes `readyToStart`; (b) a step whose predecessor is **absent** from the active set is treated as unblocked (the absent-predecessor refinement), with a regression case confirming all-present-predecessor behavior is unchanged. Suite stays green.
- **Gate:** root `pnpm typecheck` + `pnpm test` (turbo, **all** workspaces incl. mobile — a `trade_steps`/`MatrixArea`-style shared-type change can break mobile fixtures), then `pnpm -C apps/web build`.
- **Browser-verify** on the real Master Bathroom (`ARCH-DHARMAHUSADA-C2-39-RUSDY`): add a custom step (renders with name + becomes a flag candidate), remove it (drops out, X/Y updates), restore it; add a catalog step.

## §7. Global constraints

- Reuse the slice 2a-2 conventions verbatim (`"use client"`, `useTransition`/`router.refresh`, `{ok}|{error}` actions, `min-h-11 md:min-h-0`, CSS vars `var(--surface)`/`var(--border)`/`var(--foreground)`/`var(--text-muted)`/`var(--sand-dark)`/`var(--sand-tint)`). Bahasa Indonesia, sentence case, uncluttered (add form + removed list both collapsed by default).
- No new deps. Migration shipped via `supabase db push` from the worktree's `packages/db` (global v2 CLI), and DB types regenerated.

## §8. File structure

| File | Change |
| --- | --- |
| `packages/db/supabase/migrations/<ts>_step_editing.sql` | new: `trade_steps` cols, `area_steps.removed_at`, RLS, `seed_area_steps` filter, `add_catalog_area_step` + `add_custom_area_step` RPCs |
| `packages/db/src/types.generated.ts` | regenerated |
| `apps/web/lib/steps/mutations.ts` | `removeAreaStep`, `restoreAreaStep` |
| `apps/web/lib/steps/queries.ts` | `getAreaSteps` (filter+order), `getRemovedAreaSteps`, `getAddableCatalogSteps` |
| `apps/web/lib/steps/flags.ts` | `computeAreaFlags`: absent-predecessor treated as satisfied |
| `apps/web/lib/steps/actions.ts` | `addCatalogStep`, `addCustomStep`, `removeStep`, `restoreStep` |
| `apps/web/components/schedule/AddStepForm.tsx` | new: catalog/custom add form |
| `apps/web/components/schedule/AreaStepsPanel.tsx` | "+ Tambah langkah" + "Langkah dihapus" section; accept `addableCatalog`/`removedSteps` |
| `apps/web/components/schedule/StepDetail.tsx` | "Hapus langkah" control |
| `apps/web/app/(app)/project/[slug]/schedule/page.tsx` | fetch + pass `addableCatalog`/`removedSteps` per bathroom |

## §9. Out of scope (future)

- **Learning loop / "derive future works":** read `trade_steps where source='custom'`, aggregate recurring custom steps across projects, and **promote** (flip `project_id → NULL`, optionally tuned by `area_type`/`finish_profile` applicability) so they become recommendations. Enabled by the `source`/`created_by`/`created_at`/`project_id` columns added here — no migration needed then.
- Reordering steps; checkpoints/deps/durations on custom steps; editing a step's name/type after creation; bulk apply a custom step across a project's bathrooms; gates other than B.
