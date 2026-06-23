# Readiness Slice 2a-2 (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the Gate B steps on the project schedule page as a collapsible per-bathroom checklist with flexible status, progress updates, checkpoints, and the "Perlu perhatian" flags — wired to the 2a-1 backend.

**Architecture:** Server component fetches `getAreaStepView` per bathroom area and renders a client `AreaStepsPanel` (3-level disclosure: area → step list → step detail). Thin `"use server"` wrappers (`submitStepUpdate`, `submitCheckpointResult`) call the tested core mutations and return `{ok}|{error}`; client components call them via `useTransition` + `router.refresh()` — exactly the `AreaTargetEditor` pattern.

**Tech Stack:** Next.js 16 App Router, React client components, Tailwind with CSS-var colors, Supabase. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-23-readiness-step-ui-2a-design.md` (§3, §4, §8). Backend (built, on prod): `getAreaStepView`, `updateAreaStep`, `setCheckpointResult` in `apps/web/lib/steps/`.

## Global Constraints
- Match `AreaTargetEditor` conventions: `"use client"`, `useState`/`useTransition`/`useRouter`, server action returns `{ ok: true } | { ok: false; error: string }`, `router.refresh()` on success, mobile-first touch targets (`min-h-11 md:min-h-0`), Tailwind classes using CSS vars (`var(--surface)`, `var(--border)`, `var(--foreground)`, `var(--text-muted)`, `var(--sand-dark)`, `var(--sand-tint)`).
- UI strings Bahasa Indonesia, sentence case. Keep it uncluttered: collapsed by default; one contextual action per step at the list level; details on tap (spec §3).
- Verify each task with `pnpm -C apps/web typecheck` (+ `pnpm -C apps/web test` stays green at 199). Browser verification is run by the controller at the end (needs a real bathroom area with seeded steps).

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/matrix/fetch-matrix.ts` | add `area_type` to `MatrixArea` |
| `apps/web/lib/steps/actions.ts` | `"use server"` wrappers: `submitStepUpdate`, `submitCheckpointResult` |
| `apps/web/components/schedule/StepDetail.tsx` | one step's detail: status control + Tambah update + checkpoints + Blokir |
| `apps/web/components/schedule/AreaStepsPanel.tsx` | collapsible panel: Perlu perhatian + ordered step rows (expands StepDetail) |
| `apps/web/app/(app)/project/[slug]/schedule/page.tsx` | fetch step views for bathroom areas; render the panel section |

---

## Task 1: Expose `area_type` from the matrix

**Files:** Modify `apps/web/lib/matrix/fetch-matrix.ts`

**Interfaces:** Produces — `MatrixArea` gains `area_type: string`.

- [ ] **Step 1: Add `area_type` to the type and the select**

In `apps/web/lib/matrix/fetch-matrix.ts`, add `area_type: string;` to `MatrixArea`, and change the areas select to:
```typescript
  const { data: areaRows } = await supabase
    .from("areas")
    .select("id, area_code, area_name, floor, sort_order, area_type")
    .eq("project_id", projectId)
    .order("sort_order");
```

- [ ] **Step 2: Typecheck + commit**

Run (from `apps/web/`): `pnpm typecheck` → PASS.
```bash
git add apps/web/lib/matrix/fetch-matrix.ts
git commit -m "feat(matrix): expose area_type on MatrixArea"
```

---

## Task 2: Server-action wrappers

**Files:** Create `apps/web/lib/steps/actions.ts`

**Interfaces:**
- Consumes: `updateAreaStep`, `setCheckpointResult` (lib/steps/mutations.ts); `getCurrentStaff` (lib/auth/require-role).
- Produces: `submitStepUpdate(args): Promise<StepActionResult>` and `submitCheckpointResult(args): Promise<StepActionResult>` where `StepActionResult = { ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Write the actions**

```typescript
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/require-role";
import { updateAreaStep, setCheckpointResult } from "@/lib/steps/mutations";

export type StepActionResult = { ok: true } | { ok: false; error: string };

export async function submitStepUpdate(args: {
  areaStepId: string;
  status?: "not_started" | "in_progress" | "blocked" | "done";
  note?: string;
  percentComplete?: number;
}): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk mengubah langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    await updateAreaStep(supabase, { ...args, loggedByStaffId: staff.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function submitCheckpointResult(args: {
  checkpointId: string;
  result: "pending" | "pass" | "fail";
}): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk mengubah checkpoint" };
  const supabase = await createSupabaseServerClient();
  try {
    await setCheckpointResult(supabase, { ...args, checkedByStaffId: staff.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.
```bash
git add apps/web/lib/steps/actions.ts
git commit -m "feat(steps): server-action wrappers submitStepUpdate / submitCheckpointResult"
```

---

## Task 3: `StepDetail` component (Level 3)

**Files:** Create `apps/web/components/schedule/StepDetail.tsx`

**Interfaces:**
- Consumes: `submitStepUpdate`, `submitCheckpointResult` (Task 2); `AreaStepRow` (lib/steps/queries.ts).
- Produces: `<StepDetail step={AreaStepRow} />` (client).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitStepUpdate, submitCheckpointResult } from "@/lib/steps/actions";
import type { AreaStepRow } from "@/lib/steps/queries";

const STATUS_LABEL: Record<string, string> = {
  not_started: "Belum mulai",
  in_progress: "Berjalan",
  blocked: "Terblokir",
  done: "Selesai",
};

export function StepDetail({ step }: { step: AreaStepRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) { setNote(""); router.refresh(); }
      else setError(res.error);
    });
  }

  function setStatus(status: "not_started" | "in_progress" | "blocked" | "done") {
    if (status === "blocked") {
      const reason = window.prompt("Alasan terblokir?") ?? "";
      if (!reason.trim()) return;
      run(() => submitStepUpdate({ areaStepId: step.id, status, note: reason.trim() }));
      return;
    }
    run(() => submitStepUpdate({ areaStepId: step.id, status }));
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-3">
      <div className="mb-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
        {step.planned_start ? <span>Rencana {step.planned_start} – {step.planned_end}</span> : null}
        {step.assigned_trade ? <span>· {step.assigned_trade}</span> : null}
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {(["not_started", "in_progress", "blocked", "done"] as const).map((s) => (
          <button key={s} type="button" disabled={pending} onClick={() => setStatus(s)}
            className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        <input value={note} disabled={pending} onChange={(e) => setNote(e.target.value)}
          placeholder="Tambah update progres…"
          className="min-h-11 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] focus:border-[var(--sand-dark)] focus:outline-none md:min-h-0" />
        <button type="button" disabled={pending || !note.trim()}
          onClick={() => run(() => submitStepUpdate({ areaStepId: step.id, note: note.trim() }))}
          className="min-h-11 rounded border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] hover:border-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
          Catat
        </button>
      </div>

      {step.checkpoints.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {step.checkpoints.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[12px] text-[var(--foreground)]">
              <input type="checkbox" checked={c.result === "pass"} disabled={pending}
                onChange={(e) => run(() => submitCheckpointResult({ checkpointId: c.id, result: e.target.checked ? "pass" : "pending" }))} />
              <span>{c.item_text}</span>
              {c.severity === "kritis" ? <span className="ml-auto rounded-sm bg-red-100 px-1 text-[9px] font-bold uppercase text-red-700">kritis</span> : null}
            </label>
          ))}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.
```bash
git add apps/web/components/schedule/StepDetail.tsx
git commit -m "feat(schedule): StepDetail — status control, update, checkpoints"
```

---

## Task 4: `AreaStepsPanel` component (Levels 1 & 2)

**Files:** Create `apps/web/components/schedule/AreaStepsPanel.tsx`

**Interfaces:**
- Consumes: `StepDetail` (Task 3); `getAreaStepView` result types (`AreaStepRow`, `AreaFlags`).
- Produces: `<AreaStepsPanel areaName={string} steps={AreaStepRow[]} flags={AreaFlags} />` (client).

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { StepDetail } from "@/components/schedule/StepDetail";
import type { AreaStepRow } from "@/lib/steps/queries";
import type { AreaFlags } from "@/lib/steps/flags";

const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  blocked: { label: "Terblokir", cls: "bg-red-100 text-red-800" },
  stalled: { label: "Mandek", cls: "bg-red-100 text-red-800" },
  accepted: { label: "Selesai", cls: "bg-green-100 text-green-800" },
  done_with_defects: { label: "Selesai (ada defect)", cls: "bg-amber-100 text-amber-800" },
};

export function AreaStepsPanel({ areaName, steps, flags }: { areaName: string; steps: AreaStepRow[]; flags: AreaFlags }) {
  const [open, setOpen] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const done = steps.filter((s) => s.status === "accepted" || s.status === "done_with_defects").length;
  const nameOf = (code: string | null) => steps.find((s) => s.step_code === code)?.step_code ?? code;

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--surface)]">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--foreground)]">{areaName}</div>
          <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">{done}/{steps.length} selesai</div>
        </div>
        <span className="text-[var(--text-muted)]">{open ? "▾" : "▸"}</span>
      </button>

      {flags.readyToStart || flags.needsDecision.length > 0 ? (
        <div className="border-t border-[var(--border)] bg-[var(--sand-tint)] px-4 py-2 text-[11px] text-[var(--sand-dark)]">
          {flags.readyToStart ? <span className="mr-3">Siap dimulai: {nameOf(flags.readyToStart)}</span> : null}
          {flags.needsDecision.length > 0 ? <span>Perlu keputusan: {flags.needsDecision.map(nameOf).join(", ")}</span> : null}
        </div>
      ) : null}

      {open ? (
        <div className="border-t border-[var(--border)]">
          {steps.map((s) => {
            const chip = CHIP[s.status] ?? CHIP.not_started;
            const isOpen = openStep === s.id;
            const dimmed = s.status === "accepted" || s.status === "done_with_defects";
            return (
              <div key={s.id}>
                <button type="button" onClick={() => setOpenStep(isOpen ? null : s.id)}
                  className={`flex w-full items-center gap-2.5 border-t border-[var(--border)] px-4 py-2.5 text-left ${dimmed ? "opacity-60" : ""}`}>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                  <span className="text-[13px] text-[var(--foreground)]">{s.step_code}</span>
                  <span className="flex-1" />
                  {flags.readyToStart === s.step_code ? <span className="text-[10px] text-[var(--sand-dark)]">siap</span> : null}
                  <span className="text-[var(--text-muted)]">{isOpen ? "▾" : "▸"}</span>
                </button>
                {isOpen ? <StepDetail step={s} /> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
```

> Note: this renders `step_code` as the step label. The plan's backend `AreaStepRow` carries `step_code` but not the display name; if the controller wants friendly names, extend `getAreaSteps` to also select `trade_steps.name` and render that — a 1-line query addition deferred to keep this slice minimal.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck` → PASS.
```bash
git add apps/web/components/schedule/AreaStepsPanel.tsx
git commit -m "feat(schedule): AreaStepsPanel — collapsible step checklist + flags"
```

---

## Task 5: Wire the panel into the schedule page

**Files:** Modify `apps/web/app/(app)/project/[slug]/schedule/page.tsx`

**Interfaces:** Consumes `getAreaStepView` (lib/steps/queries), `AreaStepsPanel` (Task 4).

- [ ] **Step 1: Add the imports** (top of file)

```typescript
import { getAreaStepView } from "@/lib/steps/queries";
import { AreaStepsPanel } from "@/components/schedule/AreaStepsPanel";
```

- [ ] **Step 2: Fetch step views for bathroom areas** (after `const areaTargets = await getAreaTargetDates(project.id);`)

```typescript
  const bathroomAreas = (matrix?.areas ?? []).filter((a) => a.area_type === "bathroom");
  const stepViews = await Promise.all(
    bathroomAreas.map(async (a) => ({ area: a, view: await getAreaStepView(supabase, a.id) })),
  );
```

- [ ] **Step 3: Render the section** (insert just before the `<section className="mb-6">` Gantt section)

```tsx
      {stepViews.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--foreground)]">
            Langkah pekerjaan — kamar mandi
          </h2>
          <div className="flex flex-col gap-2">
            {stepViews.map(({ area, view }) => (
              <AreaStepsPanel key={area.id} areaName={area.area_name} steps={view.steps} flags={view.flags} />
            ))}
          </div>
        </section>
      ) : null}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm typecheck` → PASS.
```bash
git add apps/web/app/(app)/project/[slug]/schedule/page.tsx
git commit -m "feat(schedule): render per-bathroom step checklist on the schedule page"
```

---

## Task 6: Browser verification (controller-run)

> Run by the controller, not a subagent — needs the dev server + a real bathroom area with seeded steps.

- [ ] Start the dev server (`preview_start`). On a project with a `bathroom` area (create one via the board/settings if none — the createArea hook seeds its steps), open `/project/<CODE>/schedule`.
- [ ] Confirm the "Langkah pekerjaan — kamar mandi" section shows the collapsed area; expand it; the ordered steps render with status chips.
- [ ] Tap a step → StepDetail opens; set status to Berjalan → chip updates after refresh; add an update → no error; tick the checkpoint.
- [ ] Confirm "Perlu perhatian" shows Siap dimulai / Perlu keputusan when applicable.
- [ ] Screenshot for the user.

---

## Self-review checklist (plan author)
- **Spec coverage (§3 3-level disclosure, §4 flexible status + Tambah update, §6 flags, §8 components):** Task 3 (status control + update + checkpoints) ✓; Task 4 (collapse + flags + rows) ✓; Tasks 2/5 (wiring) ✓.
- **Type consistency:** `submitStepUpdate`/`submitCheckpointResult` (Task 2) consumed by StepDetail (Task 3); `AreaStepRow.checkpoints` (2a-1 Task 7) consumed by StepDetail; `AreaFlags` (2a-1 Task 4) consumed by AreaStepsPanel; `area_type` (Task 1) consumed in the page (Task 5).
- **Known simplification (flagged):** rows show `step_code` not the friendly name (deferred 1-line query addition). Manual add/edit (2a′), silence (2b), AI button remain roadmap.
