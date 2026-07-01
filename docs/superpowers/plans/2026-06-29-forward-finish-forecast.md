# Forward-Looking Finish Forecast Implementation Plan (capstone)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure forward-forecast engine projecting each area's finish from today + actuals along the dependency graph, a per-project query + rollup, and a projected-handover / slip-days line on `/risiko`.

**Architecture:** `forecastArea` mirrors back-schedule's forward topological pass but seeds from today + actuals (baseline = the area's `max(target_end_date)` handover target). `getProjectForecast` runs it per area and rolls up to the worst area. `/risiko` gains the forecast per project.

**Tech Stack:** Next.js, Supabase, vitest, `@datum/core`. No new deps, no schema change.

**Spec:** `docs/superpowers/specs/2026-06-29-forward-finish-forecast-design.md`

## Global Constraints

- Calendar days. Reuse `addDays` from `@/lib/steps/back-schedule`; add `daysBetween(a,b)` (round, on `slice(0,10)`).
- **Done** = `accepted` ∪ `done_with_defects`; `not_applicable` excluded.
- `span(s) = typical_duration_days + (step_type === "procurement" ? lead_time_days : 0)`, coerced ≥ 0.
- Baseline = area handover **target** (`max(area_gate_status.target_end_date)`), NOT `max(planned_end)`. `slipDays > 0` = projected past target = late; negative = ahead; `null` = no target.
- Degradation is intentional: not-started steps anchor at `max(planned_start, today, predFinish)` when `planned_start` exists (bathrooms → precise), else `max(today, predFinish)` (ASAP → conservative, no false positives).
- **Verify:** pure → vitest TDD (exhaustive); `pnpm -C apps/web typecheck` + `pnpm -C apps/web build` (Node 22 via nvm: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`). Engine also goes through adversarial verification (controller) before PR.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/steps/forecast.ts` | pure `forecastArea` + `daysBetween` + types |
| `apps/web/tests/unit/forecast.test.ts` | hand-worked scenario tests |
| `apps/web/lib/steps/forecast-queries.ts` | `getProjectForecast` + rollup |
| `apps/web/lib/steps/slip-risk-queries.ts` | attach `forecast` per project + sort |
| `apps/web/app/(app)/risiko/page.tsx` | forecast line per row |

---

## Task 1: Pure forecast engine (TDD, exhaustive)

**Files:** Create `apps/web/lib/steps/forecast.ts`; create `apps/web/tests/unit/forecast.test.ts`.

**Interfaces:** Produces `ForecastStep`, `AreaForecast`, `daysBetween(a,b)`, `forecastArea(steps, deps, today, target)`.

- [ ] **Step 1: Write the failing tests** (hand-computed dates)

Create `apps/web/tests/unit/forecast.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { forecastArea, daysBetween, type ForecastStep } from "@/lib/steps/forecast";
import type { TradeStepDep } from "@/lib/steps/types";

const TODAY = "2026-07-01";
const step = (o: Partial<ForecastStep> & { step_code: string }): ForecastStep => ({
  step_type: "site_work", status: "not_started", typical_duration_days: 1, lead_time_days: 0,
  planned_start: null, actual_start: null, actual_end: null, ...o,
});
const dep = (step_code: string, predecessor_code: string): TradeStepDep => ({ step_code, predecessor_code });

describe("daysBetween", () => {
  it("whole calendar days, signed", () => {
    expect(daysBetween("2026-06-30", "2026-07-07")).toBe(7);
    expect(daysBetween("2026-07-07", "2026-06-30")).toBe(-7);
    expect(daysBetween("2026-07-01T09:00:00Z", "2026-07-03T20:00:00Z")).toBe(2);
  });
});

describe("forecastArea", () => {
  it("late in-progress procurement pushes downstream site work → slip", () => {
    const steps = [
      step({ step_code: "P", step_type: "procurement", typical_duration_days: 1, lead_time_days: 14, status: "in_progress", actual_start: "2026-06-01", planned_start: "2026-06-01" }),
      step({ step_code: "W", step_type: "site_work", typical_duration_days: 5, status: "not_started", planned_start: "2026-06-20" }),
    ];
    const r = forecastArea(steps, [dep("W", "P")], TODAY, "2026-06-30");
    // P: span15, elapsed30 ⇒ remaining1 ⇒ end 07-02. W: pred 07-02, span5 ⇒ end 07-07.
    expect(r.projectedFinish).toBe("2026-07-07");
    expect(r.slipDays).toBe(7);
    expect(r.complete).toBe(false);
  });

  it("on-schedule bathroom → slip 0", () => {
    const steps = [
      step({ step_code: "A", typical_duration_days: 3, planned_start: "2026-07-10" }),
      step({ step_code: "B", typical_duration_days: 2, planned_start: "2026-07-13" }),
    ];
    const r = forecastArea(steps, [dep("B", "A")], TODAY, "2026-07-15");
    // A: start 07-10 +3 ⇒ 07-13. B: pred 07-13, start max(07-13,today) +2 ⇒ 07-15.
    expect(r.projectedFinish).toBe("2026-07-15");
    expect(r.slipDays).toBe(0);
    expect(r.hasPlan).toBe(true);
  });

  it("all done → complete, projected = max actual_end, slip = actual vs target", () => {
    const steps = [
      step({ step_code: "A", status: "accepted", actual_end: "2026-06-28" }),
      step({ step_code: "B", status: "done_with_defects", actual_end: "2026-07-02" }),
    ];
    const r = forecastArea(steps, [], TODAY, "2026-06-30");
    expect(r.complete).toBe(true);
    expect(r.projectedFinish).toBe("2026-07-02");
    expect(r.slipDays).toBe(2);
  });

  it("ASAP degradation (no planned_start) — conservative, hasPlan false, ahead of a far target", () => {
    const steps = [
      step({ step_code: "A", typical_duration_days: 4 }),
      step({ step_code: "B", typical_duration_days: 3 }),
    ];
    const r = forecastArea(steps, [dep("B", "A")], TODAY, "2026-08-01");
    // A: today+4 ⇒ 07-05. B: pred 07-05 +3 ⇒ 07-08. target 08-01 ⇒ negative slip.
    expect(r.projectedFinish).toBe("2026-07-08");
    expect(r.slipDays! < 0).toBe(true);
    expect(r.hasPlan).toBe(false);
  });

  it("procurement span includes lead; non-procurement does not", () => {
    const proc = forecastArea([step({ step_code: "P", step_type: "procurement", typical_duration_days: 2, lead_time_days: 10 })], [], TODAY, null);
    expect(proc.projectedFinish).toBe("2026-07-13"); // today + 12
    const site = forecastArea([step({ step_code: "S", step_type: "site_work", typical_duration_days: 2, lead_time_days: 10 })], [], TODAY, null);
    expect(site.projectedFinish).toBe("2026-07-03"); // today + 2 (lead ignored)
  });

  it("edges: empty / all not_applicable / null target / cycle-safe", () => {
    expect(forecastArea([], [], TODAY, "2026-07-10")).toEqual({ target: "2026-07-10", projectedFinish: null, slipDays: null, complete: false, hasPlan: false });
    expect(forecastArea([step({ step_code: "X", status: "not_applicable" })], [], TODAY, "2026-07-10").projectedFinish).toBeNull();
    expect(forecastArea([step({ step_code: "A", typical_duration_days: 2 })], [], TODAY, null).slipDays).toBeNull();
    // cycle A→B→A must not hang and must resolve both
    const cyc = forecastArea([step({ step_code: "A", typical_duration_days: 1 }), step({ step_code: "B", typical_duration_days: 1 })], [dep("A", "B"), dep("B", "A")], TODAY, null);
    expect(cyc.projectedFinish).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm -C apps/web test -- forecast` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `apps/web/lib/steps/forecast.ts`:
```ts
import type { StepStatus, StepType, TradeStepDep } from "@/lib/steps/types";
import { addDays } from "@/lib/steps/back-schedule";

const DAY_MS = 86_400_000;

export type ForecastStep = {
  step_code: string;
  step_type: StepType;
  status: StepStatus;
  typical_duration_days: number;
  lead_time_days: number;
  planned_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
};

export type AreaForecast = {
  target: string | null;
  projectedFinish: string | null;
  slipDays: number | null;
  complete: boolean;
  hasPlan: boolean;
};

/** Whole calendar days a→b (b later ⇒ positive), on the YYYY-MM-DD date slices. */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a.slice(0, 10) + "T00:00:00Z");
  const db = Date.parse(b.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.round((db - da) / DAY_MS);
}

function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

const DONE = new Set<StepStatus>(["accepted", "done_with_defects"]);

/** Project an area's finish forward from today + actuals; compare to its handover target. */
export function forecastArea(
  steps: ForecastStep[],
  deps: TradeStepDep[],
  today: string,
  target: string | null,
): AreaForecast {
  const applicable = steps.filter((s) => s.status !== "not_applicable");
  if (applicable.length === 0) {
    return { target, projectedFinish: null, slipDays: null, complete: false, hasPlan: false };
  }
  const hasPlan = applicable.some((s) => s.planned_start != null);

  const byCode = new Map(applicable.map((s) => [s.step_code, s]));
  const predsOf = new Map<string, string[]>();
  for (const s of applicable) predsOf.set(s.step_code, []);
  for (const d of deps) {
    if (byCode.has(d.step_code) && byCode.has(d.predecessor_code)) {
      predsOf.get(d.step_code)!.push(d.predecessor_code);
    }
  }

  const span = (s: ForecastStep): number => {
    const dur = Number.isFinite(s.typical_duration_days) ? Math.max(0, s.typical_duration_days) : 0;
    const lead = s.step_type === "procurement" && Number.isFinite(s.lead_time_days) ? Math.max(0, s.lead_time_days) : 0;
    return dur + lead;
  };

  const projected = new Map<string, string>();
  const resolve = (s: ForecastStep, predFinish: string | null): string => {
    if (DONE.has(s.status)) return s.actual_end ?? s.actual_start ?? today;
    if (s.status === "in_progress") {
      const elapsed = s.actual_start ? Math.max(0, daysBetween(s.actual_start, today)) : 0;
      const remaining = Math.max(1, span(s) - elapsed);
      return addDays(maxIso(today, predFinish ?? today), remaining);
    }
    // not_started / blocked / stalled
    const startBasis = s.planned_start ? maxIso(s.planned_start, today) : today;
    const anchor = maxIso(startBasis, predFinish ?? startBasis);
    return addDays(anchor, span(s));
  };

  let guard = applicable.length * applicable.length + 1;
  while (projected.size < applicable.length && guard-- > 0) {
    for (const s of applicable) {
      if (projected.has(s.step_code)) continue;
      const preds = predsOf.get(s.step_code)!;
      if (!preds.every((p) => projected.has(p))) continue;
      const predFinish = preds.length
        ? preds.reduce<string | null>((acc, p) => (acc === null ? projected.get(p)! : maxIso(acc, projected.get(p)!)), null)
        : null;
      projected.set(s.step_code, resolve(s, predFinish));
    }
  }
  // Cycle fallback: resolve stragglers ignoring their (unresolvable) predecessors.
  for (const s of applicable) if (!projected.has(s.step_code)) projected.set(s.step_code, resolve(s, null));

  let projectedFinish: string | null = null;
  for (const v of projected.values()) projectedFinish = projectedFinish ? maxIso(projectedFinish, v) : v;

  const complete = applicable.every((s) => DONE.has(s.status));
  const slipDays = target && projectedFinish ? daysBetween(target, projectedFinish) : null;
  return { target, projectedFinish, slipDays, complete, hasPlan };
}
```

- [ ] **Step 4: Run → PASS, typecheck, commit**

`pnpm -C apps/web test -- forecast` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/steps/forecast.ts apps/web/tests/unit/forecast.test.ts
git commit -m "feat(forecast): pure forecastArea — project area finish from today + actuals"
```

---

## Task 2: Per-project query + rollup

**Files:** Create `apps/web/lib/steps/forecast-queries.ts`.

**Interfaces:** Consumes `forecastArea`/`AreaForecast` (Task 1). Produces `AreaForecastRow`, `ProjectForecast`, `getProjectForecast(supabase, projectId, today)`.

- [ ] **Step 1: Write the query**
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import type { StepStatus, StepType, TradeStepDep } from "@/lib/steps/types";
import { forecastArea, type AreaForecast } from "@/lib/steps/forecast";

export type AreaForecastRow = AreaForecast & { areaId: string; areaName: string };
export type ProjectForecast = {
  projectId: string;
  targetHandover: string | null;
  projectedHandover: string | null;
  slipDays: number | null;
  worstArea: { areaName: string; slipDays: number | null; projectedFinish: string | null } | null;
  areas: AreaForecastRow[];
};

/** Forecast every area of a project and roll up to the worst (critical) area. */
export async function getProjectForecast(
  supabase: SupabaseClient<Database>,
  projectId: string,
  today: string,
): Promise<ProjectForecast> {
  const { data: rawSteps, error: stepsErr } = await supabase
    .from("area_steps")
    .select(`step_code, status, planned_start, actual_start, actual_end, area_id,
      trade_steps:step_code ( step_type, lead_time_days, typical_duration_days )`)
    .eq("project_id", projectId);
  if (stepsErr) throw stepsErr;

  const { data: depsRaw, error: depsErr } = await supabase
    .from("trade_step_deps").select("step_code, predecessor_code");
  if (depsErr) throw depsErr;
  const deps = (depsRaw ?? []) as TradeStepDep[];

  const { data: gates, error: gatesErr } = await supabase
    .from("area_gate_status").select("area_id, target_end_date").eq("project_id", projectId);
  if (gatesErr) throw gatesErr;
  const targetOf = new Map<string, string>();
  for (const g of gates ?? []) {
    if (!g.target_end_date) continue;
    const cur = targetOf.get(g.area_id);
    if (!cur || g.target_end_date > cur) targetOf.set(g.area_id, g.target_end_date);
  }

  const areaIds = [...new Set((rawSteps ?? []).map((r) => r.area_id))];
  const areaNameMap = new Map<string, string>();
  if (areaIds.length > 0) {
    const { data: areas, error: areasErr } = await supabase
      .from("areas").select("id, area_name").in("id", areaIds);
    if (areasErr) throw areasErr;
    for (const a of areas ?? []) areaNameMap.set(a.id, a.area_name);
  }

  const byArea = new Map<string, typeof rawSteps>();
  for (const r of rawSteps ?? []) {
    const b = byArea.get(r.area_id) ?? [];
    b.push(r); byArea.set(r.area_id, b);
  }

  const areaRows: AreaForecastRow[] = [];
  for (const [areaId, rows] of byArea) {
    const steps = (rows ?? []).map((r) => {
      const t = r.trade_steps as { step_type: string; lead_time_days: number; typical_duration_days: number } | null;
      return {
        step_code: r.step_code,
        step_type: (t?.step_type ?? "site_work") as StepType,
        status: r.status as StepStatus,
        typical_duration_days: t?.typical_duration_days ?? 1,
        lead_time_days: t?.lead_time_days ?? 0,
        planned_start: r.planned_start ?? null,
        actual_start: r.actual_start ?? null,
        actual_end: r.actual_end ?? null,
      };
    });
    const fc = forecastArea(steps, deps, today, targetOf.get(areaId) ?? null);
    areaRows.push({ ...fc, areaId, areaName: areaNameMap.get(areaId) ?? areaId });
  }

  let targetHandover: string | null = null;
  let projectedHandover: string | null = null;
  let worst: AreaForecastRow | null = null;
  for (const a of areaRows) {
    if (a.target && (!targetHandover || a.target > targetHandover)) targetHandover = a.target;
    if (a.target && a.projectedFinish && (!projectedHandover || a.projectedFinish > projectedHandover)) projectedHandover = a.projectedFinish;
    if (a.slipDays != null && (worst === null || (worst.slipDays ?? -Infinity) < a.slipDays)) worst = a;
  }

  return {
    projectId,
    targetHandover,
    projectedHandover,
    slipDays: worst?.slipDays ?? null,
    worstArea: worst ? { areaName: worst.areaName, slipDays: worst.slipDays, projectedFinish: worst.projectedFinish } : null,
    areas: areaRows,
  };
}
```

- [ ] **Step 2: Typecheck + commit**

`pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/steps/forecast-queries.ts
git commit -m "feat(forecast): getProjectForecast — per-area forecast + worst-area rollup"
```

---

## Task 3: Attach to `/risiko`

**Files:** Modify `apps/web/lib/steps/slip-risk-queries.ts`, `apps/web/app/(app)/risiko/page.tsx`.

- [ ] **Step 1: Attach forecast per project** — in `slip-risk-queries.ts`:
  - import `getProjectForecast`, `type ProjectForecast`.
  - Add `forecast: ProjectForecast` to `ProjectSlipRow`.
  - In the `Promise.all(... .map(async (p) => {...}))`, after computing `risk`/`signalCount`, also `const forecast = await getProjectForecast(supabase, p.id, today);` and include it in the returned object.
  - Extend the sort: after the existing `LEVEL_RANK` / `behindCount` / `signalCount` comparators, add a tie-breaker `(b.forecast.slipDays ?? -Infinity) - (a.forecast.slipDays ?? -Infinity)` so the most-behind project floats up.

- [ ] **Step 2: Render the forecast line** — in `risiko/page.tsx`, inside each `<li>`, after the bottleneck line, add (when `r.forecast.slipDays != null`):
```tsx
{r.forecast.slipDays != null ? (
  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
    Perkiraan handover {r.forecast.projectedHandover ?? "—"}
    {r.forecast.slipDays > 0
      ? ` · +${r.forecast.slipDays} hari dari target${r.forecast.worstArea ? ` (${r.forecast.worstArea.areaName})` : ""}`
      : " · sesuai/di depan target"}
  </p>
) : null}
```
Use a red-ish class token when `slipDays > 0` if a suitable one exists (match the file's existing `text-red-700` usage); otherwise the muted token is fine.

- [ ] **Step 3: Typecheck + build + commit**

`pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add apps/web/lib/steps/slip-risk-queries.ts "apps/web/app/(app)/risiko/page.tsx"
git commit -m "feat(forecast): projected handover + slip-days line on /risiko"
```

---

## Task 4: Verification (controller-run)

> Pure engine: adversarial multi-lens review (workflow) before PR. UI + query: browser-verify on prod.

- [ ] Adversarial verification of `forecastArea` semantics (propagation, in-progress/actuals, ASAP degradation, back-schedule consistency, edges) confirms no correctness defect.
- [ ] `/risiko` shows a "Perkiraan handover … +N hari dari target" line on behind projects; on-track/ahead projects show "sesuai/di depan target"; projects without targets show no forecast line.
- [ ] No console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 engine → Task 1; §2 query/rollup → Task 2; §3 `/risiko` → Task 3; testing → Task 1 (unit) + Task 4 (adversarial + browser).
- **Type consistency:** `AreaForecast`/`ForecastStep`/`daysBetween` (Task 1) ↔ `getProjectForecast` (Task 2) ↔ `ProjectForecast` on `ProjectSlipRow` + page (Task 3). `today` threads from the page (already computed for #34).
- **Grounded:** `area_steps`/`trade_step_deps`/`area_gate_status`/`areas` selects mirror `getProjectStepSignals`; `target_end_date` is the universal baseline; `planned_start` bathroom-only → ASAP degradation.
- **Additive:** no schema change; `getProjectStepSignals` untouched (own isolated fetch); #34's level ranking preserved (forecast is a tie-breaker + a display line).
- **Verify-during-impl:** the exact `/risiko` `<li>` JSX + red token (Task 3 — read the file); `ProjectSlipRow` shape + sort comparator (Task 3 — read slip-risk-queries.ts).
