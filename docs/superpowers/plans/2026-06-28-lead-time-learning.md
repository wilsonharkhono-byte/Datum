# Lead-Time Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend #27's learning loop so `procurement` steps learn their realized order→arrival actual into `lead_time_days` (the rest unchanged), surfaced on the same `/library/durations` page with a parallel apply RPC.

**Architecture:** Make `learnedDurationRows` metric-aware (`procurement → lead_time`, else `duration`), fetch `step_type`/`lead_time_days`, add `apply_learned_lead_time` RPC + action, route the view's "Terapkan" by `row.metric`. Additive — no change to `apply_learned_duration` or non-procurement behavior.

**Tech Stack:** Next.js, Supabase, vitest, `@datum/core`. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-28-lead-time-learning-design.md`

## Global Constraints

- `metric = step_type === "procurement" ? "lead_time" : "duration"`; `estimate` = the routed column; suggest = median when `n≥5 && median !== estimate`. Same `durationDays`/`MIN_SAMPLE` as #27.
- `apply_learned_lead_time` is `SECURITY DEFINER`, manager-gated, validates `lead_time_days >= 0` (lead can be 0, unlike duration's `>= 1`).
- Additive only — do NOT alter `apply_learned_duration`, `applyLearnedDuration`, or the suggestion behavior for non-procurement steps.
- **Verify:** pure → vitest TDD (extend `apps/web/tests/unit/learning-durations.test.ts`); `pnpm -C apps/web typecheck`; `pnpm -C apps/web build` (Node 22 via nvm: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`).

## File structure

| File | Change |
| --- | --- |
| `apps/web/lib/learning/durations.ts` | `StandardStepRow` += `lead_time_days`,`step_type`; `LearnedRow` += `metric`; route in `learnedDurationRows` |
| `apps/web/tests/unit/learning-durations.test.ts` | tests for the procurement routing |
| `packages/db/supabase/migrations/<ts>_learned_lead_time.sql` | `apply_learned_lead_time` RPC |
| `packages/db/src/types.generated.ts` | stopgap: the new RPC signature |
| `apps/web/lib/learning/queries.ts` | select `step_type, lead_time_days`; pass through |
| `apps/web/lib/learning/actions.ts` | `applyLearnedLeadTime` |
| `apps/web/components/learning/DurationLearningView.tsx` | metric label + route apply |
| `apps/web/app/(app)/library/durations/page.tsx` | header copy "Analisa Durasi & Lead Time" |

---

## Task 1: Metric-aware pure module (TDD)

**Files:** Modify `apps/web/lib/learning/durations.ts`; modify `apps/web/tests/unit/learning-durations.test.ts`.

**Interfaces:** `StandardStepRow` += `lead_time_days: number; step_type: string`; `LearnedRow` += `metric: "duration" | "lead_time"`.

- [ ] **Step 1: Extend the tests**

Update the `mk`/`StandardStepRow` fixtures in `learning-durations.test.ts` to include `lead_time_days` + `step_type`, and add:
```ts
describe("learnedDurationRows metric routing", () => {
  const inst = (code: string, s: string, e: string) => ({ step_code: code, actual_start: s, actual_end: e });
  const gn = (g: string) => g;
  it("procurement → lead_time metric, estimate = lead_time_days, suggests vs lead time", () => {
    const steps = [{ code: "P", gate_code: "D", name: "Order", typical_duration_days: 1, lead_time_days: 14, step_type: "procurement" }];
    const five = Array.from({ length: 5 }, () => inst("P", "2026-06-01", "2026-06-21")); // 20 days
    const [r] = learnedDurationRows(five as never, steps as never, gn);
    expect(r!.metric).toBe("lead_time");
    expect(r!.estimate).toBe(14);
    expect(r!.suggest).toBe(20);
  });
  it("site_work → duration metric, estimate = typical_duration_days (unchanged #27 behavior)", () => {
    const steps = [{ code: "W", gate_code: "D", name: "Pasang", typical_duration_days: 6, lead_time_days: 0, step_type: "site_work" }];
    const five = Array.from({ length: 5 }, () => inst("W", "2026-06-01", "2026-06-09")); // 8 days
    const [r] = learnedDurationRows(five as never, steps as never, gn);
    expect(r!.metric).toBe("duration");
    expect(r!.estimate).toBe(6);
    expect(r!.suggest).toBe(8);
  });
  it("n<5 → no suggest (both metrics)", () => {
    const steps = [{ code: "P", gate_code: "D", name: "Order", typical_duration_days: 1, lead_time_days: 14, step_type: "procurement" }];
    expect(learnedDurationRows([inst("P","2026-06-01","2026-06-21")] as never, steps as never, gn)[0]!.suggest).toBeNull();
  });
});
```
(Update any existing `StandardStepRow` literals in the file to add `lead_time_days` + `step_type` so they still typecheck — the existing #27 tests should keep their `metric === "duration"` expectations.)

- [ ] **Step 2: Run → FAIL**

`pnpm -C apps/web test -- learning-durations` → FAIL (metric not on LearnedRow / fields missing).

- [ ] **Step 3: Implement**

In `apps/web/lib/learning/durations.ts`:
- `StandardStepRow`: add `lead_time_days: number; step_type: string;`.
- `LearnedRow`: add `metric: "duration" | "lead_time";` (after `name`, before `estimate`).
- Replace `learnedDurationRows`'s `return steps.map(...)` body:
```ts
  return steps.map((s) => {
    const metric: "duration" | "lead_time" = s.step_type === "procurement" ? "lead_time" : "duration";
    const estimate = metric === "lead_time" ? s.lead_time_days : s.typical_duration_days;
    const samples = byCode.get(s.code) ?? [];
    const stats = samples.length ? summarizeDurations(samples) : null;
    const suggest = stats && stats.n >= MIN_SAMPLE && stats.median !== estimate ? stats.median : null;
    return { code: s.code, gate_code: s.gate_code, gateName: gateName(s.gate_code), name: s.name, metric, estimate, stats, suggest };
  });
```

- [ ] **Step 4: Run → PASS, typecheck, commit**

`pnpm -C apps/web test -- learning-durations` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/learning/durations.ts apps/web/tests/unit/learning-durations.test.ts
git commit -m "feat(learning): metric-aware rows (procurement learns lead time)"
```

---

## Task 2: apply_learned_lead_time RPC + types

**Files:** Create `packages/db/supabase/migrations/<ts>_learned_lead_time.sql` (ts > `20260627000001`, e.g. `20260628000001`); modify `packages/db/src/types.generated.ts`.

- [ ] **Step 1: Migration**

```sql
-- Lead-time learning: apply a learned median to a firm-standard step's lead_time_days.
alter table public.trade_steps
  add column if not exists updated_by uuid references public.staff(id),
  add column if not exists updated_at timestamptz;

create or replace function public.apply_learned_lead_time(p_code text, p_lead_time_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.current_can_manage_projects() then raise exception 'tidak berwenang mengubah pustaka'; end if;
  if coalesce(p_lead_time_days, -1) < 0 then raise exception 'lead time tidak boleh negatif'; end if;
  update public.trade_steps
    set lead_time_days = p_lead_time_days, updated_by = auth.uid(), updated_at = now()
    where code = p_code and project_id is null and source = 'standard';
  if not found then raise exception 'langkah standar tidak ditemukan: %', p_code; end if;
end; $$;
revoke all on function public.apply_learned_lead_time(text, int) from public;
grant execute on function public.apply_learned_lead_time(text, int) to authenticated;
```

- [ ] **Step 2: Types stopgap**

In `packages/db/src/types.generated.ts` `Functions`, add (alphabetically, near `apply_learned_duration`):
```ts
      apply_learned_lead_time: {
        Args: { p_code: string; p_lead_time_days: number }
        Returns: undefined
      }
```

- [ ] **Step 3: Typecheck + commit**

`pnpm -C packages/db typecheck` → PASS.
```bash
git add packages/db/supabase/migrations/<ts>_learned_lead_time.sql packages/db/src/types.generated.ts
git commit -m "feat(db): apply_learned_lead_time RPC"
```

---

## Task 3: Query + action

**Files:** Modify `apps/web/lib/learning/queries.ts`, `apps/web/lib/learning/actions.ts`.

- [ ] **Step 1: Query fetches step_type + lead_time_days**

In `getDurationLearning` (`queries.ts`), extend the `trade_steps` select from `"code, gate_code, name, typical_duration_days"` to `"code, gate_code, name, typical_duration_days, lead_time_days, step_type"`. The `StandardStepRow` cast now carries those fields (Task 1 added them to the type) — pass through to `learnedDurationRows` unchanged.

- [ ] **Step 2: Add the action**

In `apps/web/lib/learning/actions.ts`, add alongside `applyLearnedDuration`:
```ts
export async function applyLearnedLeadTime(args: { code: string; days: number }): Promise<LearningActionResult> {
  const staff = await getCurrentStaff();
  if (!staff || !canManageAccess(staff)) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("apply_learned_lead_time", { p_code: args.code, p_lead_time_days: args.days });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
```

- [ ] **Step 3: Typecheck + commit**

`pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/learning/queries.ts apps/web/lib/learning/actions.ts
git commit -m "feat(learning): query step_type/lead_time + applyLearnedLeadTime action"
```

---

## Task 4: View routing + page copy

**Files:** Modify `apps/web/components/learning/DurationLearningView.tsx`, `apps/web/app/(app)/library/durations/page.tsx`.

- [ ] **Step 1: Route the apply + label the metric**

In `DurationLearningView.tsx` (read it first): import `applyLearnedLeadTime` alongside `applyLearnedDuration`. The per-row "Terapkan {median}h" handler must call `r.metric === "lead_time" ? applyLearnedLeadTime({ code, days }) : applyLearnedDuration({ code, days })`. Label the estimate per metric: append ` durasi` for `metric === "duration"` and ` lead time` for `metric === "lead_time"` to the "Estimasi {estimate}h" text (so a reader sees which is which). Keep the n≥5/"Belum cukup data" logic unchanged.

- [ ] **Step 2: Page header copy**

In `page.tsx`, change the `<h1>` to "Analisa Durasi & Lead Time" and the blurb to note that procurement rows reflect realized order→arrival lead time.

- [ ] **Step 3: Typecheck + build + commit**

`pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add apps/web/components/learning/DurationLearningView.tsx "apps/web/app/(app)/library/durations/page.tsx"
git commit -m "feat(learning): route apply by metric (lead time vs duration) + page copy"
```

---

## Task 5: Verification (controller-run)

> Needs the migration on prod (`supabase db push`) + a principal/admin session + a procurement step with ≥5 completed instances.

- [ ] `/library/durations` shows procurement rows labeled "lead time" with their `lead_time_days` estimate; work steps still labeled "durasi".
- [ ] "Terapkan" on a procurement row updates `lead_time_days` (verify in `/library/steps`); on a work row updates `typical_duration_days`.
- [ ] Non-manager refused; `lead_time_days < 0` rejected.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 pure → Task 1; §2 query/RPC/action → Tasks 2+3; §3 view/page → Task 4; testing → Task 1 (pure) + Task 5 (browser).
- **Type consistency:** `metric` on `LearnedRow` (Task 1) consumed by the view (Task 4); `StandardStepRow` fields (Task 1) supplied by the query (Task 3); `applyLearnedLeadTime` (Task 3) ↔ RPC args (Task 2, `p_code`/`p_lead_time_days`).
- **Additive:** `apply_learned_duration`/`applyLearnedDuration`/#27 tests untouched; existing `StandardStepRow` literals get the two new fields.
- **Verify-during-impl:** the exact "Estimasi"/"Terapkan" JSX in `DurationLearningView` (Task 4 — read it); audit cols already exist (idempotent add is a no-op).
