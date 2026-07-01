# Card→Step Inference Bridge (Slice B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the team logs a `work` card event, an async cron uses Haiku 4.5 to infer which seeded per-room step it represents and its status, and writes that status automatically — without ever overriding a step a human has touched.

**Architecture:** Mirror the existing attachment-analysis pipeline. `card_events` gets an outbox flag + a `claim_card_events_for_step_inference` RPC; a per-minute cron claims pending `work` events, fetches the candidate steps for the card's areas, calls Haiku with a cached prompt + structured output, and writes AI-authored `area_step_events` (`source='ai'`). The pure `projectStepStatus` gains a precedence rule: **if a step has any human event, AI events are ignored** — AI only fills steps nobody has touched. AI = perception; the existing dep/signal engine (Slice C, separate plan) does propagation.

**Tech Stack:** Next.js App Router (apps/web), Supabase (packages/db migrations + global v2 CLI), `@anthropic-ai/sdk` (Haiku 4.5 via `getAnthropicClient`), vitest.

## Global Constraints

- **Model:** always resolve via `getModel()` from `@/lib/assistant/anthropic` (defaults to `claude-haiku-4-5-20251001`). Never hardcode a model string.
- **Prompt caching:** wrap the static system text with `cachedSystemBlock()` from `@/lib/assistant/anthropic`; keep per-card content in the user message.
- **Structured output:** force the verdict JSON via `output_config: { format: { type: "json_schema", schema: STEP_VERDICT_SCHEMA } }`. No assistant prefill (400 on Haiku 4.5).
- **Migrations:** additive only (`add column if not exists`, `create ... if not exists`, `create or replace`). Apply to prod with the **global Supabase v2 CLI** `supabase db push` (not `pnpm migrate`); regenerate types with `supabase gen types`. New migration filename: `packages/db/supabase/migrations/20260628000002_card_step_inference.sql` (next free slot: `20260628000001_learned_lead_time` is taken on origin/main; **re-verify the latest timestamp at PR time** — the readiness stream ships migrations frequently).
- **Pure logic** uses the repo convention: no Supabase, time/ids injected as args, unit-tested in `apps/web/tests/unit/`.
- **TypeScript:** repo has `noUncheckedIndexedAccess` — guard indexed access (`arr[i]!` or `?? fallback`).
- **Verify before done:** `pnpm --filter web build` (not just tsc+vitest) — `"use server"` files may export only async fns. `apps/web` changes are web-only here (no `@datum/core` edits), so `pnpm -C apps/web typecheck && pnpm -C apps/web test` suffice.
- **Cron auth:** bearer `CRON_SECRET` (already set in prod env for the attachment cron).
- **Out of scope (later slices):** propose→confirm review-queue UI for AI overrides of human-set steps; backfill of historical card events; Slice C propagation/gaps/reminders; `affected_trades` cross-area bridging output.

---

### Task 1: Precedence in `projectStepStatus` (human events win)

**Files:**
- Modify: `apps/web/lib/steps/status.ts`
- Test: `apps/web/tests/unit/step-status-precedence.test.ts`

**Interfaces:**
- Consumes: existing `projectStepStatus(input: StepStatusInput): StepStatusResult`.
- Produces: `StepStatusInput.workEvents[].source?: "human" | "ai"` (optional; absent ⇒ treated as `"human"`). Behavior unchanged for callers that omit `source`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/unit/step-status-precedence.test.ts
import { describe, it, expect } from "vitest";
import { projectStepStatus } from "@/lib/steps/status";

const ev = (occurred_at: string, status: string, source?: "human" | "ai") => ({
  occurred_at,
  created_at: occurred_at,
  source,
  payload: { status },
});

describe("projectStepStatus precedence", () => {
  it("derives from AI events when no human event exists", () => {
    const r = projectStepStatus({
      workEvents: [ev("2026-06-01T00:00:00Z", "done", "ai")],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("accepted");
  });

  it("ignores AI events when any human event exists (human is older)", () => {
    const r = projectStepStatus({
      workEvents: [
        ev("2026-06-01T00:00:00Z", "in_progress", "human"),
        ev("2026-06-02T00:00:00Z", "done", "ai"),
      ],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("in_progress"); // AI "done" dropped
  });

  it("treats missing source as human (back-compat)", () => {
    const r = projectStepStatus({
      workEvents: [ev("2026-06-01T00:00:00Z", "blocked")],
      checkpoints: [],
      punchItems: [],
    });
    expect(r.status).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web test step-status-precedence`
Expected: FAIL — `source` not on the type / AI event not dropped (second test asserts `in_progress`, current code returns `accepted`).

- [ ] **Step 3: Add `source` to the input type and a precedence filter**

In `apps/web/lib/steps/status.ts`, add `source?: "human" | "ai"` to each `workEvents` element and filter before projecting:

```ts
export type StepStatusInput = {
  workEvents: Array<{
    occurred_at: string;
    created_at: string;
    source?: "human" | "ai";
    payload: { status?: string; percent_complete?: number; blocked_on?: string; description?: string } | null;
  }>;
  checkpoints: Array<{ required: boolean; result: "pending" | "pass" | "fail" }>;
  punchItems: Array<{ severity: PunchSeverity; status: "open" | "fixing" | "closed" }>;
};

/** Human events outrank AI: if any human event exists, AI events are ignored. */
function applyPrecedence<T extends { source?: "human" | "ai" }>(events: T[]): T[] {
  const hasHuman = events.some((e) => (e.source ?? "human") === "human");
  return hasHuman ? events.filter((e) => (e.source ?? "human") === "human") : events;
}
```

Then at the top of `projectStepStatus`, replace the two reads of `input.workEvents` with a filtered local:

```ts
export function projectStepStatus(input: StepStatusInput): StepStatusResult {
  const workEvents = applyPrecedence(input.workEvents);
  const last = latest(workEvents);
  if (!last) {
    return { status: "not_started", lastProgressAt: null, blockingReason: null, actualStart: null, actualEnd: null };
  }
  const lastProgressAt = last.occurred_at;
  const actualStart = earliestStart(workEvents);
  // ...rest unchanged, but ensure isDone/blocked branches use `last` (already do)...
```

(Leave the `blocked` / `isDone` / `in_progress` branches exactly as they are — they already operate on `last` and the actuals on `workEvents`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web test step-status-precedence`
Expected: PASS (3/3).

- [ ] **Step 5: Run the full step suite to confirm no regression**

Run: `pnpm -C apps/web test steps`
Expected: PASS — existing `status`/`signals`/`back-schedule` tests unaffected (they omit `source` ⇒ treated as human).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/steps/status.ts apps/web/tests/unit/step-status-precedence.test.ts
git commit -m "feat(steps): human-event precedence in projectStepStatus (AI events yield to human)"
```

---

### Task 2: Pure step-inference core

**Files:**
- Create: `apps/web/lib/steps/infer.ts`
- Test: `apps/web/tests/unit/step-infer.test.ts`

**Interfaces:**
- Produces:
  - `type CandidateStep = { area_step_id: string; step_code: string; name: string; gate_code: string; status: string }`
  - `type StepMatch = { step_code: string; status: "in_progress" | "blocked" | "done"; blocked_on: string | null; confidence: number }`
  - `type StepVerdict = { matches: StepMatch[] }`
  - `type SelectedMatch = StepMatch & { area_step_id: string }`
  - `summarizeWorkEvent(payload: unknown): string`
  - `buildInferencePrompt(args: { cardTitle: string; eventText: string; candidates: CandidateStep[] }): { systemText: string; userText: string }`
  - `const STEP_VERDICT_SCHEMA` (JSON schema object for `output_config.format`)
  - `parseStepVerdict(raw: string): StepVerdict`
  - `selectApplicableMatches(verdict: StepVerdict, candidates: CandidateStep[], minConfidence: number): SelectedMatch[]`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/tests/unit/step-infer.test.ts
import { describe, it, expect } from "vitest";
import {
  summarizeWorkEvent,
  buildInferencePrompt,
  parseStepVerdict,
  selectApplicableMatches,
  type CandidateStep,
} from "@/lib/steps/infer";

const candidates: CandidateStep[] = [
  { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
  { area_step_id: "as-2", step_code: "D6", name: "Pasang lantai marmer", gate_code: "D", status: "not_started" },
];

describe("summarizeWorkEvent", () => {
  it("flattens the relevant text fields", () => {
    const s = summarizeWorkEvent({ status: "done", description: "Waterproofing selesai", notes: "flood test ok" });
    expect(s).toContain("done");
    expect(s).toContain("Waterproofing selesai");
    expect(s).toContain("flood test ok");
  });
  it("tolerates a non-object payload", () => {
    expect(summarizeWorkEvent(null)).toBe("");
  });
});

describe("buildInferencePrompt", () => {
  it("lists every candidate step_code in the system text", () => {
    const { systemText, userText } = buildInferencePrompt({
      cardTitle: "KM Utama",
      eventText: "Waterproofing selesai",
      candidates,
    });
    expect(systemText).toContain("BW1");
    expect(systemText).toContain("D6");
    expect(userText).toContain("Waterproofing selesai");
  });
});

describe("parseStepVerdict", () => {
  it("parses a valid verdict", () => {
    const v = parseStepVerdict(JSON.stringify({ matches: [{ step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 }] }));
    expect(v.matches).toHaveLength(1);
    expect(v.matches[0]!.step_code).toBe("BW1");
  });
  it("returns empty matches on malformed JSON", () => {
    expect(parseStepVerdict("not json").matches).toEqual([]);
  });
  it("drops entries with the wrong shape", () => {
    const v = parseStepVerdict(JSON.stringify({ matches: [{ step_code: "BW1" }, { foo: 1 }] }));
    expect(v.matches).toEqual([]);
  });
});

describe("selectApplicableMatches", () => {
  it("keeps only candidate codes at/above the confidence floor and attaches area_step_id", () => {
    const verdict: { matches: any[] } = {
      matches: [
        { step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 },
        { step_code: "D6", status: "in_progress", blocked_on: null, confidence: 0.4 }, // below floor
        { step_code: "ZZ9", status: "done", blocked_on: null, confidence: 0.99 }, // not a candidate
      ],
    };
    const sel = selectApplicableMatches(verdict as any, candidates, 0.6);
    expect(sel).toHaveLength(1);
    expect(sel[0]!.area_step_id).toBe("as-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web test step-infer`
Expected: FAIL — module `@/lib/steps/infer` not found.

- [ ] **Step 3: Implement the pure core**

```ts
// apps/web/lib/steps/infer.ts
export type CandidateStep = {
  area_step_id: string;
  step_code: string;
  name: string;
  gate_code: string;
  status: string;
};

export type StepMatch = {
  step_code: string;
  status: "in_progress" | "blocked" | "done";
  blocked_on: string | null;
  confidence: number;
};
export type StepVerdict = { matches: StepMatch[] };
export type SelectedMatch = StepMatch & { area_step_id: string };

const VALID_STATUS = new Set(["in_progress", "blocked", "done"]);

/** Flatten a work-event payload (Json) into a short text the model can read. */
export function summarizeWorkEvent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  const parts = [p.status, p.description, p.notes, p.blocked_on]
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
  if (typeof p.percent_complete === "number") parts.push(`${p.percent_complete}%`);
  return parts.join(" — ");
}

export function buildInferencePrompt(args: {
  cardTitle: string;
  eventText: string;
  candidates: CandidateStep[];
}): { systemText: string; userText: string } {
  const list = args.candidates
    .map((c) => `- ${c.step_code} (gate ${c.gate_code}): ${c.name}`)
    .join("\n");
  const systemText = `Anda asisten internal DATUM (studio interior/konstruksi).
Tugas: dari satu catatan pekerjaan di lapangan, tentukan langkah pekerjaan (step) mana yang sedang dilaporkan, dan statusnya.

LANGKAH YANG TERSEDIA untuk ruangan ini (pakai HANYA step_code dari daftar ini):
${list}

ATURAN:
- Cocokkan catatan ke satu atau beberapa step_code di atas. Jika tidak ada yang cocok, kembalikan matches kosong.
- status: "in_progress" (sedang dikerjakan), "done" (selesai), atau "blocked" (terhambat).
- blocked_on: alasan singkat jika blocked, selain itu null.
- confidence: 0..1, seberapa yakin pencocokan ini.
- Jangan menebak step_code di luar daftar. Hanya laporkan yang benar-benar terlihat dari catatan.`;
  const userText = `KARTU: ${args.cardTitle}\nCATATAN: ${args.eventText}`;
  return { systemText, userText };
}

export const STEP_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          step_code: { type: "string" },
          status: { type: "string", enum: ["in_progress", "blocked", "done"] },
          blocked_on: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
        required: ["step_code", "status", "blocked_on", "confidence"],
      },
    },
  },
  required: ["matches"],
} as const;

function isStepMatch(v: unknown): v is StepMatch {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.step_code === "string" &&
    typeof m.status === "string" &&
    VALID_STATUS.has(m.status) &&
    (m.blocked_on === null || typeof m.blocked_on === "string") &&
    typeof m.confidence === "number"
  );
}

export function parseStepVerdict(raw: string): StepVerdict {
  try {
    const obj = JSON.parse(raw) as unknown;
    const matches = (obj as { matches?: unknown })?.matches;
    if (!Array.isArray(matches)) return { matches: [] };
    return { matches: matches.filter(isStepMatch) };
  } catch {
    return { matches: [] };
  }
}

export function selectApplicableMatches(
  verdict: StepVerdict,
  candidates: CandidateStep[],
  minConfidence: number,
): SelectedMatch[] {
  const byCode = new Map(candidates.map((c) => [c.step_code, c]));
  const out: SelectedMatch[] = [];
  for (const m of verdict.matches) {
    const c = byCode.get(m.step_code);
    if (!c) continue;
    if (m.confidence < minConfidence) continue;
    out.push({ ...m, area_step_id: c.area_step_id });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web test step-infer`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/infer.ts apps/web/tests/unit/step-infer.test.ts
git commit -m "feat(steps): pure card->step inference core (prompt, schema, parse, select)"
```

---

### Task 3: Migration — provenance columns + outbox + claim RPC

**Files:**
- Create: `packages/db/supabase/migrations/20260628000002_card_step_inference.sql`
- Modify (regenerate): `packages/db/src/types.generated.ts`

**Interfaces:**
- Produces (DB):
  - `area_step_events.source text not null default 'human'` (`'human'|'ai'`), `.confidence numeric(4,3)`, `.card_event_id uuid` → `card_events(id)`.
  - `card_events.ai_step_status` (`pending|processing|done|failed|skipped`, default `pending`), `.ai_step_error text`, `.ai_step_attempts int default 0`, `.ai_step_processed_at timestamptz`.
  - RPC `claim_card_events_for_step_inference(p_limit int default 5) returns setof card_events` (SECURITY DEFINER, service-role only).

- [ ] **Step 1: Write the migration**

```sql
-- packages/db/supabase/migrations/20260628000002_card_step_inference.sql
-- Card->step inference bridge: provenance on area_step_events + an outbox on
-- card_events so a background cron can infer step status from work events.
-- Additive only (live DB -> supabase db push).

begin;

-- 1. Provenance on AI-authored step events.
alter table public.area_step_events
  add column if not exists source        text not null default 'human',
  add column if not exists confidence    numeric(4,3),
  add column if not exists card_event_id uuid references public.card_events(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'area_step_events_source_check'
  ) then
    alter table public.area_step_events
      add constraint area_step_events_source_check check (source in ('human','ai'));
  end if;
end $$;

-- One AI event per (card_event, area_step): re-running the cron is idempotent.
create unique index if not exists area_step_events_ai_dedup
  on public.area_step_events (card_event_id, area_step_id)
  where source = 'ai' and card_event_id is not null;

-- 2. Outbox state on card_events (only 'work' events are ever claimed).
alter table public.card_events
  add column if not exists ai_step_status      text not null default 'pending',
  add column if not exists ai_step_error       text,
  add column if not exists ai_step_attempts    int  not null default 0,
  add column if not exists ai_step_processed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'card_events_ai_step_status_check'
  ) then
    alter table public.card_events
      add constraint card_events_ai_step_status_check
      check (ai_step_status in ('pending','processing','done','failed','skipped'));
  end if;
end $$;

create index if not exists card_events_ai_step_pending_idx
  on public.card_events (ai_step_status, created_at)
  where ai_step_status in ('pending','failed') and event_kind = 'work';

-- 3. Atomic claim: flip up to p_limit eligible work events to 'processing'.
create or replace function public.claim_card_events_for_step_inference(p_limit int default 5)
returns setof public.card_events
language sql
security definer
set search_path = public
as $$
  update public.card_events
     set ai_step_status = 'processing',
         ai_step_attempts = ai_step_attempts + 1
   where id in (
     select id
       from public.card_events
      where ai_step_status in ('pending','failed')
        and event_kind = 'work'
        and ai_step_attempts < 3
      order by created_at
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning *;
$$;

revoke all on function public.claim_card_events_for_step_inference(int) from public;
revoke all on function public.claim_card_events_for_step_inference(int) from anon;
revoke all on function public.claim_card_events_for_step_inference(int) from authenticated;

commit;
```

- [ ] **Step 2: Apply to a local stack and smoke-test**

Run:
```bash
cd packages/db && supabase start && supabase db reset
```
Expected: all migrations apply clean, including `20260627000001`.

Smoke (psql via the local connection string):
```sql
-- columns exist
select column_name from information_schema.columns
 where table_name = 'card_events' and column_name like 'ai_step_%';
-- the claim RPC exists and returns 0 rows on an empty/seeded DB without erroring
select count(*) from public.claim_card_events_for_step_inference(5);
```
Expected: four `ai_step_*` columns listed; the claim call returns without error.

- [ ] **Step 3: Regenerate types**

Run (global v2 CLI):
```bash
cd packages/db && supabase gen types typescript --local > src/types.generated.ts
```
Expected: `card_events` Row gains `ai_step_status`/`ai_step_error`/`ai_step_attempts`/`ai_step_processed_at`; `area_step_events` Row gains `source`/`confidence`/`card_event_id`; `claim_card_events_for_step_inference` appears under `Functions`.

- [ ] **Step 4: Typecheck the workspace**

Run: `pnpm -C apps/web typecheck`
Expected: PASS (new columns are additive; no existing code references them yet).

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/20260628000002_card_step_inference.sql packages/db/src/types.generated.ts
git commit -m "feat(db): card->step inference outbox + area_step_events provenance + claim RPC"
```

> **Prod note for Wilson:** `supabase db push` from `packages/db` before the apps/web cron deploys. The cron tolerates the missing RPC (returns `migration_pending`, 200), so order is not load-bearing, but the columns must exist before any AI event is written.

---

### Task 4: Anthropic I/O wrapper + candidate-steps query

**Files:**
- Create: `apps/web/lib/steps/infer-runner.ts`
- Test: `apps/web/tests/unit/step-infer-runner.test.ts`

**Interfaces:**
- Consumes: `buildInferencePrompt`, `STEP_VERDICT_SCHEMA`, `parseStepVerdict`, `CandidateStep`, `StepVerdict` (Task 2); `getAnthropicClient`, `getModel`, `cachedSystemBlock`, `textOf` (`@/lib/assistant/anthropic`).
- Produces:
  - `getCandidateStepsForCard(supabase, cardId: string): Promise<CandidateStep[]>`
  - `inferCardEventSteps(args: { cardTitle: string; eventText: string; candidates: CandidateStep[]; client?: Pick<Anthropic, "messages"> }): Promise<{ verdict: StepVerdict; model: string }>`

- [ ] **Step 1: Write the failing test (inject a fake client)**

```ts
// apps/web/tests/unit/step-infer-runner.test.ts
import { describe, it, expect } from "vitest";
import { inferCardEventSteps } from "@/lib/steps/infer-runner";
import type { CandidateStep } from "@/lib/steps/infer";

const candidates: CandidateStep[] = [
  { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
];

it("returns a parsed verdict from the model response", async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify({ matches: [{ step_code: "BW1", status: "done", blocked_on: null, confidence: 0.95 }] }) }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  };
  const { verdict, model } = await inferCardEventSteps({
    cardTitle: "KM Utama",
    eventText: "Waterproofing selesai",
    candidates,
    client: fakeClient as any,
  });
  expect(verdict.matches[0]!.step_code).toBe("BW1");
  expect(typeof model).toBe("string");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web test step-infer-runner`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the runner**

```ts
// apps/web/lib/steps/infer-runner.ts
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getAnthropicClient, getModel, cachedSystemBlock, textOf } from "@/lib/assistant/anthropic";
import {
  buildInferencePrompt,
  parseStepVerdict,
  STEP_VERDICT_SCHEMA,
  type CandidateStep,
  type StepVerdict,
} from "@/lib/steps/infer";

/** Active, non-removed steps for every area linked to a card, with template name + gate. */
export async function getCandidateStepsForCard(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CandidateStep[]> {
  const { data: links, error: linkErr } = await supabase
    .from("card_areas").select("area_id").eq("card_id", cardId);
  if (linkErr) throw linkErr;
  const areaIds = (links ?? []).map((l) => l.area_id);
  if (areaIds.length === 0) return [];

  const { data, error } = await supabase
    .from("area_steps")
    .select("id, step_code, status, trade_steps:step_code (name, gate_code)")
    .in("area_id", areaIds)
    .is("removed_at", null);
  if (error) throw error;

  return (data ?? []).map((r) => {
    const tmpl = r.trade_steps as { name: string; gate_code: string } | null;
    return {
      area_step_id: r.id,
      step_code: r.step_code,
      name: tmpl?.name ?? r.step_code,
      gate_code: tmpl?.gate_code ?? "",
      status: r.status,
    };
  });
}

/** Call Haiku with a cached prompt + structured output; return the parsed verdict. */
export async function inferCardEventSteps(args: {
  cardTitle: string;
  eventText: string;
  candidates: CandidateStep[];
  client?: Pick<Anthropic, "messages">;
}): Promise<{ verdict: StepVerdict; model: string }> {
  const { systemText, userText } = buildInferencePrompt({
    cardTitle: args.cardTitle,
    eventText: args.eventText,
    candidates: args.candidates,
  });
  const model = getModel();
  const client = args.client ?? getAnthropicClient();
  const res = await client.messages.create({
    model,
    max_tokens: 512,
    system: cachedSystemBlock(systemText),
    messages: [{ role: "user", content: userText }],
    output_config: { format: { type: "json_schema", schema: STEP_VERDICT_SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);
  return { verdict: parseStepVerdict(textOf(res.content)), model };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web test step-infer-runner`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/steps/infer-runner.ts apps/web/tests/unit/step-infer-runner.test.ts
git commit -m "feat(steps): Haiku inference runner + candidate-steps-for-card query"
```

---

### Task 5: Write path — apply inference + wire precedence into projectAreaStep

**Files:**
- Modify: `apps/web/lib/steps/mutations.ts`
- Test: `apps/web/tests/unit/apply-step-inference.test.ts`

**Interfaces:**
- Consumes: `SelectedMatch` (Task 2); `projectAreaStep` (existing).
- Produces: `applyStepInference(supabase, args: { cardEventId: string; projectId: string; selected: SelectedMatch[] }): Promise<void>`.

- [ ] **Step 1: Write the failing test (fake supabase captures inserts)**

```ts
// apps/web/tests/unit/apply-step-inference.test.ts
import { describe, it, expect, vi } from "vitest";
import { applyStepInference } from "@/lib/steps/mutations";
import type { SelectedMatch } from "@/lib/steps/infer";

function fakeSupabase(captured: any[]) {
  return {
    from(table: string) {
      if (table === "area_step_events") {
        return { insert: (row: any) => { captured.push(row); return Promise.resolve({ error: null }); } };
      }
      // projectAreaStep reads — return empty data so it no-ops cleanly
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
}

it("inserts one AI event per selected match with source/confidence/card_event_id", async () => {
  const captured: any[] = [];
  const selected: SelectedMatch[] = [
    { area_step_id: "as-1", step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 },
  ];
  await applyStepInference(fakeSupabase(captured) as any, {
    cardEventId: "ce-1",
    projectId: "p-1",
    selected,
  });
  expect(captured).toHaveLength(1);
  expect(captured[0]).toMatchObject({
    area_step_id: "as-1",
    project_id: "p-1",
    status: "done",
    source: "ai",
    confidence: 0.9,
    card_event_id: "ce-1",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web test apply-step-inference`
Expected: FAIL — `applyStepInference` not exported.

- [ ] **Step 3: Add `source` to projectAreaStep's read, and implement `applyStepInference`**

In `apps/web/lib/steps/mutations.ts`, update the events select in `projectAreaStep` to include `source` and pass it through:

```ts
    supabase.from("area_step_events").select("occurred_at, created_at, status, note, percent_complete, source").eq("area_step_id", areaStepId),
```
```ts
    workEvents: (events ?? []).map((e) => ({
      occurred_at: e.occurred_at,
      created_at: e.created_at,
      source: (e.source ?? "human") as "human" | "ai",
      payload: {
        status: e.status,
        percent_complete: e.percent_complete ?? undefined,
        blocked_on: e.note ?? undefined,
      },
    })),
```

Then add the writer (import the type at the top: `import type { SelectedMatch } from "@/lib/steps/infer";`):

```ts
/**
 * Write AI-inferred step events for one card event, then re-project each step.
 * Idempotent via the (card_event_id, area_step_id) unique index on source='ai'
 * — a duplicate insert errors with code 23505, which we swallow.
 */
export async function applyStepInference(
  supabase: SupabaseClient<Database>,
  args: { cardEventId: string; projectId: string; selected: SelectedMatch[] },
): Promise<void> {
  for (const m of args.selected) {
    const { error } = await supabase.from("area_step_events").insert({
      area_step_id: m.area_step_id,
      project_id: args.projectId,
      status: m.status,
      note: m.blocked_on,
      percent_complete: m.status === "done" ? 100 : null,
      source: "ai",
      confidence: m.confidence,
      card_event_id: args.cardEventId,
    });
    // 23505 = unique_violation (already inferred for this card event) → skip re-project.
    if (error) {
      if ((error as { code?: string }).code === "23505") continue;
      throw error;
    }
    await projectAreaStep(supabase, m.area_step_id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C apps/web test apply-step-inference`
Expected: PASS.

- [ ] **Step 5: Run the step suite + typecheck**

Run: `pnpm -C apps/web test steps && pnpm -C apps/web typecheck`
Expected: PASS (the `source` column now exists in types from Task 3).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/steps/mutations.ts apps/web/tests/unit/apply-step-inference.test.ts
git commit -m "feat(steps): applyStepInference writer + thread source into projectAreaStep"
```

---

### Task 6: Cron route + registration

**Files:**
- Create: `apps/web/app/api/cron/infer-card-steps/route.ts`
- Modify: `apps/web/vercel.json`
- Test: `apps/web/tests/unit/infer-card-steps-cron.test.ts`

**Interfaces:**
- Consumes: `getCandidateStepsForCard`, `inferCardEventSteps` (Task 4); `applyStepInference` (Task 5); `selectApplicableMatches`, `summarizeWorkEvent` (Task 2); `createSupabaseAdminClient` (`@/lib/supabase/admin`).
- Produces: `GET` handler + exported pure `isCronAuthorized(req, secret)` and `isMissingFunctionError(error)`.

- [ ] **Step 1: Write the failing test (pure auth helper)**

```ts
// apps/web/tests/unit/infer-card-steps-cron.test.ts
import { describe, it, expect } from "vitest";
import { isCronAuthorized, isMissingFunctionError } from "@/app/api/cron/infer-card-steps/route";

it("authorizes only the correct bearer", () => {
  const req = new Request("https://x", { headers: { authorization: "Bearer s3cret" } });
  expect(isCronAuthorized(req, "s3cret")).toBe(true);
  expect(isCronAuthorized(req, "other")).toBe(false);
  expect(isCronAuthorized(req, undefined)).toBe(false);
});

it("detects the missing-RPC error", () => {
  expect(isMissingFunctionError({ code: "PGRST202", message: null })).toBe(true);
  expect(isMissingFunctionError({ code: null, message: "boom" })).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/web test infer-card-steps-cron`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the cron route (mirrors analyze-attachments)**

```ts
// apps/web/app/api/cron/infer-card-steps/route.ts
import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCandidateStepsForCard, inferCardEventSteps } from "@/lib/steps/infer-runner";
import { applyStepInference } from "@/lib/steps/mutations";
import { selectApplicableMatches, summarizeWorkEvent } from "@/lib/steps/infer";

export const maxDuration = 300;
const BATCH = 5;
const MIN_CONFIDENCE = 0.6;

export function isCronAuthorized(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export function isMissingFunctionError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("could not find the function") || msg.includes("does not exist");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: claimed, error } = await supabase.rpc("claim_card_events_for_step_inference", { p_limit: BATCH });
  if (error) {
    if (isMissingFunctionError(error)) {
      console.warn("[cron/infer-card-steps] claim RPC missing — migration not applied yet");
      return NextResponse.json({ skipped: "migration_pending" });
    }
    console.error(`[cron/infer-card-steps] claim failed: code=${error.code} message=${error.message}`);
    Sentry.captureException(new Error(error.message), { extra: { code: error.code } });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = () => new Date().toISOString();
  let done = 0, skipped = 0, failed = 0;

  for (const ev of claimed ?? []) {
    try {
      const candidates = await getCandidateStepsForCard(supabase, ev.card_id);
      if (candidates.length === 0) {
        await supabase.from("card_events")
          .update({ ai_step_status: "skipped", ai_step_error: "no_candidate_steps", ai_step_processed_at: now() })
          .eq("id", ev.id);
        skipped++;
        continue;
      }

      const { data: card } = await supabase.from("cards").select("title").eq("id", ev.card_id).single();
      const { verdict } = await inferCardEventSteps({
        cardTitle: card?.title ?? "",
        eventText: summarizeWorkEvent(ev.payload),
        candidates,
      });
      const selected = selectApplicableMatches(verdict, candidates, MIN_CONFIDENCE);
      await applyStepInference(supabase, { cardEventId: ev.id, projectId: ev.project_id, selected });

      await supabase.from("card_events")
        .update({ ai_step_status: "done", ai_step_error: null, ai_step_processed_at: now() })
        .eq("id", ev.id);
      done++;
    } catch (e) {
      console.warn(`[cron/infer-card-steps] event ${ev.id} failed: ${errMsg(e)}`);
      Sentry.captureException(e, { extra: { cardEventId: ev.id } });
      await supabase.from("card_events")
        .update({ ai_step_status: "failed", ai_step_error: errMsg(e), ai_step_processed_at: now() })
        .eq("id", ev.id);
      failed++;
    }
  }

  if ((claimed?.length ?? 0) > 0) {
    console.log(`[cron/infer-card-steps] summary: claimed=${claimed?.length ?? 0} done=${done} skipped=${skipped} failed=${failed}`);
  }
  return NextResponse.json({ claimed: claimed?.length ?? 0, done, skipped, failed });
}
```

- [ ] **Step 4: Register the cron**

In `apps/web/vercel.json`, add to the `crons` array (alongside the existing attachment + reminder entries):

```json
{ "path": "/api/cron/infer-card-steps", "schedule": "* * * * *" }
```

- [ ] **Step 5: Run test, typecheck, and build**

Run:
```bash
pnpm -C apps/web test infer-card-steps-cron
pnpm -C apps/web typecheck
pnpm --filter web build
```
Expected: test PASS; typecheck clean; build succeeds (route compiles; `"use server"` rule N/A — this is a route handler).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/cron/infer-card-steps/route.ts apps/web/vercel.json apps/web/tests/unit/infer-card-steps-cron.test.ts
git commit -m "feat(cron): infer-card-steps pipeline (claim work events -> Haiku -> AI step events)"
```

---

## Self-Review

**Spec coverage** (against `2026-06-27-card-derived-readiness-system-design.md` §3–6):
- Outbox flag on card_events + claim RPC → Task 3. ✓
- AI verdicts as a new source of `area_step_events` (provenance) → Task 3 (cols) + Task 5 (write). ✓
- Existing projection still derives status; precedence human > AI → Task 1 + Task 5 wiring. ✓
- Haiku 4.5, prompt caching, structured outputs → Task 4 (`getModel`, `cachedSystemBlock`, `output_config.format`). ✓
- Async outbox + Vercel cron mirroring attachment analysis → Task 6. ✓
- Fuzzy matching (card → multiple steps; low-confidence dropped) → Task 2 `selectApplicableMatches` + `MIN_CONFIDENCE`. ✓
- Deferred (propose→confirm UI, backfill, Slice C, affected_trades) → stated in Global Constraints. ✓

**Placeholder scan:** none — every step has runnable code/commands.

**Type consistency:** `CandidateStep`/`StepMatch`/`StepVerdict`/`SelectedMatch` defined in Task 2 and consumed verbatim in Tasks 4–6. `source?: "human" | "ai"` added in Task 1 and supplied by Task 5's `projectAreaStep` read. `applyStepInference` signature matches between Task 5 (def) and Task 6 (call). Cron `isCronAuthorized`/`isMissingFunctionError` mirror the attachment route signatures. ✓
