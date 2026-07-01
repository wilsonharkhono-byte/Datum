# Cross-Project Slip-Risk Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/risiko` page that ranks every (RLS-visible) active project by slip risk — derived from its existing step signals — with the bottleneck per project, so a principal/PM sees where to intervene across all projects at once.

**Architecture:** A pure `summarizeProjectRisk(signals)` rollup over `getProjectStepSignals` (no new scheduler/schema), a `getProjectsSlipRisk` query that runs it across active projects, and a server-component page + nav link. RLS scopes the project list to what each viewer can read.

**Tech Stack:** Next.js App Router, Supabase, vitest, `@datum/core`. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-28-slip-risk-overview-design.md`

## Global Constraints

- Signal kinds (exact): `silent | behind_plan | lead_time_risk | blocking_timeline | stale_decision`. **behind** = `behind_plan` + `blocking_timeline`; **at_risk** = `lead_time_risk` + `silent` + `stale_decision`.
- `level`: `behind` if behindCount>0; `at_risk` if atRiskCount>0 (and behindCount==0); `on_track` if no signals. `bottleneck` = the first (worst — list is severity-sorted) signal, or null.
- Reuse only — no schema change, no new scheduler. RLS-scoped (no extra gate); the page shows the viewer's visible projects.
- `today` = `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date())`; `now` = `new Date().toISOString()` (computed in the page).
- **Verify:** pure → vitest TDD; `pnpm -C apps/web typecheck` + `pnpm -C apps/web build` (Node 22 via nvm: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`).

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/steps/slip-risk.ts` | pure `summarizeProjectRisk` + types |
| `apps/web/tests/unit/slip-risk.test.ts` | unit tests |
| `apps/web/lib/steps/slip-risk-queries.ts` | `getProjectsSlipRisk` |
| `apps/web/app/(app)/risiko/page.tsx` | ranked page |
| `apps/web/app/(app)/layout.tsx` | "Risiko" nav link |

---

## Task 1: Pure rollup (TDD)

**Files:** Create `apps/web/lib/steps/slip-risk.ts`; create `apps/web/tests/unit/slip-risk.test.ts`.

**Interfaces:** Produces `RiskLevel`, `ProjectRisk`, `summarizeProjectRisk(signals: ProjectStepSignalRow[]): ProjectRisk`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/slip-risk.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { summarizeProjectRisk } from "@/lib/steps/slip-risk";
import type { ProjectStepSignalRow } from "@/lib/steps/queries";

const row = (kind: string, severity: string, areaName = "KM", stepName = "Lantai", message = "msg"): ProjectStepSignalRow => ({
  areaId: "a", areaName, stepCode: "S", stepName, tradeRole: null,
  signal: { kind: kind as never, severity: severity as never, message },
});

describe("summarizeProjectRisk", () => {
  it("empty → on_track, null bottleneck", () => {
    const r = summarizeProjectRisk([]);
    expect(r.level).toBe("on_track");
    expect(r.bottleneck).toBeNull();
  });
  it("behind_plan or blocking_timeline → behind", () => {
    expect(summarizeProjectRisk([row("behind_plan", "high")]).level).toBe("behind");
    expect(summarizeProjectRisk([row("blocking_timeline", "critical")]).level).toBe("behind");
  });
  it("only lead_time_risk/silent/stale_decision → at_risk", () => {
    expect(summarizeProjectRisk([row("lead_time_risk", "warning"), row("silent", "info")]).level).toBe("at_risk");
  });
  it("counts + bottleneck = first (worst) signal", () => {
    const r = summarizeProjectRisk([row("behind_plan", "high", "Dapur", "Order", "telat 3 hari"), row("silent", "info")]);
    expect(r.behindCount).toBe(1);
    expect(r.atRiskCount).toBe(1);
    expect(r.bottleneck).toEqual({ areaName: "Dapur", stepName: "Order", message: "telat 3 hari", severity: "high" });
  });
});
```

- [ ] **Step 2: Run → FAIL**

`pnpm -C apps/web test -- slip-risk` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/web/lib/steps/slip-risk.ts`:
```ts
import type { ProjectStepSignalRow } from "@/lib/steps/queries";

export type RiskLevel = "behind" | "at_risk" | "on_track";
export type ProjectRisk = {
  level: RiskLevel;
  behindCount: number;   // behind_plan + blocking_timeline
  atRiskCount: number;   // lead_time_risk + silent + stale_decision
  bottleneck: { areaName: string; stepName: string; message: string; severity: string } | null;
};

const BEHIND_KINDS = new Set(["behind_plan", "blocking_timeline"]);

/** Roll a project's step-signals into a slip-risk verdict + its worst signal. */
export function summarizeProjectRisk(signals: ProjectStepSignalRow[]): ProjectRisk {
  let behindCount = 0;
  let atRiskCount = 0;
  for (const s of signals) {
    if (BEHIND_KINDS.has(s.signal.kind)) behindCount++;
    else atRiskCount++;
  }
  const level: RiskLevel = behindCount > 0 ? "behind" : atRiskCount > 0 ? "at_risk" : "on_track";
  const worst = signals[0]; // getProjectStepSignals is already severity-sorted
  const bottleneck = worst
    ? { areaName: worst.areaName, stepName: worst.stepName, message: worst.signal.message, severity: worst.signal.severity }
    : null;
  return { level, behindCount, atRiskCount, bottleneck };
}
```

- [ ] **Step 4: Run → PASS, typecheck, commit**

`pnpm -C apps/web test -- slip-risk` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/steps/slip-risk.ts apps/web/tests/unit/slip-risk.test.ts
git commit -m "feat(risk): pure summarizeProjectRisk rollup over step signals"
```

---

## Task 2: Cross-project query

**Files:** Create `apps/web/lib/steps/slip-risk-queries.ts`.

**Interfaces:** Consumes `getProjectStepSignals` (`@/lib/steps/queries`), `summarizeProjectRisk` (Task 1). Produces `getProjectsSlipRisk(supabase, today, now): Promise<{ project: { id: string; code: string; name: string }; risk: ProjectRisk; signalCount: number }[]>`.

- [ ] **Step 1: Write the query**

Create `apps/web/lib/steps/slip-risk-queries.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getProjectStepSignals } from "@/lib/steps/queries";
import { summarizeProjectRisk, type ProjectRisk } from "@/lib/steps/slip-risk";

export type ProjectSlipRow = {
  project: { id: string; code: string; name: string };
  risk: ProjectRisk;
  signalCount: number;
};

const LEVEL_RANK: Record<ProjectRisk["level"], number> = { behind: 0, at_risk: 1, on_track: 2 };

/** Every RLS-visible active project, ranked by slip risk. `today` = Jakarta YYYY-MM-DD, `now` = ISO. */
export async function getProjectsSlipRisk(
  supabase: SupabaseClient<Database>,
  today: string,
  now: string,
): Promise<ProjectSlipRow[]> {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name")
    .neq("status", "closed");
  if (error) throw error;

  const rows = await Promise.all(
    (projects ?? []).map(async (p) => {
      const signals = await getProjectStepSignals(supabase, p.id, today, now);
      return {
        project: { id: p.id, code: p.project_code, name: p.project_name },
        risk: summarizeProjectRisk(signals),
        signalCount: signals.length,
      };
    }),
  );

  return rows.sort(
    (a, b) =>
      LEVEL_RANK[a.risk.level] - LEVEL_RANK[b.risk.level] ||
      b.risk.behindCount - a.risk.behindCount ||
      b.signalCount - a.signalCount,
  );
}
```

- [ ] **Step 2: Typecheck + commit**

`pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/steps/slip-risk-queries.ts
git commit -m "feat(risk): getProjectsSlipRisk — rank active projects by risk"
```

---

## Task 3: Page + nav link

**Files:** Create `apps/web/app/(app)/risiko/page.tsx`; modify `apps/web/app/(app)/layout.tsx`.

- [ ] **Step 1: Write the page**

Create `apps/web/app/(app)/risiko/page.tsx`:
```tsx
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectsSlipRisk } from "@/lib/steps/slip-risk-queries";

const LEVEL: Record<string, { label: string; cls: string }> = {
  behind: { label: "Terlambat", cls: "bg-red-100 text-red-800" },
  at_risk: { label: "Berisiko", cls: "bg-amber-100 text-amber-800" },
  on_track: { label: "Aman", cls: "bg-green-100 text-green-800" },
};

export default async function SlipRiskPage() {
  const supabase = await createSupabaseServerClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const now = new Date().toISOString();
  const rows = await getProjectsSlipRisk(supabase, today, now);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <h1 className="text-2xl font-semibold text-[#141210]">Risiko Keterlambatan</h1>
      <p className="mt-1 text-sm text-[#524E49]">Proyek aktif diurutkan dari yang paling berisiko terlambat, beserta penyebab utamanya.</p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-[#B5AFA8] p-6 text-center text-sm italic text-[#524E49]">
          Tidak ada proyek aktif.
        </div>
      ) : null}

      <ol className="mt-6 space-y-2">
        {rows.map((r) => {
          const lv = LEVEL[r.risk.level] ?? LEVEL.on_track!;
          return (
            <li key={r.project.id} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${lv.cls}`}>{lv.label}</span>
                <Link href={`/project/${r.project.code}/schedule`} className="text-[13px] font-semibold text-[var(--foreground)] hover:underline">
                  {r.project.code} · {r.project.name}
                </Link>
                <span className="flex-1" />
                {r.risk.behindCount > 0 ? <span className="text-[10px] text-red-700">{r.risk.behindCount} terlambat</span> : null}
                {r.risk.atRiskCount > 0 ? <span className="text-[10px] text-[var(--sand-dark)]">{r.risk.atRiskCount} berisiko</span> : null}
              </div>
              {r.risk.bottleneck ? (
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                  Penyebab utama: {r.risk.bottleneck.areaName} · {r.risk.bottleneck.stepName} — {r.risk.bottleneck.message}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: Nav link**

In `apps/web/app/(app)/layout.tsx`, add a "Risiko" link to `/risiko` in the header nav — **ungated** (all staff; it self-scopes via RLS). Place it next to the existing `hidden … sm:block` "Analisa Durasi" link (the left group), matching that link's className/style (it is NOT wrapped in `canManageAccess`).

- [ ] **Step 3: Typecheck + build + commit**

`pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add "apps/web/app/(app)/risiko/page.tsx" "apps/web/app/(app)/layout.tsx"
git commit -m "feat(risk): Risiko Keterlambatan overview page + nav link"
```

---

## Task 4: Verification (controller-run, browser)

- [ ] As principal/admin, open `/risiko` → all active projects ranked (Terlambat → Berisiko → Aman) with counts + the bottleneck line; links go to each schedule.
- [ ] As a single-project staff member, only their visible projects appear (RLS).
- [ ] A project with no signals shows "Aman"; no projects → empty state.
- [ ] No console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 rollup → Task 1; §2 query → Task 2; §3 page/nav → Task 3; §4 scope (rollup-only, RLS-scoped) honored.
- **Type consistency:** `ProjectRisk`/`RiskLevel` (Task 1) consumed by Task 2/3; `getProjectsSlipRisk` return shape (Task 2) consumed by the page; signal kinds are the exact 5.
- **Grounded:** `ProjectStepSignalRow`/`getProjectStepSignals(supabase, id, today, now)` confirmed; `today`/`now` pattern matches the schedule page; nav link placement matches the existing `/library/durations` link.
- **Verify-during-impl:** the exact layout nav JSX for the link (Task 3 Step 2 — read it); `projects.status` enum has a `closed`-exclusion (the cron's `getActiveProjects` uses `neq("status","closed")` — reuse that).
