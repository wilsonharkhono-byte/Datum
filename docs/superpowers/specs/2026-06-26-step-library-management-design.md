# Firm-Standard Step Library Management (Piece B) — Design

**Date:** 2026-06-26
**Status:** Design approved in brainstorming; pending spec review → implementation plan.
**Relationship:** Direct sequel to the multi-room readiness steps (Piece A, [merged](https://github.com/wilsonharkhono-byte/Datum/pull/24)). Piece A seeded a ~84-step firm-standard library (`trade_steps` where `project_id IS NULL`) and gave per-area editing of *instances*. Piece B opens the firm-standard *templates* themselves to controlled, in-app management so the library can be corrected and grown without migrations.

## Goal

Give principal/admin users a firm-wide page to manage the recommended step library — edit fields (name, durations, lead-times, trade, room-tags), reorder within a gate, activate/deactivate, and add new standard steps — through a deliberately-gated write path that today only migrations can touch.

## Context

- The firm-standard library is **global**: `trade_steps` rows with `project_id IS NULL, source='standard'`. A change reshapes every project's *future* seeding. (Per-project custom steps are `project_id` set, `source='custom'`, `code='cst_<uuid>'`.)
- **The write path is currently closed by design** (#22, `20260624000001`): RLS `trade_steps_custom_write` permits writes only to project-scoped custom rows; firm-standard rows have **no** write policy, so only migrations/service-role can change them.
- There is **no firm-wide admin surface** today — only per-project `project/[slug]/settings`.
- `current_can_manage_projects()` (principal/admin) is the existing firm-management gate.
- Piece A's **opt-in-pull** propagation: editing the library affects future seeding + the per-area "Dari rekomendasi" picker; it does **not** retroactively change existing `area_steps`.
- After Piece A, the durations/lead-times/room-tags in the seed are firm-standard *guesses*, and `dining`/`circulation`/`utility` got a blanket "general" coverage default — both are things this UI lets the firm correct.

## Decisions (from brainstorming)

1. **Full scope** — correct the current data *and* manage ongoing (edit / add / reorder / retag / activate-deactivate).
2. **Edit access = reuse `current_can_manage_projects()`** (principal/admin). One permission model, consistent with the app.
3. **No promotion flow in v1** — managing the standard library directly only; promoting per-project custom steps into the standard ("learning loop", #22 §9) is a separate later piece.
4. **Opt-in-pull propagation** (from Piece A) — edits affect future seeding only; existing checklists untouched. Surfaced via a persistent banner.
5. **Deactivate, never delete** — `active=false` (reversible; FKs from `area_steps` make delete unsafe), matching how Piece A retired the old B-steps.
6. **Dependency graph + checkpoints are out of scope v1** — editing predecessors/checkpoints stays migration-managed (graph-editing is its own UX problem; flagged for later).

## §1 · Surface & access

- New firm-level route `apps/web/app/(app)/library/steps/page.tsx` ("Pustaka Langkah"), **not** project-scoped.
- The page (server component) calls `current_can_manage_projects()` (via the existing auth/role helpers) and **403s/redirects** non-managers — defence in depth on top of RLS.
- A nav link to it appears **only** for users who pass that gate (the main app nav / shell).

## §2 · Data layer

- **RLS:** new policy `trade_steps_standard_write` allowing `INSERT`/`UPDATE` on firm-standard rows (`project_id IS NULL AND source='standard'`) when `current_can_manage_projects()`. The existing `trade_steps_custom_write` and `trade_steps_read` policies are unchanged. No `DELETE` policy (deactivate instead).
- **Audit columns:** add `updated_by uuid references staff(id)` and `updated_at timestamptz` to `trade_steps` (these are global edits worth attributing). RPCs set them; a trigger is unnecessary.
- **RPCs** (`SECURITY INVOKER` so RLS enforces the gate; each also re-checks `current_can_manage_projects()` for a clean error):
  - `update_standard_step(p_code, p_name, p_step_type, p_trade_role, p_typical_duration_days, p_lead_time_days, p_applicability jsonb, p_applies_to_area_types text[])` — edit the tunable fields (retag = updating `applies_to_area_types`).
  - `set_standard_step_active(p_code, p_active boolean)`.
  - `reorder_standard_steps(p_gate_code, p_codes text[])` — assigns `sort_order` = array index within the gate (one statement).
  - `add_standard_step(p_gate_code, p_name, p_step_type, p_trade_role, p_typical_duration_days, p_lead_time_days, p_applies_to_area_types text[])` — inserts a new firm-standard row with code `std_<uuid>` (internal id; users see the name; grouping is by `gate_code` per Piece A), `applicability='{}'`, `active=true`, appended (`sort_order` = current max in gate + 1).
- **Validation** (in every RPC): non-empty trimmed name; `typical_duration_days`/`lead_time_days` ≥ 0; `step_type ∈ {decision,procurement,site_work,inspection}`; `p_gate_code` exists in `gates`; `applies_to_area_types ⊆` the `area_type` enum values.
- **Grants:** `execute` to `authenticated` (RLS + the in-RPC check do the gating).

## §3 · UI & operations

- **Layout:** gate-grouped (A–H) collapsible sections; within each, steps in `sort_order`. A row shows: name · type chip · trade_role · `dur/lead` · `applies_to_area_types` chips · active toggle.
- **Edit:** inline per-row edit (expand a small editor with the fields above) → `update_standard_step`. The editor submits the full set of current field values (full-row update, not partial-patch). Retag = a room-type multi-select on that editor. The raw `applicability` jsonb (finish-profile conditions like floor-material) is **passed through unchanged** — the RPC accepts it for completeness, but the v1 editor does not surface a jsonb editor (editing those conditions stays migration-managed; see Out of scope).
- **Reorder:** up/down controls within a gate (mobile-safe; drag is a deferred nicety) → `reorder_standard_steps`.
- **Add:** "+ Tambah langkah" per gate → a small form (name, type, trade, dur, lead, room-tags) → `add_standard_step`.
- **Deactivate/restore:** the active toggle → `set_standard_step_active`; inactive steps collapse into a dimmed "Nonaktif" subsection per gate.
- **Conventions:** `"use client"` editors; server actions returning `{ ok: true } | { ok: false; error: string }`; `useTransition` + `router.refresh()` on success; `min-h-11 md:min-h-0` touch targets; CSS-var Tailwind; Bahasa Indonesia sentence-case. Reuses the `gateShortName` labels and the `AreaStepRow`/catalog patterns where applicable.

## §4 · Propagation & boundaries

- Persistent banner on the page: *"Perubahan di sini hanya memengaruhi seeding ruangan BARU dan langkah yang ditambahkan lewat 'Dari rekomendasi'. Checklist yang sudah ada tidak berubah."*
- So Piece B mutates templates only; existing `area_steps` are never rewritten (consistent with Piece A's opt-in-pull).
- **Consequence (documented, accepted):** the firm-standard library becomes runtime-mutable prod data, diverging from local/dev which carries only the migration seed — same as any user-editable prod data. Migrations remain the source of the *initial* library.

## Testing

- Pure helpers unit-tested (vitest, no Supabase): step grouping/sort for the page, and any validation/normalisation helper (e.g. room-type validation, reorder index assignment if extracted).
- RPCs validated on the local stack (apply migration, exercise each RPC + the RLS gate as a non-manager).
- Admin-gating + the edit/reorder/add/deactivate flows browser-verified on prod after `db push`.

## Out of scope (later pieces)

- Promoting per-project custom steps into the firm-standard library (the learning loop).
- Editing the **dependency graph** (predecessors) and **checkpoints** of standard steps.
- Editing the raw `applicability` jsonb (finish-profile conditions) — the editor preserves the existing value; retag (`applies_to_area_types`) covers room-type scoping.
- Drag-and-drop reorder (up/down suffices for v1).
- Bulk operations / import-export of the library.
