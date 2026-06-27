# Actuals → Duration Learning Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggregate completed steps' real durations across projects and let an admin apply the median as the revised firm-standard `typical_duration_days`, via a separate "Analisa Durasi" page.

**Architecture:** A pure aggregation module (`lib/learning/durations.ts`) computes calendar-day durations and per-step median/min/max/n. A query joins firm-standard steps with their actuals stats. A dedicated `SECURITY DEFINER` apply RPC (manager-gated) updates only the duration — fully decoupled from the parallel Piece B. An admin-gated page renders gate-grouped rows with a one-click "Terapkan" when n ≥ 5 and the median differs from the estimate.

**Tech Stack:** Next.js 16 App Router, React client components, Supabase (Postgres + RLS + SQL functions), `@datum/core`, Tailwind CSS-var theming, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-27-actuals-learning-loop-design.md`

## Global Constraints

- **Measurement = calendar days:** `durationDays = max(1, wholeDaysBetween(date(start), date(end)))` on the UTC date portions — matches `back-schedule.ts`'s calendar-day model (NOT working days).
- **Suggest only when `n ≥ 5` AND median ≠ estimate.** Below 5 (or n=0): no suggestion ("Belum cukup data"). Only instances with **both** `actual_start` and `actual_end` contribute.
- **Decoupled from Piece B:** own `SECURITY DEFINER apply_learned_duration` RPC (internal `current_can_manage_projects()` check, bypasses RLS); `add column if not exists updated_by/updated_at` (idempotent — coexists with Piece B's identical add). Separate route file `(app)/library/durations/`.
- **Admin-gated:** page + action re-check `canManageAccess(staff)` (principal/admin), mirroring `project/[slug]/settings`. Server actions return `{ ok: true } | { ok: false; error: string }`; `"use client"` view with `useTransition`/`router.refresh()`; `min-h-11 md:min-h-0`; CSS-var Tailwind; Bahasa Indonesia.
- **Verify per task:** pure logic → vitest TDD; `pnpm -C apps/web typecheck`; root `pnpm typecheck` + `pnpm test` (turbo, ALL workspaces incl. mobile) + `pnpm -C apps/web build` before any push. Migration apply + authoritative `gen types --local` + prod `db push` are controller/Wilson steps (local stack ports held — types are a hand-edited stopgap, same as Piece A/B).

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/learning/durations.ts` | pure: `durationDays`, `summarizeDurations`, `learnedDurationRows` + types |
| `apps/web/tests/unit/learning-durations.test.ts` | unit tests for the pure module |
| `packages/db/supabase/migrations/<ts>_learned_duration.sql` | idempotent audit cols + `apply_learned_duration` RPC + grants |
| `packages/db/src/types.generated.ts` | stopgap: audit cols + RPC signature |
| `apps/web/lib/learning/queries.ts` | `getDurationLearning(supabase)` |
| `apps/web/lib/learning/actions.ts` | `applyLearnedDuration` |
| `apps/web/components/learning/DurationLearningView.tsx` | gate-grouped rows + apply |
| `apps/web/app/(app)/library/durations/page.tsx` | admin-gated page + banner |
| app shell nav | gated "Analisa Durasi" link |

---

## Task 1: Pure aggregation module (TDD)

**Files:**
- Create: `apps/web/lib/learning/durations.ts`
- Test: `apps/web/tests/unit/learning-durations.test.ts`

**Interfaces:**
- Produces — `type DurationInstance = { step_code: string; actual_start: string; actual_end: string }`; `type StandardStepRow = { code: string; gate_code: string; name: string; typical_duration_days: number }`; `type DurationStats = { median: number; min: number; max: number; n: number }`; `type LearnedRow = { code: string; gate_code: string; gateName: string; name: string; estimate: number; stats: DurationStats | null; suggest: number | null }`; `durationDays(start, end): number`; `summarizeDurations(samples: number[]): DurationStats`; `learnedDurationRows(instances, steps, gateName: (g: string) => string): LearnedRow[]`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/learning-durations.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { durationDays, summarizeDurations, learnedDurationRows, type DurationInstance, type StandardStepRow } from "@/lib/learning/durations";

const gn = (g: string) => `${g}-name`;

describe("durationDays", () => {
  it("same-day = 1", () => expect(durationDays("2026-06-01T08:00:00Z", "2026-06-01T17:00:00Z")).toBe(1));
  it("counts whole days between dates, ignoring time-of-day", () =>
    expect(durationDays("2026-06-01T23:00:00Z", "2026-06-04T01:00:00Z")).toBe(3));
  it("clamps to >= 1 even if end <= start", () =>
    expect(durationDays("2026-06-02T00:00:00Z", "2026-06-01T00:00:00Z")).toBe(1));
});

describe("summarizeDurations", () => {
  it("odd n → middle value", () => expect(summarizeDurations([3, 1, 2]).median).toBe(2));
  it("even n → rounded mean of middles", () => expect(summarizeDurations([1, 2, 3, 6]).median).toBe(3)); // (2+3)/2=2.5→3
  it("reports min/max/n", () => expect(summarizeDurations([4, 1, 9])).toEqual({ median: 4, min: 1, max: 9, n: 3 }));
});

describe("learnedDurationRows", () => {
  const steps: StandardStepRow[] = [{ code: "D6", gate_code: "D", name: "Lantai", typical_duration_days: 6 }];
  const inst = (s: string, e: string): DurationInstance => ({ step_code: "D6", actual_start: s, actual_end: e });
  it("n=0 → stats null, suggest null", () => {
    const [r] = learnedDurationRows([], steps, gn);
    expect(r!.stats).toBeNull(); expect(r!.suggest).toBeNull(); expect(r!.gateName).toBe("D-name");
  });
  it("n=4 → stats shown, suggest null (below threshold)", () => {
    const rows = learnedDurationRows([inst("2026-06-01","2026-06-09"),inst("2026-06-01","2026-06-09"),inst("2026-06-01","2026-06-09"),inst("2026-06-01","2026-06-09")], steps, gn);
    expect(rows[0]!.stats!.n).toBe(4); expect(rows[0]!.suggest).toBeNull();
  });
  it("n>=5 & median != estimate → suggest = median", () => {
    const five = Array.from({ length: 5 }, () => inst("2026-06-01", "2026-06-09")); // 8 days each
    expect(learnedDurationRows(five, steps, gn)[0]!.suggest).toBe(8);
  });
  it("n>=5 & median == estimate → no suggest", () => {
    const five = Array.from({ length: 5 }, () => inst("2026-06-01", "2026-06-07")); // 6 days = estimate
    expect(learnedDurationRows(five, steps, gn)[0]!.suggest).toBeNull();
  });
  it("excludes instances missing actual_start/end", () => {
    const bad = [{ step_code: "D6", actual_start: "", actual_end: "2026-06-09" } as DurationInstance];
    expect(learnedDurationRows(bad, steps, gn)[0]!.stats).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm -C apps/web test -- learning-durations`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/learning/durations.ts`:
```ts
export type DurationInstance = { step_code: string; actual_start: string; actual_end: string };
export type StandardStepRow = { code: string; gate_code: string; name: string; typical_duration_days: number };
export type DurationStats = { median: number; min: number; max: number; n: number };
export type LearnedRow = {
  code: string;
  gate_code: string;
  gateName: string;
  name: string;
  estimate: number;
  stats: DurationStats | null;
  suggest: number | null;
};

const MIN_SAMPLE = 5;
const DAY_MS = 86_400_000;

/** Whole calendar days between the date portions (UTC), clamped to >= 1. Matches back-schedule's calendar-day model. */
export function durationDays(start: string, end: string): number {
  const s = Date.parse(start.slice(0, 10) + "T00:00:00Z");
  const e = Date.parse(end.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(s) || Number.isNaN(e)) return 1;
  return Math.max(1, Math.round((e - s) / DAY_MS));
}

export function summarizeDurations(samples: number[]): DurationStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { median: 0, min: 0, max: 0, n: 0 };
  const mid = Math.floor((n - 1) / 2);
  const median = n % 2 ? sorted[mid]! : Math.round((sorted[mid]! + sorted[mid + 1]!) / 2);
  return { median, min: sorted[0]!, max: sorted[n - 1]!, n };
}

/** Per firm-standard step: summarize its completed instances' durations; suggest the median when n >= 5 and it differs from the estimate. */
export function learnedDurationRows(
  instances: DurationInstance[],
  steps: StandardStepRow[],
  gateName: (g: string) => string,
): LearnedRow[] {
  const byCode = new Map<string, number[]>();
  for (const i of instances) {
    if (!i.actual_start || !i.actual_end) continue;
    const arr = byCode.get(i.step_code) ?? [];
    arr.push(durationDays(i.actual_start, i.actual_end));
    byCode.set(i.step_code, arr);
  }
  return steps.map((s) => {
    const samples = byCode.get(s.code) ?? [];
    const stats = samples.length ? summarizeDurations(samples) : null;
    const suggest = stats && stats.n >= MIN_SAMPLE && stats.median !== s.typical_duration_days ? stats.median : null;
    return { code: s.code, gate_code: s.gate_code, gateName: gateName(s.gate_code), name: s.name, estimate: s.typical_duration_days, stats, suggest };
  });
}
```

- [ ] **Step 4: Run → PASS, commit**

Run: `pnpm -C apps/web test -- learning-durations` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/learning/durations.ts apps/web/tests/unit/learning-durations.test.ts
git commit -m "feat(learning): pure duration aggregation (calendar-day median, n>=5 suggest)"
```

---

## Task 2: Migration — audit columns + apply RPC

**Files:**
- Create: `packages/db/supabase/migrations/<ts>_learned_duration.sql` (timestamp later than `20260626000001`, e.g. `20260627000001`)
- Modify: `packages/db/src/types.generated.ts`

**Interfaces:**
- Produces — `trade_steps.updated_by`/`updated_at` (idempotent); RPC `apply_learned_duration(p_code text, p_typical_duration_days int) → void`.

- [ ] **Step 1: Write the migration**

```sql
-- Learning loop: apply a learned median duration to a firm-standard step.
-- Decoupled from Piece B (SECURITY DEFINER + internal manage-check; idempotent audit cols).

alter table public.trade_steps
  add column if not exists updated_by uuid references public.staff(id),
  add column if not exists updated_at timestamptz;

create or replace function public.apply_learned_duration(p_code text, p_typical_duration_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang mengubah pustaka'; end if;
  if coalesce(p_typical_duration_days, 0) < 1 then raise exception 'durasi minimal 1 hari'; end if;
  update public.trade_steps
    set typical_duration_days = p_typical_duration_days, updated_by = auth.uid(), updated_at = now()
    where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;

revoke all on function public.apply_learned_duration(text, int) from public;
grant execute on function public.apply_learned_duration(text, int) to authenticated;
```

- [ ] **Step 2: Update generated types (stopgap)**

In `packages/db/src/types.generated.ts`:
- In `trade_steps` `Row`/`Insert`/`Update`, add `updated_at: string | null` / `updated_at?: string | null` and `updated_by: string | null` / `updated_by?: string | null` (alphabetically — after `typical_duration_days`, near each block's end). **If a parallel Piece B branch already added these, the merge yields one copy — that's expected; gen types produces them once.**
- In `Functions`, add (alphabetically):
```ts
      apply_learned_duration: {
        Args: { p_code: string; p_typical_duration_days: number }
        Returns: undefined
      }
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C packages/db typecheck` → PASS.
```bash
git add packages/db/supabase/migrations/<ts>_learned_duration.sql packages/db/src/types.generated.ts
git commit -m "feat(db): apply_learned_duration RPC + audit columns (decoupled from Piece B)"
```
> Migration apply + authoritative `gen types --local` + prod `db push` are controller/Wilson steps.

---

## Task 3: Learning query

**Files:**
- Create: `apps/web/lib/learning/queries.ts`

**Interfaces:**
- Consumes — `durationDays`/`learnedDurationRows`/`LearnedRow` (Task 1); `gateShortName` (`@datum/core`).
- Produces — `getDurationLearning(supabase): Promise<{ gate: string; gateName: string; rows: LearnedRow[] }[]>`.

- [ ] **Step 1: Write the query**

Create `apps/web/lib/learning/queries.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { gateShortName } from "@datum/core";
import { learnedDurationRows, type DurationInstance, type LearnedRow, type StandardStepRow } from "@/lib/learning/durations";

export async function getDurationLearning(
  supabase: SupabaseClient<Database>,
): Promise<{ gate: string; gateName: string; rows: LearnedRow[] }[]> {
  const [{ data: steps, error: e1 }, { data: inst, error: e2 }] = await Promise.all([
    supabase
      .from("trade_steps")
      .select("code, gate_code, name, typical_duration_days")
      .is("project_id", null).eq("source", "standard").eq("active", true)
      .order("gate_code").order("sort_order"),
    supabase
      .from("area_steps")
      .select("step_code, actual_start, actual_end")
      .in("status", ["accepted", "done_with_defects"])
      .not("actual_start", "is", null).not("actual_end", "is", null),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const rows = learnedDurationRows(
    (inst ?? []) as DurationInstance[],
    (steps ?? []) as unknown as StandardStepRow[],
    gateShortName,
  );

  const order: string[] = [];
  const byGate = new Map<string, LearnedRow[]>();
  for (const r of rows) {
    if (!byGate.has(r.gate_code)) { byGate.set(r.gate_code, []); order.push(r.gate_code); }
    byGate.get(r.gate_code)!.push(r);
  }
  return order.map((g) => ({ gate: g, gateName: gateShortName(g), rows: byGate.get(g)! }));
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/learning/queries.ts
git commit -m "feat(learning): getDurationLearning query (firm-standard steps × actuals)"
```

---

## Task 4: Apply action

**Files:**
- Create: `apps/web/lib/learning/actions.ts`

**Interfaces:**
- Consumes — `getCurrentStaff`/`canManageAccess` (`@/lib/auth/require-role`); `apply_learned_duration` RPC (Task 2).
- Produces — `LearningActionResult = { ok: true } | { ok: false; error: string }`; `applyLearnedDuration({ code, days })`.

- [ ] **Step 1: Write the action**

Create `apps/web/lib/learning/actions.ts`:
```ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";

export type LearningActionResult = { ok: true } | { ok: false; error: string };

export async function applyLearnedDuration(args: { code: string; days: number }): Promise<LearningActionResult> {
  const staff = await getCurrentStaff();
  if (!staff || !canManageAccess(staff)) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("apply_learned_duration", {
      p_code: args.code, p_typical_duration_days: args.days,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/learning/actions.ts
git commit -m "feat(learning): manager-gated applyLearnedDuration action"
```

---

## Task 5: DurationLearningView component

**Files:**
- Create: `apps/web/components/learning/DurationLearningView.tsx`

**Interfaces:**
- Consumes — `getDurationLearning` result; `applyLearnedDuration` (Task 4); `LearnedRow` (Task 1).
- Produces — `<DurationLearningView groups={Awaited<ReturnType<typeof getDurationLearning>>} />`.

- [ ] **Step 1: Write the component**

Create `apps/web/components/learning/DurationLearningView.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyLearnedDuration } from "@/lib/learning/actions";
import type { getDurationLearning } from "@/lib/learning/queries";

type Groups = Awaited<ReturnType<typeof getDurationLearning>>;

function GateSection({ g }: { g: Groups[number] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function apply(code: string, days: number) {
    setError(null);
    startTransition(async () => {
      const r = await applyLearnedDuration({ code, days });
      if (r.ok) router.refresh(); else setError(r.error);
    });
  }

  return (
    <details className="rounded border border-[var(--border)] bg-[var(--surface)]" open>
      <summary className="min-h-11 cursor-pointer px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--foreground)] md:min-h-0">
        {g.gate} · {g.gateName}
      </summary>
      {g.rows.map((r) => (
        <div key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-4 py-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{r.name}</span>
          <span className="text-[11px] text-[var(--text-muted)]">Estimasi {r.estimate}h</span>
          {r.stats ? (
            <span className="text-[11px] text-[var(--text-muted)]">
              Aktual median {r.stats.median}h (n={r.stats.n}) · {r.stats.min}–{r.stats.max}h
            </span>
          ) : (
            <span className="text-[11px] text-[var(--text-muted)]">Belum cukup data</span>
          )}
          {r.suggest !== null ? (
            <button type="button" disabled={pending} onClick={() => apply(r.code, r.suggest!)}
              className="min-h-11 rounded border border-[var(--sand-dark)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-semibold text-[var(--sand-dark)] disabled:opacity-50 md:min-h-0">
              Terapkan {r.suggest}h
            </button>
          ) : r.stats && r.stats.n < 5 ? (
            <span className="text-[10px] text-[var(--text-muted)]">Belum cukup data untuk saran</span>
          ) : null}
        </div>
      ))}
      {error ? <p className="border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--flag-critical)]">{error}</p> : null}
    </details>
  );
}

export function DurationLearningView({ groups }: { groups: Groups }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => <GateSection key={g.gate} g={g} />)}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/learning/DurationLearningView.tsx
git commit -m "feat(learning): DurationLearningView with one-click Terapkan"
```

---

## Task 6: Admin-gated page + nav link

**Files:**
- Create: `apps/web/app/(app)/library/durations/page.tsx`
- Modify: the app shell nav (read `apps/web/app/(app)/layout.tsx` + the nav component to find where links live)

**Interfaces:**
- Consumes — `getDurationLearning` (Task 3), `DurationLearningView` (Task 5), `getCurrentStaff`/`canManageAccess`.

- [ ] **Step 1: Write the page**

Create `apps/web/app/(app)/library/durations/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { getDurationLearning } from "@/lib/learning/queries";
import { DurationLearningView } from "@/components/learning/DurationLearningView";

export default async function DurationLearningPage() {
  const caller = await getCurrentStaff();
  if (!caller || !canManageAccess(caller)) redirect("/");

  const supabase = await createSupabaseServerClient();
  const groups = await getDurationLearning(supabase);

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#7A6B56]">Pengaturan firma</p>
        <h1 className="text-2xl font-semibold text-[#141210]">Analisa Durasi</h1>
      </header>
      <div className="mb-4 rounded border border-[var(--sand)] bg-[var(--sand-tint)] px-3 py-2 text-xs text-[var(--sand-dark)]">
        Durasi aktual dihitung dari langkah yang sudah selesai (kalender hari, start → selesai). Menerapkan saran
        hanya memengaruhi seeding ruangan BARU; checklist yang sudah ada tidak berubah.
      </div>
      <DurationLearningView groups={groups} />
    </div>
  );
}
```

- [ ] **Step 2: Add the gated nav link**

Read `apps/web/app/(app)/layout.tsx` (and its nav component) to find how links are defined and where the current staff/role is available. Add a link to `/library/durations` labelled "Analisa Durasi", rendered only when the staff passes `canManageAccess`. Follow the exact pattern used for any existing role-conditional nav item (and the "Pustaka Langkah" link if Piece B has merged it — place "Analisa Durasi" beside it). Keep styling consistent.

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add "apps/web/app/(app)/library/durations/page.tsx" "apps/web/app/(app)/layout.tsx"
git commit -m "feat(learning): Analisa Durasi admin page + gated nav link"
```

---

## Task 7: Browser verification (controller-run)

> Controller-run; needs the migration on prod (`supabase db push`) + a principal/admin session + at least one firm-standard step with ≥5 completed instances (or accept "Belum cukup data" everywhere with current data).

- [ ] As principal/admin, open `/library/durations` → gate sections render; each firm-standard step shows Estimasi; banner present.
- [ ] With current prod data (sparse actuals), most rows read "Belum cukup data" — confirm no error, n=0 handled.
- [ ] If/when a step has ≥5 completed instances with a median ≠ estimate, "Terapkan {median}h" appears; clicking it updates `typical_duration_days` (verify in `/library/steps` or DB) and the row refreshes.
- [ ] As a non-manager, `/library/durations` redirects to `/`, the nav link is absent, and a direct RPC call is refused.
- [ ] Confirm applying changes only future seeding (opt-in-pull) — existing room checklists unchanged.
- [ ] Screenshot for the user. No console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 measurement/aggregation → Task 1 (pure + TDD); §2 data/apply → Task 2 (RPC/cols) + Task 3 (query) + Task 4 (action); §3 surface → Tasks 5 (view) + 6 (page/nav); §4 scope (durations-only, on-demand, decoupled) honored; testing → Task 1 (pure) + Task 7 (browser).
- **Type consistency:** `LearnedRow`/`DurationInstance`/`StandardStepRow`/`DurationStats` defined Task 1, consumed Tasks 3/5; `getDurationLearning` return shape defined Task 3, consumed Tasks 5/6; `applyLearnedDuration` defined Task 4, consumed Task 5; RPC arg names match Task 2 ↔ Task 4 (`p_code`, `p_typical_duration_days`).
- **Grounded:** `gateShortName`/`canManageAccess`/`getCurrentStaff` confirmed exported; `back-schedule.ts` is calendar-day (durationDays matches); `--flag-critical` CSS var exists (used by settings page).
- **Verify-during-impl:** nav location + role context (Task 6 Step 2); `updated_at`/`updated_by` stopgap placement + the Piece-B coexistence note (Task 2 Step 2); confirm `area_steps.status` accepts the `.in([...])` filter values (`accepted`/`done_with_defects` are real statuses).
