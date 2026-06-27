# Project Step Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-project `/project/[slug]/activity` page that lists the project's readiness step events (`area_step_events` — status changes + progress notes), newest-first, grouped by Jakarta day.

**Architecture:** A pure `groupByDay` + `mapStepActivityRow` and a `getProjectStepActivity` query in `apps/web/lib/activity/step-activity.ts`; a server-component page renders them. apps/web only — no `@datum/core`/mobile/DB change.

**Tech Stack:** Next.js 16 App Router, Supabase, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-27-project-step-activity-design.md`

## Global Constraints

- **Read-only, project-scoped, apps/web only.** RLS on `area_step_events` already scopes reads to project members; no new gate. No `@datum/core` change.
- `area_step_events` carries `project_id` (filter directly), `status` ∈ {`not_started`,`in_progress`,`blocked`,`done`} (event statuses), `note`, `percent_complete`, `occurred_at`, `area_step_id`, `logged_by_staff_id`.
- Conventions: server component page like `(app)/activity/page.tsx` (`max-w-3xl`), CSS-var Tailwind, Bahasa Indonesia. `occurredAt = occurred_at ?? created_at`.
- **Verify per task:** pure logic → vitest TDD; `pnpm -C apps/web typecheck` + `pnpm -C apps/web build`. (Use Node 22 via nvm — the shell default Node 20 breaks pnpm: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`.)

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/activity/step-activity.ts` | `StepActivityItem`, pure `mapStepActivityRow` + `groupByDay`, `getProjectStepActivity` query |
| `apps/web/tests/unit/step-activity.test.ts` | unit tests for the pure helpers |
| `apps/web/app/(app)/project/[slug]/activity/page.tsx` | the feed page |
| project nav/board | link to `/project/{code}/activity` |

---

## Task 1: Query + pure helpers (TDD)

**Files:**
- Create: `apps/web/lib/activity/step-activity.ts`
- Test: `apps/web/tests/unit/step-activity.test.ts`

**Interfaces:**
- Produces — `type StepActivityItem = { id: string; occurredAt: string; areaName: string; stepName: string; status: string; note: string | null; percentComplete: number | null; authorName: string | null }`; pure `mapStepActivityRow(row): StepActivityItem`; pure `groupByDay(items): { day: string; items: StepActivityItem[] }[]`; `getProjectStepActivity(supabase, projectId, limit?): Promise<StepActivityItem[]>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/step-activity.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupByDay, mapStepActivityRow, type StepActivityItem } from "@/lib/activity/step-activity";

const item = (id: string, occurredAt: string): StepActivityItem => ({
  id, occurredAt, areaName: "KM", stepName: "Lantai", status: "in_progress", note: null, percentComplete: null, authorName: "A",
});

describe("groupByDay", () => {
  it("groups by Jakarta day, preserves order, same-day together", () => {
    // 2026-06-27T01:00Z = 08:00 WIB 27 Jun; 2026-06-26T20:00Z = 03:00 WIB 27 Jun (same day); 2026-06-25T01:00Z = 25 Jun
    const g = groupByDay([item("1", "2026-06-27T01:00:00Z"), item("2", "2026-06-26T20:00:00Z"), item("3", "2026-06-25T01:00:00Z")]);
    expect(g.length).toBe(2);
    expect(g[0]!.items.map((i) => i.id)).toEqual(["1", "2"]);
    expect(g[1]!.items.map((i) => i.id)).toEqual(["3"]);
  });
  it("empty → []", () => expect(groupByDay([])).toEqual([]));
});

describe("mapStepActivityRow", () => {
  it("maps joins + falls back occurredAt to created_at, names to step_code", () => {
    const row = {
      id: "e1", status: "done", note: "selesai", percent_complete: 100,
      occurred_at: null, created_at: "2026-06-27T02:00:00Z", area_step_id: "as1",
      area_steps: { step_code: "D6", areas: { area_name: "Dapur" }, trade_steps: { name: "Pasang lantai" } },
      staff: { full_name: "Budi" },
    };
    expect(mapStepActivityRow(row as never)).toEqual({
      id: "e1", occurredAt: "2026-06-27T02:00:00Z", areaName: "Dapur", stepName: "Pasang lantai",
      status: "done", note: "selesai", percentComplete: 100, authorName: "Budi",
    });
  });
  it("uses step_code when trade_steps name missing, null author", () => {
    const row = {
      id: "e2", status: "in_progress", note: null, percent_complete: null,
      occurred_at: "2026-06-27T05:00:00Z", created_at: "x", area_step_id: "as2",
      area_steps: { step_code: "cst_x", areas: { area_name: "Taman" }, trade_steps: null },
      staff: null,
    };
    const m = mapStepActivityRow(row as never);
    expect(m.stepName).toBe("cst_x"); expect(m.authorName).toBeNull(); expect(m.areaName).toBe("Taman");
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm -C apps/web test -- step-activity`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/activity/step-activity.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type StepActivityItem = {
  id: string;
  occurredAt: string;
  areaName: string;
  stepName: string;
  status: string;
  note: string | null;
  percentComplete: number | null;
  authorName: string | null;
};

type RawRow = {
  id: string;
  status: string;
  note: string | null;
  percent_complete: number | null;
  occurred_at: string | null;
  created_at: string;
  area_step_id: string;
  area_steps: { step_code: string; areas: { area_name: string } | null; trade_steps: { name: string } | null } | null;
  staff: { full_name: string } | null;
};

/** Pure: one DB row → a feed item (occurredAt falls back to created_at; names fall back to step_code). */
export function mapStepActivityRow(row: RawRow): StepActivityItem {
  const as = row.area_steps;
  return {
    id: row.id,
    occurredAt: row.occurred_at ?? row.created_at,
    areaName: as?.areas?.area_name ?? "—",
    stepName: as?.trade_steps?.name ?? as?.step_code ?? "—",
    status: row.status,
    note: row.note,
    percentComplete: row.percent_complete !== null ? Number(row.percent_complete) : null,
    authorName: row.staff?.full_name ?? null,
  };
}

/** Pure: group items by Asia/Jakarta calendar day, preserving the incoming (newest-first) order. */
export function groupByDay(items: StepActivityItem[]): { day: string; items: StepActivityItem[] }[] {
  const order: string[] = [];
  const byDay = new Map<string, StepActivityItem[]>();
  for (const it of items) {
    const day = new Date(it.occurredAt).toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta", year: "numeric", month: "long", day: "numeric",
    });
    if (!byDay.has(day)) { byDay.set(day, []); order.push(day); }
    byDay.get(day)!.push(it);
  }
  return order.map((day) => ({ day, items: byDay.get(day)! }));
}

/** The project's step events, newest first, mapped to feed items. */
export async function getProjectStepActivity(
  supabase: SupabaseClient<Database>,
  projectId: string,
  limit = 50,
): Promise<StepActivityItem[]> {
  const { data, error } = await supabase
    .from("area_step_events")
    .select("id, status, note, percent_complete, occurred_at, created_at, area_step_id, area_steps:area_step_id ( step_code, areas:area_id ( area_name ), trade_steps:step_code ( name ) ), staff:logged_by_staff_id ( full_name )")
    .eq("project_id", projectId)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => mapStepActivityRow(r as unknown as RawRow));
}
```

- [ ] **Step 4: Run → PASS, typecheck, commit**

Run: `pnpm -C apps/web test -- step-activity` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/activity/step-activity.ts apps/web/tests/unit/step-activity.test.ts
git commit -m "feat(activity): project step-activity query + day grouping"
```

---

## Task 2: Page + nav link

**Files:**
- Create: `apps/web/app/(app)/project/[slug]/activity/page.tsx`
- Modify: the project nav/board where `/project/{code}/schedule` etc. links live

**Interfaces:**
- Consumes — `getProjectStepActivity`/`groupByDay` (Task 1).

- [ ] **Step 1: Write the page**

Create `apps/web/app/(app)/project/[slug]/activity/page.tsx`:
```tsx
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectStepActivity, groupByDay } from "@/lib/activity/step-activity";

const CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress: { label: "Berjalan", cls: "bg-blue-100 text-blue-800" },
  blocked: { label: "Terblokir", cls: "bg-red-100 text-red-800" },
  done: { label: "Selesai", cls: "bg-green-100 text-green-800" },
};

export default async function ProjectActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects").select("id, project_code, project_name").eq("project_code", slug.toUpperCase()).maybeSingle();
  if (!project) {
    return <div className="p-6 text-[var(--flag-critical)]">Proyek tidak ditemukan: {slug}</div>;
  }
  const items = await getProjectStepActivity(supabase, project.id);
  const groups = groupByDay(items);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Link href={`/project/${project.project_code}`} className="text-xs text-[var(--text-muted)] hover:underline">← {project.project_code} Board</Link>
      <h1 className="mt-2 text-2xl font-semibold text-[#141210]">Aktivitas Langkah</h1>
      <p className="mt-1 text-sm text-[#524E49]">50 update langkah terbaru di proyek ini.</p>

      {groups.length === 0 ? (
        <div className="mt-6 rounded border border-dashed border-[#B5AFA8] p-6 text-center text-sm italic text-[#524E49]">
          Belum ada aktivitas langkah.
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.day} className="mt-6">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#7A6B56]">{g.day} ({g.items.length})</h2>
          <ol className="space-y-2">
            {g.items.map((it) => {
              const chip = CHIP[it.status] ?? { label: it.status, cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" };
              return (
                <li key={it.id} className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${chip.cls}`}>{chip.label}</span>
                    <span className="text-[var(--foreground)]">{it.areaName} · {it.stepName}</span>
                    {it.percentComplete !== null ? <span className="text-[10px] text-[var(--text-muted)]">{it.percentComplete}%</span> : null}
                    <span className="flex-1" />
                    <span className="text-[10px] text-[var(--text-muted)]">
                      {new Date(it.occurredAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                      {it.authorName ? ` · ${it.authorName}` : ""}
                    </span>
                  </div>
                  {it.note ? <p className="mt-1 text-[12px] text-[var(--foreground)]">{it.note}</p> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the project nav link**

Find where the project's `/project/{code}/schedule` and `/rooms` links are rendered (likely the project board page `app/(app)/project/[slug]/page.tsx` header, or a shared project nav). Add a sibling link to `/project/{code}/activity` labelled "Aktivitas". Match the existing link styling/placement.

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add "apps/web/app/(app)/project/[slug]/activity/page.tsx" "apps/web/app/(app)/project/[slug]/page.tsx"
git commit -m "feat(activity): project step-activity feed page + nav link"
```

---

## Task 3: Verification (controller-run, browser)

> UI page — browser-verify on prod (post-merge).

- [ ] Open `/project/<CODE>/activity` → step events render newest-first, grouped by day, with area · step · status chip · note · time · author.
- [ ] A project with no step events shows the empty state.
- [ ] RLS: a non-member can't read another project's events (the query returns empty under RLS).
- [ ] No console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 query/helpers → Task 1; §2 page → Task 2; §3 scope → honored (apps/web only, read-only); testing → Task 1 (pure) + Task 3 (browser).
- **Type consistency:** `StepActivityItem`/`mapStepActivityRow`/`groupByDay` (Task 1) consumed by Task 2 page; `getProjectStepActivity(supabase, projectId, limit?)` signature stable.
- **Grounded:** `area_step_events` has `project_id` + the joined columns (confirmed via `updateAreaStep` insert + `getAreaStepEvents` select shape); `--flag-critical` exists; status vocab matches `StepDetail` event chips (`not_started/in_progress/blocked/done`).
- **Verify-during-impl:** the Supabase nested-join select string typechecks against generated types (Task 1 Step 4 — adjust the `area_steps:area_step_id ( … )` aliasing if the generated relation names differ); the exact project-nav link location (Task 2 Step 2).
