# Card Taxonomy Redesign & Intelligence-Layer Regression Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the card system answer the coordinator's three questions — *whose ball is it, what's the next action, is it on schedule* — by (1) fixing the consumers that still listen for retired event kinds, (2) giving decision/client_request/work events an explicit lifecycle, (3) replacing kind-presence card labels with state-derived, filterable labels, and (4) adding bottleneck/aging intelligence to the morning brief.

**Architecture:** The 9 active event kinds stay as the *evidence* taxonomy. State is made explicit via payload lifecycle fields (`decision.status`, `client_request.status`, `work.blocked_on`/`issue`), backfilled by SQL migration. All derived layers (gate readiness, card labels, brief, notifications) are pure functions over events + payloads, each with unit tests. Event resolution (marking a decision decided) goes through a `security definer` RPC that updates the payload **and** writes a `record_revisions` row, preserving the append-only audit convention.

**Tech Stack:** Next.js 16 / React 19 (apps/web), Supabase Postgres + RLS (packages/db), Zod schemas (packages/types), Vitest unit tests, pnpm workspaces.

**Context for the implementer (read this first):**
- Slice 1.9 consolidated 14 event kinds → 9 (`decision, drawing, vendor, material, work, client_request, note, photo, document`) and migrated all 503 rows ([packages/db/supabase/migrations/20260601000021_event_kind_migrate_data.sql](../../../packages/db/supabase/migrations/20260601000021_event_kind_migrate_data.sql)). The retired kinds (`survey, vendor_quote, vendor_pick, worker_assigned, progress, defect, pending`) remain in the DB enum but **zero rows have them** and the app never creates them.
- Three consumers were never updated and are dead: `apps/web/lib/gates/readiness-rules.ts` (all gates filter on retired kinds), `apps/web/lib/brief/queries.ts` (queries `event_kind = 'pending'` / `'defect'`), `apps/web/lib/notifications/producers.ts` (`NOTIFIABLE_KINDS` includes `defect`/`pending`).
- UI language is Bahasa Indonesia. All user-facing strings in this plan are Bahasa-first.
- DB conventions: never edit an applied migration; append-only — corrections write `record_revisions` rows; `card_events` has SELECT + INSERT RLS policies only (no UPDATE — hence the RPC in Task 5).
- Run all commands from the repo root unless stated. The Supabase project is **linked and live** — `supabase db push` applies new migrations to it. Never run `pnpm db:reset` (destructive).

---

## Phase 1 — Restore the intelligence layer (regression fix)

### Task 1: Readiness rules v2 (9-kind taxonomy)

**Files:**
- Modify: `apps/web/lib/gates/readiness-rules.ts`
- Test: `apps/web/tests/unit/gate-rules.test.ts`

Semantics change: `work` is the single process-state kind. The **latest** `work` event (by `occurred_at`) on the area's cards determines the work-stream state — a later entry supersedes an older blocker, since the log is append-only and nothing is edited in place.

- [ ] **Step 1: Rewrite the test file for the new rules**

Replace the entire contents of `apps/web/tests/unit/gate-rules.test.ts` with:

```typescript
import { describe, expect, it } from "vitest";
import { evaluateGate, RULE_VERSION } from "@/lib/gates/readiness-rules";
import type { CardEvent } from "@datum/db";

function mockEvent(kind: string, payload: Record<string, unknown> = {}, occurredAt = "2026-05-20T00:00:00Z"): CardEvent {
  return {
    id: crypto.randomUUID(),
    card_id: "c1",
    project_id: "p1",
    event_kind: kind as CardEvent["event_kind"],
    payload: payload as never,
    occurred_at: occurredAt,
    logged_by_staff_id: null,
    source_kind: "manual",
    source_id: null,
    cost_visible: false,
    draft_id: null,
    created_at: occurredAt,
  };
}

describe("evaluateGate (rule version 2)", () => {
  it("bumped the rule version", () => {
    expect(RULE_VERSION).toBe(2);
  });

  it("returns not_started when there are no events", () => {
    const r = evaluateGate("B", { events: [] });
    expect(r.status).toBe("not_started");
    expect(r.readinessScore).toBe(0);
  });

  it("ignores irrelevant kinds for a gate", () => {
    // For gate B (Kamar Mandi), 'photo' is not relevant
    const r = evaluateGate("B", { events: [mockEvent("photo", { caption: "site" })] });
    expect(r.status).toBe("not_started");
  });

  it("counts active kinds for every gate — G advances on work events", () => {
    const r = evaluateGate("G", { events: [mockEvent("work", { status: "in_progress" })] });
    expect(r.status).toBe("in_progress");
  });

  it("returns in_progress with relevant evidence", () => {
    const r = evaluateGate("B", { events: [mockEvent("material", { item: "marmer", status: "specified" })] });
    expect(r.status).toBe("in_progress");
    expect(r.readinessScore).toBeGreaterThan(0);
    expect(r.readinessScore).toBeLessThan(1);
  });

  it("returns blocked when the latest work event is blocked", () => {
    const r = evaluateGate("B", { events: [
      mockEvent("material", { item: "marmer", status: "specified" }),
      mockEvent("work", { status: "blocked", description: "menunggu approval Wilson" }),
    ]});
    expect(r.status).toBe("blocked");
    expect(r.blockingReason).toContain("Wilson");
  });

  it("prefers blocked_on over description as the blocking reason", () => {
    const r = evaluateGate("A", { events: [
      mockEvent("work", { status: "blocked", blocked_on: "PLN belum sambung listrik", description: "rough-in lt 2" }),
    ]});
    expect(r.status).toBe("blocked");
    expect(r.blockingReason).toBe("PLN belum sambung listrik");
  });

  it("a later non-blocked work event supersedes an older blocker", () => {
    const r = evaluateGate("A", { events: [
      mockEvent("work", { status: "blocked", description: "tunggu material" }, "2026-05-10T00:00:00Z"),
      mockEvent("work", { status: "in_progress" }, "2026-05-20T00:00:00Z"),
    ]});
    expect(r.status).toBe("in_progress");
  });

  it("returns ready_for_handoff when the latest work event is done", () => {
    const r = evaluateGate("E", { events: [mockEvent("work", { status: "done" })] });
    expect(r.status).toBe("ready_for_handoff");
    expect(r.readinessScore).toBe(1.0);
  });

  it("returns ready_for_handoff when the latest work event hits 100%", () => {
    const r = evaluateGate("E", { events: [
      mockEvent("work", { status: "in_progress", percent_complete: 100 }),
    ]});
    expect(r.status).toBe("ready_for_handoff");
  });

  it("a later blocked event supersedes an older done event", () => {
    const r = evaluateGate("E", { events: [
      mockEvent("work", { status: "done" }, "2026-05-10T00:00:00Z"),
      mockEvent("work", { status: "blocked", description: "defect cat mengelupas" }, "2026-05-20T00:00:00Z"),
    ]});
    expect(r.status).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- tests/unit/gate-rules.test.ts`
Expected: FAIL — `RULE_VERSION` is 1, blocked/ready cases return `not_started`/`in_progress` because `work` is not in the old relevant sets for A/E/G and old rules look for `pending`/`progress`.

- [ ] **Step 3: Rewrite the rules**

Replace the contents of `apps/web/lib/gates/readiness-rules.ts` from the `RELEVANT_KINDS` declaration through the end of `evaluateGate` with (keep the existing imports and type declarations at the top of the file unchanged):

```typescript
/**
 * Per-gate "relevant" event kinds — rule version 2, aligned with the
 * consolidated 9-kind taxonomy (slice 1.9). `work` carries all process
 * state (assigned/in_progress/blocked/done) and is relevant to every gate.
 */
const RELEVANT_KINDS: Record<GateCode, ReadonlySet<CardEventKind>> = {
  A: new Set(["work", "drawing"]),
  B: new Set(["material", "decision", "vendor", "work"]),
  C: new Set(["material", "work"]),
  D: new Set(["material", "decision", "vendor", "drawing", "work"]),
  E: new Set(["material", "work"]),
  F: new Set(["vendor", "material", "drawing", "work"]),
  G: new Set(["work"]),
  H: new Set(["client_request", "decision", "document", "work"]),
};

const RULE_VERSION = 2;

export function evaluateGate(gate: GateCode, input: GateInput): GateResult {
  const relevant = RELEVANT_KINDS[gate];
  const events = input.events.filter((e) => relevant.has(e.event_kind as CardEventKind));

  if (events.length === 0) {
    return { status: "not_started", readinessScore: 0, blockingReason: null };
  }

  // The latest work event determines the work-stream state. The log is
  // append-only, so a newer entry supersedes an older blocker or completion.
  const latestWork = events
    .filter((e) => e.event_kind === "work")
    .sort((a, b) => (a.occurred_at ?? "").localeCompare(b.occurred_at ?? ""))
    .at(-1);
  const wp = latestWork?.payload as {
    status?: string;
    percent_complete?: number;
    blocked_on?: string;
    description?: string;
    notes?: string;
  } | undefined;

  if (wp?.status === "blocked") {
    return {
      status: "blocked",
      readinessScore: 0.25,
      blockingReason: wp.blocked_on ?? wp.description ?? wp.notes ?? "Ada pekerjaan terblokir",
    };
  }

  if (wp && (wp.status === "done" || (typeof wp.percent_complete === "number" && wp.percent_complete >= 100))) {
    return { status: "ready_for_handoff", readinessScore: 1.0, blockingReason: null };
  }

  const score = Math.min(0.9, 0.3 + events.length * 0.05);
  return { status: "in_progress", readinessScore: Number(score.toFixed(2)), blockingReason: null };
}

export { RULE_VERSION };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test -- tests/unit/gate-rules.test.ts`
Expected: PASS (all 10 tests). Note: `apps/web/lib/gates/recompute.ts` calls `evaluateGate` and needs no change.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck
git add apps/web/lib/gates/readiness-rules.ts apps/web/tests/unit/gate-rules.test.ts
git commit -m "fix(gates): readiness rules v2 — evaluate the consolidated 9-kind taxonomy

Rules v1 filtered on retired kinds (pending/progress/defect/worker_assigned/
vendor_pick) that no rows carry since the slice-1.9 migration, so no gate
could ever become blocked or ready_for_handoff. v2 reads work.status from
the latest work event instead."
```

---

### Task 2: Watcher notifications for the new taxonomy

**Files:**
- Modify: `apps/web/lib/notifications/producers.ts:46-60`
- Modify: `apps/web/lib/cards/mutations.ts:177` (single call site of `notifyWatchersOfEvent`)
- Test: `apps/web/tests/unit/notifications.test.ts` (create)

`NOTIFIABLE_KINDS` currently contains `defect` and `pending` (extinct). Watchers should be notified for `decision`, `client_request`, and `work` — but for `work` only when it's a blocker or defect, otherwise every routine progress log spams watchers.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/notifications.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { shouldNotifyWatchers } from "@/lib/notifications/producers";

describe("shouldNotifyWatchers", () => {
  it("notifies for decisions and client requests", () => {
    expect(shouldNotifyWatchers("decision", { topic: "marmer" })).toBe(true);
    expect(shouldNotifyWatchers("client_request", { request_text: "ubah warna" })).toBe(true);
  });

  it("does not notify for routine evidence kinds", () => {
    expect(shouldNotifyWatchers("photo", {})).toBe(false);
    expect(shouldNotifyWatchers("note", { body: "ok" })).toBe(false);
    expect(shouldNotifyWatchers("material", { item: "keramik", status: "ordered" })).toBe(false);
  });

  it("notifies for work only when blocked or a defect", () => {
    expect(shouldNotifyWatchers("work", { status: "in_progress" })).toBe(false);
    expect(shouldNotifyWatchers("work", { status: "blocked", blocked_on: "tunggu klien" })).toBe(true);
    expect(shouldNotifyWatchers("work", { status: "in_progress", issue: "defect", severity: "high" })).toBe(true);
  });

  it("does not notify for retired kinds", () => {
    expect(shouldNotifyWatchers("pending", { what: "x" })).toBe(false);
    expect(shouldNotifyWatchers("defect", { description: "x" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test -- tests/unit/notifications.test.ts`
Expected: FAIL — `shouldNotifyWatchers` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/lib/notifications/producers.ts`, replace the `NOTIFIABLE_KINDS` declaration (line 46-48) and the guard at the top of `notifyWatchersOfEvent` with:

```typescript
// 2. Watcher event: fan out to card_members (owner/watcher/assignee).
//    Decisions and client requests always notify; work only when it is a
//    blocker or a defect — routine progress logs would be noise.
const NOTIFIABLE_KINDS = new Set(["decision", "client_request", "work"]);

export function shouldNotifyWatchers(
  eventKind: string,
  payload?: Record<string, unknown> | null,
): boolean {
  if (!NOTIFIABLE_KINDS.has(eventKind)) return false;
  if (eventKind === "work") {
    return payload?.status === "blocked" || payload?.issue === "defect";
  }
  return true;
}
```

Then change the `notifyWatchersOfEvent` signature to accept the payload and use the helper — add `payload?: Record<string, unknown> | null;` to its `args` type, and replace the first line of its body:

```typescript
  if (!shouldNotifyWatchers(args.eventKind, args.payload)) return;
```

- [ ] **Step 4: Pass the payload at the call site**

In `apps/web/lib/cards/mutations.ts`, inside `createCardEvent` (the `notifyWatchersOfEvent` call at line 177), add one argument:

```typescript
    await notifyWatchersOfEvent(supabase, {
      eventId: data.id,
      eventKind: input.eventKind,
      payload: parsed.data as Record<string, unknown>,
      actorId: user.id,
      projectId: input.projectId,
      projectCode: input.projectCode,
      cardId: input.cardId,
      cardSlug: cardRow.slug,
      cardTitle: cardRow.title,
    });
```

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter web test -- tests/unit/notifications.test.ts && pnpm typecheck`
Expected: PASS / no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/notifications/producers.ts apps/web/lib/cards/mutations.ts apps/web/tests/unit/notifications.test.ts
git commit -m "fix(notifications): watch consolidated kinds — work notifies only when blocked or defect"
```

---

## Phase 2 — Explicit lifecycle on open-loop events

### Task 3: Zod lifecycle fields + open-loop helpers

**Files:**
- Modify: `packages/types/src/event-kinds.ts`
- Test: `apps/web/tests/unit/event-lifecycle.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/event-lifecycle.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  parseEventPayload,
  isDecisionOpen,
  isClientRequestOpen,
} from "@datum/types";

describe("decision lifecycle", () => {
  it("accepts status and awaiting", () => {
    const p = parseEventPayload("decision", {
      topic: "marmer master bath",
      status: "needs_decision",
      awaiting: "client",
    });
    expect(p.status).toBe("needs_decision");
    expect(p.awaiting).toBe("client");
  });

  it("rejects unknown status / awaiting values", () => {
    expect(() => parseEventPayload("decision", { topic: "x", status: "maybe" })).toThrow();
    expect(() => parseEventPayload("decision", { topic: "x", awaiting: "mandor" })).toThrow();
  });

  it("isDecisionOpen: explicit status wins, else falls back to approved_by", () => {
    expect(isDecisionOpen({ status: "needs_decision" })).toBe(true);
    expect(isDecisionOpen({ status: "decided" })).toBe(false);
    expect(isDecisionOpen({ status: "superseded" })).toBe(false);
    // Legacy payloads without status:
    expect(isDecisionOpen({ approved_by: "client" })).toBe(false);
    expect(isDecisionOpen({})).toBe(true);
  });
});

describe("client_request lifecycle", () => {
  it("accepts open/answered status", () => {
    const p = parseEventPayload("client_request", { request_text: "ubah warna kusen", status: "open" });
    expect(p.status).toBe("open");
  });

  it("isClientRequestOpen treats missing status as open", () => {
    expect(isClientRequestOpen({})).toBe(true);
    expect(isClientRequestOpen({ status: "open" })).toBe(true);
    expect(isClientRequestOpen({ status: "answered" })).toBe(false);
  });
});

describe("work blocker/defect fields", () => {
  it("accepts blocked_on, issue and fix_required_by", () => {
    const p = parseEventPayload("work", {
      status: "blocked",
      blocked_on: "menunggu keputusan klien soal granit",
      issue: "defect",
      severity: "high",
      fix_required_by: "2026-07-01",
    });
    expect(p.blocked_on).toContain("granit");
    expect(p.issue).toBe("defect");
  });

  it("rejects unknown issue values", () => {
    expect(() => parseEventPayload("work", { status: "blocked", issue: "rework" })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test -- tests/unit/event-lifecycle.test.ts`
Expected: FAIL — `isDecisionOpen` / `isClientRequestOpen` not exported; unknown keys are stripped silently but the enum assertions on `status`/`awaiting`/`issue` fail because the fields don't exist on the inferred types.

- [ ] **Step 3: Extend the schemas**

In `packages/types/src/event-kinds.ts`:

Replace `DecisionPayload` with:

```typescript
const DecisionPayload = z.object({
  topic: z.string().min(1),
  current_spec: z.string().optional(),
  proposed_spec: z.string().optional(),
  // Lifecycle: an open decision ("needs_decision") is the unit the board,
  // brief and reminders operate on. Absent status on legacy rows is
  // interpreted via isDecisionOpen() below.
  status: z.enum(["needs_decision", "decided", "superseded"]).optional(),
  // Whose ball is it — drives the "Menunggu X" board label.
  awaiting: z.enum(["client", "principal", "pic", "contractor", "architect", "vendor"]).optional(),
  approved_by: z.enum(["client", "principal", "pic"]).optional(),
  approval_evidence: z.string().optional(),
  ...aiRationale,
});
```

Replace `ClientRequestPayload` with:

```typescript
const ClientRequestPayload = z.object({
  request_text: z.string().min(1),
  requested_by: z.string().optional(),
  awaiting: z.string().optional(),
  status: z.enum(["open", "answered"]).optional(),
  ...aiRationale,
});
```

Replace `WorkPayload` with:

```typescript
const WorkPayload = z.object({
  status: z.enum(["assigned", "in_progress", "blocked", "done"]),
  worker_name: z.string().optional(),
  role: z.string().optional(),
  scope: z.string().optional(),
  start_date: z.string().optional(),
  percent_complete: z.number().min(0).max(100).optional(),
  description: z.string().optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  // Blocker: who/what the work is waiting on (shown as blocking reason).
  blocked_on: z.string().optional(),
  // Quality issue marker — distinguishes a defect from merely stalled work.
  issue: z.enum(["defect"]).optional(),
  fix_required_by: z.string().optional(),
  ...aiRationale,
});
```

Append at the end of the file (after `HIGH_RISK_KINDS`):

```typescript
// ─── Open-loop helpers ────────────────────────────────────────────────────────
// "Open" decisions/requests are what labels, the brief, and reminders count.
// Legacy rows (pre-lifecycle backfill) may lack `status`; fall back sensibly.

export function isDecisionOpen(payload: {
  status?: string | null;
  approved_by?: string | null;
}): boolean {
  if (payload.status) return payload.status === "needs_decision";
  return !payload.approved_by;
}

export function isClientRequestOpen(payload: { status?: string | null }): boolean {
  return (payload.status ?? "open") === "open";
}
```

- [ ] **Step 4: Run tests, typecheck**

Run: `pnpm --filter web test -- tests/unit/event-lifecycle.test.ts && pnpm typecheck`
Expected: PASS / clean. Also run the existing schema tests: `pnpm --filter web test -- tests/unit/event-schemas.test.ts` — Expected: PASS (all new fields are optional, existing payloads still parse).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/event-kinds.ts apps/web/tests/unit/event-lifecycle.test.ts
git commit -m "feat(types): explicit lifecycle on decision/client_request/work payloads

decision.status + awaiting, client_request.status, work.blocked_on/issue/
fix_required_by, plus isDecisionOpen/isClientRequestOpen helpers."
```

---

### Task 4: Lifecycle backfill migration

**Files:**
- Create: `packages/db/supabase/migrations/20260611000001_lifecycle_backfill.sql`

This backfill makes every existing row carry explicit lifecycle state, and rescues the legacy blockers that the slice-1.9 migration buried in free-text notes.

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/20260611000001_lifecycle_backfill.sql`:

```sql
-- 20260611000001_lifecycle_backfill.sql
-- Card taxonomy redesign step 1: backfill explicit lifecycle state.
-- Idempotent: every statement guards on the key it adds.

begin;

-- decision: explicit status. A decision with approval evidence is decided;
-- everything else is still open.
update public.card_events
   set payload = payload || jsonb_build_object(
         'status',
         case when payload ? 'approved_by' then 'decided' else 'needs_decision' end
       )
 where event_kind = 'decision'
   and not payload ? 'status';

-- client_request: explicit open status. We cannot know which legacy requests
-- were answered; they start open and staff resolve them via the timeline UI.
update public.card_events
   set payload = payload || jsonb_build_object('status', 'open')
 where event_kind = 'client_request'
   and not payload ? 'status';

-- Ex-defect work events: only defect payloads carried `severity` at
-- migration time (slice 1.9 set them to work/status=blocked). Mark them as
-- defects so quality issues are distinguishable from stalled work again.
update public.card_events
   set payload = payload || jsonb_build_object('issue', 'defect')
 where event_kind = 'work'
   and payload ? 'severity'
   and not payload ? 'issue';

-- Legacy pending notes → structured blocked work events. Slice 1.9 folded
-- `pending` blockers into free-text notes ("(menunggu) …" +
-- pending_blocked_on), which made them invisible to readiness/brief logic.
update public.card_events
   set event_kind = 'work',
       payload = jsonb_strip_nulls(jsonb_build_object(
         'status', 'blocked',
         'description', nullif(replace(coalesce(payload->>'body', ''), '(menunggu) ', ''), ''),
         'blocked_on', payload->>'pending_blocked_on'
       ))
 where event_kind = 'note'
   and payload ? 'pending_blocked_on';

commit;
```

- [ ] **Step 2: Apply to the linked project**

```bash
cd packages/db/supabase && supabase db push && cd ../../..
```

Expected: the one new migration applies cleanly. **If `db push` reports migration drift or asks to repair history, STOP and ask the user — do not repair automatically.**

- [ ] **Step 3: Regenerate DB types**

Run: `pnpm db:types`
Expected: regenerates `packages/db` types (payload is `jsonb`, so likely a no-op diff — that's fine).

- [ ] **Step 4: Verify the backfill (spot-check via SQL)**

```bash
cd packages/db/supabase
supabase db query --linked "select event_kind, count(*) from public.card_events where event_kind in ('decision','client_request') and not payload ? 'status' group by 1;"
supabase db query --linked "select count(*) from public.card_events where event_kind = 'note' and payload ? 'pending_blocked_on';"
cd ../../..
```

Expected: both queries return zero rows / zero count. (If the `supabase db query` subcommand is unavailable in the installed CLI version, run the same SQL in the Supabase dashboard SQL editor and paste the result.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/20260611000001_lifecycle_backfill.sql packages/db
git commit -m "feat(db): backfill lifecycle status + rescue legacy blockers from notes"
```

---

### Task 5: `resolve_card_event` RPC + server action

**Files:**
- Create: `packages/db/supabase/migrations/20260611000002_resolve_card_event_rpc.sql`
- Modify: `apps/web/lib/cards/mutations.ts` (append new action at end of file)

`card_events` deliberately has no UPDATE RLS policy (append-only). Resolution goes through a `security definer` function that updates **only** the payload `status` key and records the correction in `record_revisions` atomically — this matches the existing convention ("corrections create new rows in record_revisions").

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/20260611000002_resolve_card_event_rpc.sql`:

```sql
-- 20260611000002_resolve_card_event_rpc.sql
-- Resolve an open-loop event (decision decided, client_request answered)
-- by updating payload.status and recording the correction in
-- record_revisions — atomically, under security definer, because
-- card_events intentionally has no UPDATE RLS policy.

create or replace function public.resolve_card_event(
  p_event_id uuid,
  p_new_status text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.card_events%rowtype;
  v_old jsonb;
  v_new jsonb;
begin
  select * into v_event from public.card_events where id = p_event_id;
  if not found then
    raise exception 'card_event % not found', p_event_id;
  end if;

  if not public.current_can_read_project(v_event.project_id) then
    raise exception 'not authorized for this project';
  end if;

  if v_event.event_kind = 'decision' then
    if p_new_status not in ('needs_decision', 'decided', 'superseded') then
      raise exception 'invalid decision status: %', p_new_status;
    end if;
  elsif v_event.event_kind = 'client_request' then
    if p_new_status not in ('open', 'answered') then
      raise exception 'invalid client_request status: %', p_new_status;
    end if;
  else
    raise exception 'event kind % has no resolvable lifecycle', v_event.event_kind;
  end if;

  v_old := v_event.payload;
  v_new := v_old || jsonb_build_object('status', p_new_status);

  update public.card_events set payload = v_new where id = p_event_id;

  insert into public.record_revisions
    (project_id, entity_type, entity_id, revision_type,
     previous_payload, new_payload, actor_staff_id, reason)
  values
    (v_event.project_id, 'card_event', p_event_id, 'corrected',
     v_old, v_new, auth.uid(), p_reason);
end;
$$;

revoke all on function public.resolve_card_event(uuid, text, text) from public;
grant execute on function public.resolve_card_event(uuid, text, text) to authenticated;
```

- [ ] **Step 2: Apply and regenerate types**

```bash
cd packages/db/supabase && supabase db push && cd ../../..
pnpm db:types
```

Expected: migration applies; `resolve_card_event` appears in the generated `Database["public"]["Functions"]` types.

- [ ] **Step 3: Add the server action**

Append to `apps/web/lib/cards/mutations.ts`:

```typescript
// ─── resolveCardEvent ─────────────────────────────────────────────────────────
// Mark an open-loop event resolved (decision → decided/superseded,
// client_request → answered). Goes through the resolve_card_event RPC so the
// payload update and the record_revisions audit row commit atomically.

const ResolveEventInput = z.object({
  eventId:     z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
  newStatus:   z.enum(["needs_decision", "decided", "superseded", "open", "answered"]),
  reason:      z.string().max(500).optional(),
});

export type ResolveEventResult = { ok: true } | { ok: false; error: string };

export async function resolveCardEvent(formData: FormData): Promise<ResolveEventResult> {
  let input;
  try {
    input = ResolveEventInput.parse({
      eventId:     formData.get("eventId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      newStatus:   formData.get("newStatus"),
      reason:      formData.get("reason") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const { error } = await supabase.rpc("resolve_card_event", {
    p_event_id:   input.eventId,
    p_new_status: input.newStatus,
    p_reason:     input.reason ?? undefined,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}
```

(If the regenerated types declare `p_reason` as `string | undefined` vs `string | null`, match whichever the generated signature requires — typecheck will tell you.)

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm typecheck
git add packages/db/supabase/migrations/20260611000002_resolve_card_event_rpc.sql packages/db apps/web/lib/cards/mutations.ts
git commit -m "feat(cards): resolve_card_event RPC + server action (append-only safe resolution)"
```

---

### Task 6: Resolve buttons in the timeline + Bahasa labels for new fields

**Files:**
- Modify: `apps/web/components/board/EventRow.tsx`
- Modify: `apps/web/components/board/Timeline.tsx` (props pass-through, lines 9-15 and 100)
- Modify: `apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx:105` (Timeline call site)
- Modify: `apps/web/lib/cards/payload-render.ts`

- [ ] **Step 1: Add value/field labels to payload-render**

In `apps/web/lib/cards/payload-render.ts`, add these entries to `FIELD_LABELS` (keep existing entries):

```typescript
  status:          "Status",
  awaiting:        "Menunggu",
  blocked_on:      "Terblokir oleh",
  issue:           "Jenis isu",
  fix_required_by: "Perbaiki sebelum",
  expires_at:      "Berlaku sampai",
  interaction:     "Interaksi",
  item:            "Material",
  spec:            "Spesifikasi",
  scope:           "Lingkup",
  percent_complete:"Progres (%)",
  proposed_spec:   "Spesifikasi diusulkan",
  current_spec:    "Spesifikasi sekarang",
  approved_by:     "Disetujui oleh",
```

Below `HIDDEN_FIELDS`, add a value-label map and helper:

```typescript
/** Bahasa labels for well-known enum payload values (statuses, actors). */
const VALUE_LABELS: Record<string, string> = {
  needs_decision:  "Butuh keputusan",
  decided:         "Sudah diputuskan",
  superseded:      "Digantikan",
  open:            "Terbuka",
  answered:        "Terjawab",
  assigned:        "Ditugaskan",
  in_progress:     "Dikerjakan",
  blocked:         "Terblokir",
  done:            "Selesai",
  specified:       "Spesifikasi dibuat",
  sample_approved: "Sampel disetujui",
  ordered:         "Dipesan",
  delivered:       "Terkirim",
  quote:           "Penawaran",
  pick:            "Dipilih",
  contract:        "Kontrak",
  defect:          "Defect",
  client:          "Klien",
  principal:       "Prinsipal",
  pic:             "PIC",
  contractor:      "Kontraktor",
  architect:       "Arsitek",
};

export function valueLabel(v: string): string {
  return VALUE_LABELS[v] ?? v;
}
```

In `renderPayload`, apply it to string values — change the `value` computation to:

```typescript
    const value = Array.isArray(raw)
      ? raw.map((v) => String(v)).join(", ")
      : typeof raw === "object"
      ? JSON.stringify(raw)
      : typeof raw === "string"
      ? valueLabel(raw)
      : String(raw);
```

- [ ] **Step 2: Thread projectCode/cardSlug through Timeline**

In `apps/web/components/board/Timeline.tsx`, extend the props (lines 9-15):

```typescript
export function Timeline({
  events,
  attachmentsByEvent,
  projectCode,
  cardSlug,
}: {
  events: CardEvent[];
  attachmentsByEvent: Map<string, CardAttachment[]>;
  projectCode: string;
  cardSlug: string;
}) {
```

and pass them at line 100:

```tsx
            <EventRow
              key={ev.id}
              event={ev}
              attachments={attachmentsByEvent.get(ev.id) ?? []}
              projectCode={projectCode}
              cardSlug={cardSlug}
            />
```

In `apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx` (line 105), update the call site:

```tsx
                <Timeline
                  events={detail.events}
                  attachmentsByEvent={attachmentsByEvent}
                  projectCode={project.project_code}
                  cardSlug={cardSlug}
                />
```

(The page already has `project.project_code` and the `cardSlug` route param in scope — see lines 25-33.)

- [ ] **Step 3: Add the resolve action to EventRow**

In `apps/web/components/board/EventRow.tsx`:

Add imports at the top:

```typescript
import { isDecisionOpen, isClientRequestOpen } from "@datum/types";
import { resolveCardEvent } from "@/lib/cards/mutations";
```

Extend the component props:

```typescript
export function EventRow({
  event,
  attachments,
  projectCode,
  cardSlug,
}: {
  event: CardEvent;
  attachments: CardAttachment[];
  projectCode: string;
  cardSlug: string;
}) {
```

Inside the flex row `<div className="flex gap-3">`, after the high-risk chip block (`{isHighRisk ? … : null}`), add:

```tsx
        <ResolveAction event={event} projectCode={projectCode} cardSlug={cardSlug} />
```

And add this component at the bottom of the file:

```tsx
/** One-click resolution for open-loop events. Renders nothing for events
 *  that are already resolved or have no lifecycle. */
function ResolveAction({
  event,
  projectCode,
  cardSlug,
}: {
  event: CardEvent;
  projectCode: string;
  cardSlug: string;
}) {
  const p = event.payload as Record<string, unknown>;
  let newStatus: "decided" | "answered" | null = null;
  let label = "";
  if (
    event.event_kind === "decision" &&
    isDecisionOpen(p as { status?: string; approved_by?: string })
  ) {
    newStatus = "decided";
    label = "Tandai diputuskan";
  } else if (
    event.event_kind === "client_request" &&
    isClientRequestOpen(p as { status?: string })
  ) {
    newStatus = "answered";
    label = "Tandai terjawab";
  }
  if (!newStatus) return null;
  return (
    <form action={resolveCardEvent} className="flex-shrink-0 self-start">
      <input type="hidden" name="eventId" value={event.id} />
      <input type="hidden" name="projectCode" value={projectCode} />
      <input type="hidden" name="cardSlug" value={cardSlug} />
      <input type="hidden" name="newStatus" value={newStatus} />
      <button
        type="submit"
        className="rounded border border-[var(--border)] bg-[var(--surface-alt)] px-2 py-0.5 text-[10px] font-medium text-[var(--sand-dark)] hover:border-[var(--sand-dark)]"
      >
        {label}
      </button>
    </form>
  );
}
```

Also update `summarize` so work/material statuses read in Bahasa — add the import `import { valueLabel } from "@/lib/cards/payload-render";` and in the `work` case change `const status = p.status as string ?? "?";` to `const status = valueLabel((p.status as string) ?? "?");`, and in the `material` case change the return to `` return `${String(p.item)} — ${valueLabel(String(p.status))}`; ``.

- [ ] **Step 4: Typecheck and run the unit suite**

Run: `pnpm typecheck && pnpm --filter web test`
Expected: clean. (EventRow has no unit tests; it is covered by E2E.)

- [ ] **Step 5: Manual smoke check**

Run `pnpm --filter web dev`, log in as `wilson@datum.local` / `password123`, open project BDG-H1, open a card with a decision event. Verify: open decisions show a "Tandai diputuskan" button; clicking it refreshes the timeline and the button disappears; the payload now renders "Status: Sudah diputuskan".

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/board/EventRow.tsx apps/web/components/board/Timeline.tsx "apps/web/app/(app)/project/[slug]/cards/[cardSlug]/page.tsx" apps/web/lib/cards/payload-render.ts
git commit -m "feat(web): one-click resolve for open decisions/requests + Bahasa value labels"
```

---

## Phase 3 — State-derived card labels + filterable board

### Task 7: `computeCardLabels` v2 (open loops, not kind-presence)

**Files:**
- Modify: `apps/web/lib/cards/labels.ts` (full rewrite)
- Modify: `apps/web/lib/cards/queries.ts:19-83` (`getBoardForProject`)
- Modify: `apps/web/components/board/MiniCard.tsx:14` (chip key)
- Test: `apps/web/tests/unit/card-labels.test.ts` (create)
- Test: `apps/web/tests/unit/cards-queries.test.ts` (update fakeClient)

The old labels (`Berisiko`/`Klien`/`Keputusan`) fire on kind-presence in a 30-day window — nearly every working card goes red, and one event produces two chips. v2 derives from open loops: *Terblokir* (latest work blocked), *Butuh keputusan* (open decision), *Menunggu {aktor}* (whose ball it is).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/card-labels.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeCardLabels, type LabelEvent } from "@/lib/cards/labels";
import type { Card } from "@datum/db";

function card(status: Card["status"]): Card {
  return {
    id: "c1", project_id: "p1", topic_id: "t1",
    title: "Master bathroom", slug: "master", status,
    current_summary: null, properties: null,
    created_by_staff_id: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    last_event_at: null,
  } as Card;
}

function ev(kind: string, payload: Record<string, unknown>, occurredAt = "2026-06-01T00:00:00Z"): LabelEvent {
  return { event_kind: kind, payload, occurred_at: occurredAt };
}

describe("computeCardLabels v2", () => {
  it("closed → Selesai only; dormant → Tertunda only", () => {
    expect(computeCardLabels(card("closed"), [ev("decision", { status: "needs_decision" })]))
      .toEqual([{ kind: "done", label: "Selesai" }]);
    expect(computeCardLabels(card("dormant"), []))
      .toEqual([{ kind: "pending", label: "Tertunda" }]);
  });

  it("active card with no open loops gets no chips", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { status: "decided" }),
      ev("client_request", { status: "answered" }),
      ev("work", { status: "in_progress" }),
      ev("photo", {}),
    ]);
    expect(labels).toEqual([]);
  });

  it("open decision → Butuh keputusan + Menunggu actor", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { status: "needs_decision", awaiting: "client" }),
    ]);
    expect(labels).toEqual([
      { kind: "needs_decision", label: "Butuh keputusan" },
      { kind: "awaiting", label: "Menunggu Klien" },
    ]);
  });

  it("legacy decision without status but with approved_by counts as closed", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { topic: "marmer", approved_by: "client" }),
    ]);
    expect(labels).toEqual([]);
  });

  it("latest blocked work → Terblokir; superseded blocker does not label", () => {
    expect(computeCardLabels(card("active"), [
      ev("work", { status: "blocked", blocked_on: "tunggu PLN" }),
    ])).toEqual([{ kind: "blocked", label: "Terblokir" }]);

    expect(computeCardLabels(card("active"), [
      ev("work", { status: "blocked" }, "2026-05-01T00:00:00Z"),
      ev("work", { status: "in_progress" }, "2026-06-01T00:00:00Z"),
    ])).toEqual([]);
  });

  it("open client_request → Menunggu Klien (deduped against decision-awaiting-client)", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { status: "needs_decision", awaiting: "client" }),
      ev("client_request", { request_text: "ubah warna", status: "open" }),
    ]);
    expect(labels.filter((l) => l.label === "Menunggu Klien")).toHaveLength(1);
  });

  it("caps at 3 chips, blocked first", () => {
    const labels = computeCardLabels(card("active"), [
      ev("work", { status: "blocked" }),
      ev("decision", { status: "needs_decision", awaiting: "vendor" }),
      ev("client_request", { status: "open" }),
    ]);
    expect(labels).toHaveLength(3);
    expect(labels[0]!.kind).toBe("blocked");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- tests/unit/card-labels.test.ts`
Expected: FAIL — `LabelEvent` not exported; `computeCardLabels` has the old `(card, Set<string>)` signature.

- [ ] **Step 3: Rewrite labels.ts**

Replace the entire contents of `apps/web/lib/cards/labels.ts` with:

```typescript
/**
 * Card labels v2 — derived from OPEN LOOPS in the event stream, not from
 * kind-presence in a time window. Each chip answers a coordination
 * question: is this blocked, does it need a decision, whose ball is it.
 *
 * Labels are derived, not stored — computed from card.status + the card's
 * decision/client_request/work events at read time.
 */

import type { Card } from "@datum/db";
import { isClientRequestOpen, isDecisionOpen } from "@datum/types";
import type { CardDeadline } from "@/lib/gates/board-deadlines";

export type CardLabelKind =
  | "blocked"          // latest work event is blocked — red
  | "needs_decision"   // an open decision exists — warning amber
  | "awaiting"         // waiting on a named actor — info blue
  | "pending"          // card status: dormant — sand
  | "done";            // card status: closed — ok green

export type CardLabel = {
  kind: CardLabelKind;
  label: string;       // short Bahasa label shown on the chip
};

/** Minimal slice of a card_event needed to derive labels. */
export type LabelEvent = {
  event_kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string | null;
};

export type CardWithLabels = Card & {
  labels: CardLabel[];
  deadline: CardDeadline | null;
};

export const ACTOR_LABELS: Record<string, string> = {
  client:     "Klien",
  principal:  "Prinsipal",
  pic:        "PIC",
  contractor: "Kontraktor",
  architect:  "Arsitek",
  vendor:     "Vendor",
};

/** Inline color tokens per label kind (CSS variables from globals). */
export const LABEL_STYLE: Record<CardLabelKind, { bg: string; fg: string }> = {
  blocked:        { bg: "var(--flag-high-bg)",    fg: "var(--flag-high)" },
  needs_decision: { bg: "var(--flag-warning-bg)", fg: "var(--flag-warning)" },
  awaiting:       { bg: "var(--flag-info-bg)",    fg: "var(--flag-info)" },
  pending:        { bg: "var(--sand-tint)",       fg: "var(--sand-dark)" },
  done:           { bg: "var(--flag-ok-bg)",      fg: "var(--flag-ok)" },
};

/**
 * Derive labels from the card's open loops. `events` should be the card's
 * decision / client_request / work events (any age — open loops don't
 * expire). Order: most actionable first. Max 3 chips.
 */
export function computeCardLabels(card: Card, events: LabelEvent[]): CardLabel[] {
  // Status labels are exclusive — closed/dormant cards don't need loop noise.
  if (card.status === "closed")  return [{ kind: "done",    label: "Selesai"  }];
  if (card.status === "dormant") return [{ kind: "pending", label: "Tertunda" }];

  const out: CardLabel[] = [];
  const byTime = [...events].sort((a, b) =>
    (a.occurred_at ?? "").localeCompare(b.occurred_at ?? ""));

  // 1. Blocked: the latest work event is a blocker (append-only log — a
  //    later work entry supersedes an older blocker).
  const lastWork = byTime.filter((e) => e.event_kind === "work").at(-1);
  if ((lastWork?.payload as { status?: string } | null)?.status === "blocked") {
    out.push({ kind: "blocked", label: "Terblokir" });
  }

  // 2. Open decision → needs a decision; if it names an actor, show whose
  //    ball it is.
  const openDecisions = byTime.filter(
    (e) =>
      e.event_kind === "decision" &&
      isDecisionOpen((e.payload ?? {}) as { status?: string; approved_by?: string }),
  );
  if (openDecisions.length > 0) {
    out.push({ kind: "needs_decision", label: "Butuh keputusan" });
    const awaiting = (openDecisions.at(-1)?.payload as { awaiting?: string } | null)?.awaiting;
    if (awaiting && ACTOR_LABELS[awaiting]) {
      out.push({ kind: "awaiting", label: `Menunggu ${ACTOR_LABELS[awaiting]}` });
    }
  }

  // 3. Open client request → waiting on the client (dedupe with #2).
  const hasOpenRequest = byTime.some(
    (e) =>
      e.event_kind === "client_request" &&
      isClientRequestOpen((e.payload ?? {}) as { status?: string }),
  );
  if (hasOpenRequest && !out.some((l) => l.label === "Menunggu Klien")) {
    out.push({ kind: "awaiting", label: "Menunggu Klien" });
  }

  return out.slice(0, 3);
}
```

**Note:** this imports `CardDeadline` from `@/lib/gates/board-deadlines`, created in this same task (Step 4) as a type-only stub; Task 8 adds its logic. This keeps `CardWithLabels` stable across both tasks.

- [ ] **Step 4: Create the board-deadlines module (types + function used by Task 8)**

Create `apps/web/lib/gates/board-deadlines.ts`:

```typescript
/**
 * Board-level deadline derivation. Mirrors getCardNextDeadline
 * (lib/gates/schedule.ts) but computes for ALL cards of a project in one
 * pass, so the board doesn't need a per-card round trip.
 */

export type DeadlineCell = {
  area_id: string;
  gate_code: string;
  status: string;
  target_start_date: string | null;
  target_end_date: string | null;
};

export type CardDeadline = {
  gateCode: string;
  targetEndDate: string; // YYYY-MM-DD
};

/**
 * For each card: among the unfinished (not_started/in_progress) scheduled
 * cells of its linked areas, pick the soonest window starting today or
 * later; if none upcoming, the earliest (i.e. overdue) window.
 * `todayIso` is a YYYY-MM-DD string.
 */
export function computeCardDeadlines(
  links: { card_id: string; area_id: string }[],
  cells: DeadlineCell[],
  todayIso: string,
): Map<string, CardDeadline> {
  const cellsByArea = new Map<string, DeadlineCell[]>();
  for (const c of cells) {
    if (!c.target_start_date || !c.target_end_date) continue;
    const arr = cellsByArea.get(c.area_id) ?? [];
    arr.push(c);
    cellsByArea.set(c.area_id, arr);
  }

  const areasByCard = new Map<string, string[]>();
  for (const l of links) {
    const arr = areasByCard.get(l.card_id) ?? [];
    arr.push(l.area_id);
    areasByCard.set(l.card_id, arr);
  }

  const out = new Map<string, CardDeadline>();
  for (const [cardId, areaIds] of areasByCard) {
    const cardCells = areaIds
      .flatMap((a) => cellsByArea.get(a) ?? [])
      .sort((a, b) => a.target_start_date!.localeCompare(b.target_start_date!));
    if (cardCells.length === 0) continue;
    const upcoming = cardCells.find((c) => c.target_start_date! >= todayIso) ?? cardCells[0]!;
    out.set(cardId, { gateCode: upcoming.gate_code, targetEndDate: upcoming.target_end_date! });
  }
  return out;
}
```

- [ ] **Step 5: Update `getBoardForProject`**

In `apps/web/lib/cards/queries.ts`:

Add the import:

```typescript
import { computeCardDeadlines, type DeadlineCell } from "@/lib/gates/board-deadlines";
import type { LabelEvent } from "@/lib/cards/labels";
```

Replace the body of `getBoardForProject` between the project lookup and the `columns` construction (i.e. remove `LABEL_LOOKBACK_DAYS`, `sinceIso`, the `recentEventsRes` query, and the `recentKindsByCard` grouping) with:

```typescript
  const [topicsRes, cardsRes, loopEventsRes] = await Promise.all([
    supabase
      .from("topics")
      .select("*")
      .eq("project_id", project.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("cards")
      .select("*")
      .eq("project_id", project.id)
      .order("last_event_at", { ascending: false, nullsFirst: false }),
    // Open-loop kinds only — labels derive from decision/request/work state,
    // and open loops don't expire, so no time window.
    supabase
      .from("card_events")
      .select("card_id, event_kind, payload, occurred_at")
      .eq("project_id", project.id)
      .in("event_kind", ["decision", "client_request", "work"]),
  ]);
  if (topicsRes.error) throw topicsRes.error;
  if (cardsRes.error) throw cardsRes.error;
  if (loopEventsRes.error) {
    console.warn("[getBoardForProject] loop events query failed — labels will be empty:", loopEventsRes.error.message);
  }

  const eventsByCard = new Map<string, LabelEvent[]>();
  for (const ev of loopEventsRes.data ?? []) {
    const arr = eventsByCard.get(ev.card_id) ?? [];
    arr.push({
      event_kind: ev.event_kind,
      payload: ev.payload as Record<string, unknown> | null,
      occurred_at: ev.occurred_at,
    });
    eventsByCard.set(ev.card_id, arr);
  }

  // Per-card next gate deadline (one pass for the whole board).
  const cardIds = (cardsRes.data ?? []).map((c) => c.id);
  let deadlines = new Map<string, ReturnType<typeof computeCardDeadlines> extends Map<string, infer V> ? V : never>();
  if (cardIds.length > 0) {
    const [linksRes, cellsRes] = await Promise.all([
      supabase.from("card_areas").select("card_id, area_id").in("card_id", cardIds),
      supabase
        .from("area_gate_status")
        .select("area_id, gate_code, status, target_start_date, target_end_date")
        .eq("project_id", project.id)
        .in("status", ["not_started", "in_progress"])
        .not("target_start_date", "is", null),
    ]);
    deadlines = computeCardDeadlines(
      linksRes.data ?? [],
      (cellsRes.data ?? []) as DeadlineCell[],
      new Date().toISOString().slice(0, 10),
    );
  }

  const cardsByTopic = new Map<string, CardWithLabels[]>();
  for (const c of cardsRes.data ?? []) {
    const labels = computeCardLabels(c, eventsByCard.get(c.id) ?? []);
    const withLabels: CardWithLabels = { ...c, labels, deadline: deadlines.get(c.id) ?? null };
    const arr = cardsByTopic.get(c.topic_id) ?? [];
    arr.push(withLabels);
    cardsByTopic.set(c.topic_id, arr);
  }
```

(If the `ReturnType` gymnastics on the `deadlines` declaration displeases the compiler, simply write `let deadlines = new Map<string, CardDeadline>();` and add `CardDeadline` to the board-deadlines import.)

- [ ] **Step 6: Fix the MiniCard chip key**

Two `awaiting` chips can coexist (decision awaiting vendor + open client request), so `key={l.kind}` collides. In `apps/web/components/board/MiniCard.tsx:14`, change:

```tsx
            <span
              key={`${l.kind}-${l.label}`}
```

- [ ] **Step 7: Update the fakeClient in cards-queries.test.ts**

In `apps/web/tests/unit/cards-queries.test.ts`, the fake builder needs the new chained methods. Replace the `chain` function with:

```typescript
  function chain(table: string): any {
    const data = map[table];
    const builder: any = {
      eq: () => builder,
      gte: () => builder,
      in: () => builder,
      not: () => builder,
      contains: () => builder,
      order: () => Promise.resolve({ data, error: null }),
      single: () => Promise.resolve({ data: (data as any)?.[0], error: null }),
      maybeSingle: () => Promise.resolve({ data: (data as any)?.[0] ?? null, error: null }),
      then: (cb: any) => cb({ data, error: null }),
    };
    return builder;
  }
```

And add a label-derivation test to the `getBoardForProject` describe block:

```typescript
  it("derives open-loop labels and a null deadline without area links", async () => {
    const supa = fakeClient({
      projects: [{ id: "p1", project_code: "BDG-H1", project_name: "BDG H1" }],
      topics: [{ id: "t1", project_id: "p1", code: "A09", name: "A09 — Detail Kamar Mandi", sort_order: 1 }],
      cards: [{ id: "c1", project_id: "p1", topic_id: "t1", title: "Master bathroom", slug: "master", status: "active" }],
      card_events: [
        { card_id: "c1", event_kind: "decision",
          payload: { topic: "marmer", status: "needs_decision", awaiting: "client" },
          occurred_at: "2026-06-01T00:00:00Z" },
      ],
    });
    const board = await getBoardForProject(supa, "bdg-h1");
    const card = board.columns[0]!.cards[0]!;
    expect(card.labels.map((l) => l.kind)).toEqual(["needs_decision", "awaiting"]);
    expect(card.labels[1]!.label).toBe("Menunggu Klien");
    expect(card.deadline).toBeNull();
  });
```

- [ ] **Step 8: Check E2E expectations for old chip strings**

Run: `grep -rn "Berisiko\b" apps/web/tests`
If any E2E test asserts the old chips (`Berisiko`), update the expectation to the new chips (`Butuh keputusan` / `Terblokir` / `Menunggu Klien`) matching the seeded data the test uses. (The "Berisiko tinggi" chip in EventRow is unrelated — leave it.)

- [ ] **Step 9: Run tests, typecheck, commit**

```bash
pnpm --filter web test && pnpm typecheck
git add apps/web/lib/cards/labels.ts apps/web/lib/gates/board-deadlines.ts apps/web/lib/cards/queries.ts apps/web/components/board/MiniCard.tsx apps/web/tests/unit/card-labels.test.ts apps/web/tests/unit/cards-queries.test.ts
git commit -m "feat(board): card labels v2 — derived from open loops (blocked / butuh keputusan / menunggu aktor)"
```

---

### Task 8: Deadline chips on board mini-cards

**Files:**
- Test: `apps/web/tests/unit/board-deadlines.test.ts` (create)
- Modify: `apps/web/components/board/MiniCard.tsx`

The computation (`computeCardDeadlines`) and plumbing already landed in Task 7; this task tests it and renders the chip.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/board-deadlines.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeCardDeadlines } from "@/lib/gates/board-deadlines";

const links = [{ card_id: "c1", area_id: "a1" }];

describe("computeCardDeadlines", () => {
  it("picks the soonest upcoming gate window", () => {
    const map = computeCardDeadlines(links, [
      { area_id: "a1", gate_code: "C", status: "not_started", target_start_date: "2026-07-01", target_end_date: "2026-07-14" },
      { area_id: "a1", gate_code: "B", status: "in_progress", target_start_date: "2026-06-15", target_end_date: "2026-06-30" },
    ], "2026-06-11");
    expect(map.get("c1")).toEqual({ gateCode: "B", targetEndDate: "2026-06-30" });
  });

  it("falls back to the earliest (overdue) window when none is upcoming", () => {
    const map = computeCardDeadlines(links, [
      { area_id: "a1", gate_code: "B", status: "in_progress", target_start_date: "2026-05-01", target_end_date: "2026-05-20" },
    ], "2026-06-11");
    expect(map.get("c1")).toEqual({ gateCode: "B", targetEndDate: "2026-05-20" });
  });

  it("skips cells without target dates and cards without links", () => {
    const map = computeCardDeadlines(
      [...links, { card_id: "c2", area_id: "a2" }],
      [{ area_id: "a1", gate_code: "B", status: "in_progress", target_start_date: null, target_end_date: null }],
      "2026-06-11",
    );
    expect(map.size).toBe(0);
  });

  it("considers all linked areas of a card", () => {
    const map = computeCardDeadlines(
      [{ card_id: "c1", area_id: "a1" }, { card_id: "c1", area_id: "a2" }],
      [
        { area_id: "a1", gate_code: "D", status: "not_started", target_start_date: "2026-08-01", target_end_date: "2026-08-20" },
        { area_id: "a2", gate_code: "C", status: "not_started", target_start_date: "2026-06-20", target_end_date: "2026-07-05" },
      ],
      "2026-06-11",
    );
    expect(map.get("c1")).toEqual({ gateCode: "C", targetEndDate: "2026-07-05" });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter web test -- tests/unit/board-deadlines.test.ts`
Expected: PASS immediately (function landed in Task 7 Step 4). If any case fails, fix `computeCardDeadlines` until green — the tests are the specification.

- [ ] **Step 3: Render the chip on MiniCard**

In `apps/web/components/board/MiniCard.tsx`:

Add the import:

```typescript
import type { CardDeadline } from "@/lib/gates/board-deadlines";
```

Inside the labels `<div className="mb-1 flex flex-wrap gap-1">` block, the chip row should render even when `labels` is empty but a deadline exists. Replace the conditional block (lines 11-24) with:

```tsx
      {card.labels.length > 0 || card.deadline ? (
        <div className="mb-1 flex flex-wrap gap-1">
          {card.labels.map((l) => (
            <span
              key={`${l.kind}-${l.label}`}
              className="inline-flex items-center rounded-sm px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[0.06em] leading-tight"
              style={{ background: LABEL_STYLE[l.kind].bg, color: LABEL_STYLE[l.kind].fg }}
              title={l.label}
            >
              {l.label}
            </span>
          ))}
          {card.deadline ? <DeadlineChip deadline={card.deadline} /> : null}
        </div>
      ) : null}
```

And add at the bottom of the file:

```tsx
/** Compact gate-deadline chip: "B lewat 3 hari" / "B hari ini" / "B · 12 hari". */
function DeadlineChip({ deadline }: { deadline: CardDeadline }) {
  const daysLeft = Math.floor(
    (new Date(deadline.targetEndDate).getTime() - Date.now()) / 86_400_000,
  );
  const overdue = daysLeft < 0;
  const urgent = !overdue && daysLeft <= 14;
  const style = overdue
    ? { background: "var(--flag-critical-bg)", color: "var(--flag-critical)" }
    : urgent
      ? { background: "var(--flag-warning-bg)", color: "var(--flag-warning)" }
      : { background: "var(--sand-tint)", color: "var(--sand-dark)" };
  const text = overdue
    ? `${deadline.gateCode} lewat ${-daysLeft} hari`
    : daysLeft === 0
      ? `${deadline.gateCode} hari ini`
      : `${deadline.gateCode} · ${daysLeft} hari`;
  return (
    <span
      className="inline-flex items-center rounded-sm px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[0.06em] leading-tight"
      style={style}
      title={`Target gate ${deadline.gateCode}: ${deadline.targetEndDate}`}
    >
      {text}
    </span>
  );
}
```

- [ ] **Step 4: Typecheck, run suite, commit**

```bash
pnpm typecheck && pnpm --filter web test
git add apps/web/tests/unit/board-deadlines.test.ts apps/web/components/board/MiniCard.tsx
git commit -m "feat(board): per-card gate deadline chip on mini-cards"
```

---

### Task 9: Label + overdue filters on the board

**Files:**
- Modify: `apps/web/components/board/BoardFilter.tsx`
- Modify: `apps/web/components/board/Board.tsx:14-36`

Labels that can't filter can't drive a workflow. Add a second chip row: *Butuh keputusan / Terblokir / Menunggu / Lewat target* (empty selection = no label filtering).

- [ ] **Step 1: Extend BoardFilter**

In `apps/web/components/board/BoardFilter.tsx`, add below the `StatusFilter` type:

```typescript
export type LabelFilterKind = "needs_decision" | "blocked" | "awaiting" | "overdue";
export type LabelFilter = Set<LabelFilterKind>;

const LABEL_FILTER_LABELS: Record<LabelFilterKind, string> = {
  needs_decision: "Butuh keputusan",
  blocked:        "Terblokir",
  awaiting:       "Menunggu",
  overdue:        "Lewat target",
};
```

Extend the component props:

```typescript
export function BoardFilter({
  query,
  onQueryChange,
  statuses,
  onStatusesChange,
  labelFilter,
  onLabelFilterChange,
  matched,
  total,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  statuses: StatusFilter;
  onStatusesChange: (s: StatusFilter) => void;
  labelFilter: LabelFilter;
  onLabelFilterChange: (s: LabelFilter) => void;
  matched: number;
  total: number;
}) {
```

Add a toggle helper next to the existing `toggle`:

```typescript
  function toggleLabel(k: LabelFilterKind) {
    const next = new Set(labelFilter);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onLabelFilterChange(next); // empty = "no label filtering"
  }
```

And after the status chips `</div>`, before the `ml-auto` counter span, insert:

```tsx
      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#7A6B56]">perlu</span>
      <div className="flex gap-1.5">
        {(Object.keys(LABEL_FILTER_LABELS) as LabelFilterKind[]).map((k) => {
          const on = labelFilter.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggleLabel(k)}
              aria-pressed={on}
              className={`chip${on ? " chip-on" : ""}`}
            >
              {LABEL_FILTER_LABELS[k]}
            </button>
          );
        })}
      </div>
```

- [ ] **Step 2: Apply the filter in Board.tsx**

In `apps/web/components/board/Board.tsx`:

Update the import:

```typescript
import { BoardFilter, type StatusFilter, type LabelFilter } from "./BoardFilter";
```

Add state next to `statuses`:

```typescript
  const [labelFilter, setLabelFilter] = useState<LabelFilter>(new Set());
```

Inside `filteredColumns`'s card predicate (after the status check, before the text check), add:

```typescript
        if (labelFilter.size > 0) {
          const overdueMatch =
            labelFilter.has("overdue") &&
            c.deadline != null &&
            new Date(c.deadline.targetEndDate).getTime() < Date.now();
          const labelMatch = c.labels.some(
            (l) => labelFilter.has(l.kind as "needs_decision" | "blocked" | "awaiting"),
          );
          if (!overdueMatch && !labelMatch) return false;
        }
```

Add `labelFilter` to the `useMemo` dependency array: `[board.columns, query, statuses, labelFilter]`.

Pass the new props to `<BoardFilter …>`:

```tsx
        labelFilter={labelFilter}
        onLabelFilterChange={setLabelFilter}
```

- [ ] **Step 3: Typecheck, manual check, commit**

Run `pnpm typecheck`, then `pnpm --filter web dev`: on the BDG-H1 board, toggling "Butuh keputusan" should hide cards without an open decision; combining with "Terblokir" shows the union.

```bash
git add apps/web/components/board/BoardFilter.tsx apps/web/components/board/Board.tsx
git commit -m "feat(board): filter cards by open-loop labels and overdue deadline"
```

---

## Phase 4 — Bottleneck intelligence in the morning brief

### Task 10: Pure bottleneck functions (cascade risk + expiring quotes)

**Files:**
- Create: `apps/web/lib/brief/bottlenecks.ts`
- Test: `apps/web/tests/unit/bottlenecks.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/bottlenecks.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { findCascadeRisks, findExpiringQuotes, type ScheduleCell, type QuoteEvent } from "@/lib/brief/bottlenecks";

function cell(areaId: string, gate: string, status: string, start: string | null, end: string | null): ScheduleCell {
  return {
    project_code: "BDG-H1", project_name: "BDG H1",
    area_id: areaId, area_name: `Area ${areaId}`,
    gate_code: gate, status,
    target_start_date: start, target_end_date: end,
  };
}

describe("findCascadeRisks", () => {
  it("flags a started gate whose predecessor is not ready", () => {
    const risks = findCascadeRisks([
      cell("a1", "B", "in_progress", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "not_started", "2026-06-05", "2026-06-20"),
    ], "2026-06-11");
    expect(risks).toHaveLength(1);
    expect(risks[0]!.gateCode).toBe("C");
    expect(risks[0]!.reason).toContain("Gate B");
  });

  it("does not flag when the predecessor is ready or passed or n/a", () => {
    for (const ok of ["ready_for_handoff", "passed", "not_applicable"]) {
      const risks = findCascadeRisks([
        cell("a1", "B", ok, "2026-05-01", "2026-06-01"),
        cell("a1", "C", "in_progress", "2026-06-05", "2026-06-20"),
      ], "2026-06-11");
      expect(risks).toHaveLength(0);
    }
  });

  it("does not flag windows that have not started, or n/a gates", () => {
    expect(findCascadeRisks([
      cell("a1", "B", "in_progress", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "not_started", "2026-07-01", "2026-07-20"),
    ], "2026-06-11")).toHaveLength(0);

    expect(findCascadeRisks([
      cell("a1", "B", "in_progress", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "not_applicable", "2026-06-05", "2026-06-20"),
    ], "2026-06-11")).toHaveLength(0);
  });

  it("evaluates areas independently", () => {
    const risks = findCascadeRisks([
      cell("a1", "B", "ready_for_handoff", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "in_progress", "2026-06-05", "2026-06-20"),
      cell("a2", "B", "blocked", "2026-05-01", "2026-06-01"),
      cell("a2", "C", "in_progress", "2026-06-05", "2026-06-20"),
    ], "2026-06-11");
    expect(risks).toHaveLength(1);
    expect(risks[0]!.areaName).toBe("Area a2");
  });
});

function quote(id: string, cardId: string, interaction: string, expiresAt?: string): QuoteEvent {
  return {
    id, card_id: cardId, occurred_at: "2026-06-01T00:00:00Z",
    payload: { vendor_name: "PT Galleria", interaction, expires_at: expiresAt },
  };
}

describe("findExpiringQuotes", () => {
  it("returns quotes expiring within the window (incl. already expired)", () => {
    const out = findExpiringQuotes([
      quote("q1", "c1", "quote", "2026-06-15"),
      quote("q2", "c2", "quote", "2026-06-09"),
      quote("q3", "c3", "quote", "2026-08-01"),
      quote("q4", "c4", "quote"), // no expiry → ignore
    ], "2026-06-11", 7);
    expect(out.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
  });

  it("ignores quotes on cards that already picked/contracted a vendor", () => {
    const out = findExpiringQuotes([
      quote("q1", "c1", "quote", "2026-06-15"),
      quote("p1", "c1", "pick"),
    ], "2026-06-11", 7);
    expect(out).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- tests/unit/bottlenecks.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `apps/web/lib/brief/bottlenecks.ts`:

```typescript
/**
 * Bottleneck detection — pure functions over schedule cells and vendor
 * events, so the rules are unit-testable without a database.
 */

export type ScheduleCell = {
  project_code: string;
  project_name: string;
  area_id: string;
  area_name: string;
  gate_code: string;
  status: string;
  target_start_date: string | null; // YYYY-MM-DD
  target_end_date: string | null;
};

export type GateRisk = {
  projectCode: string;
  areaName: string;
  gateCode: string;
  reason: string;
};

const GATE_ORDER = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
const SATISFIED = new Set(["passed", "ready_for_handoff", "not_applicable"]);

/**
 * Cascade rule: gate N's target window has started, but gate N-1 in the
 * same area is not yet satisfied → downstream slip risk.
 */
export function findCascadeRisks(cells: ScheduleCell[], todayIso: string): GateRisk[] {
  const byArea = new Map<string, ScheduleCell[]>();
  for (const c of cells) {
    const arr = byArea.get(c.area_id) ?? [];
    arr.push(c);
    byArea.set(c.area_id, arr);
  }

  const risks: GateRisk[] = [];
  for (const areaCells of byArea.values()) {
    const byGate = new Map(areaCells.map((c) => [c.gate_code, c]));
    for (let i = 1; i < GATE_ORDER.length; i++) {
      const cur = byGate.get(GATE_ORDER[i]!);
      const prev = byGate.get(GATE_ORDER[i - 1]!);
      if (!cur || !prev) continue;
      if (cur.status === "not_applicable") continue;
      const windowStarted = cur.target_start_date != null && cur.target_start_date <= todayIso;
      if (windowStarted && !SATISFIED.has(prev.status)) {
        risks.push({
          projectCode: cur.project_code,
          areaName: cur.area_name,
          gateCode: cur.gate_code,
          reason: `Gate ${cur.gate_code} sudah masuk jadwal, tapi Gate ${prev.gate_code} belum siap (${prev.status})`,
        });
      }
    }
  }
  return risks;
}

export type QuoteEvent = {
  id: string;
  card_id: string;
  occurred_at: string | null;
  payload: { vendor_name?: string; expires_at?: string; interaction?: string };
};

/**
 * Quotes expiring within `windowDays` (or already expired) on cards where
 * no vendor has been picked/contracted yet.
 */
export function findExpiringQuotes(
  vendorEvents: QuoteEvent[],
  todayIso: string,
  windowDays = 7,
): QuoteEvent[] {
  const horizon = new Date(new Date(todayIso).getTime() + windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const decidedCards = new Set(
    vendorEvents
      .filter((e) => e.payload.interaction === "pick" || e.payload.interaction === "contract")
      .map((e) => e.card_id),
  );
  return vendorEvents.filter(
    (e) =>
      e.payload.interaction === "quote" &&
      typeof e.payload.expires_at === "string" &&
      e.payload.expires_at <= horizon &&
      !decidedCards.has(e.card_id),
  );
}
```

- [ ] **Step 4: Run tests, commit**

```bash
pnpm --filter web test -- tests/unit/bottlenecks.test.ts
git add apps/web/lib/brief/bottlenecks.ts apps/web/tests/unit/bottlenecks.test.ts
git commit -m "feat(brief): cascade-risk and expiring-quote bottleneck rules"
```

---

### Task 11: Morning brief v2 — re-point dead queries, add decision/bottleneck sections

**Files:**
- Modify: `apps/web/lib/brief/queries.ts`
- Modify: `apps/web/app/(app)/brief/page.tsx`

Replaces the two permanently-empty sections (`event_kind='pending'`, `event_kind='defect'`) and adds the sections the principal actually asked for: decisions needed (by actor), gates at risk, expiring quotes.

- [ ] **Step 1: Rewrite the brief queries**

In `apps/web/lib/brief/queries.ts`:

Add imports at the top:

```typescript
import { findCascadeRisks, findExpiringQuotes, type GateRisk, type ScheduleCell, type QuoteEvent } from "@/lib/brief/bottlenecks";
import { ACTOR_LABELS } from "@/lib/cards/labels";
```

Replace the `BriefData` type with:

```typescript
export type BriefData = {
  pendingDrafts:   { count: number; items: BriefItem[] };
  blockers:        { count: number; items: BriefItem[] };
  defects:         { count: number; items: BriefItem[] };
  decisionsNeeded: { count: number; items: BriefItem[] };
  awaitingClient:  { count: number; items: BriefItem[] };
  expiringQuotes:  { count: number; items: BriefItem[] };
  gateRisks:       GateRisk[];
  staleByProject:  { projectCode: string; projectName: string; staleCount: number }[];
};
```

Keep section 1 (pendingDrafts) as-is. Replace section 2 (openPendings) with:

```typescript
  // 2. Live blockers: work events with status=blocked not superseded by a
  //    later non-blocked work event on the same card (append-only log).
  const { data: blockedRaw } = await supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at, card_id,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `)
    .eq("event_kind", "work")
    .contains("payload", { status: "blocked" })
    .order("occurred_at", { ascending: true })
    .limit(100);

  const blockedCardIds = [...new Set((blockedRaw ?? []).map((e) => e.card_id))];
  const lastNonBlockedByCard = new Map<string, string>();
  if (blockedCardIds.length > 0) {
    const { data: workEvs } = await supabase
      .from("card_events")
      .select("card_id, occurred_at, payload")
      .eq("event_kind", "work")
      .in("card_id", blockedCardIds);
    for (const w of workEvs ?? []) {
      const status = (w.payload as { status?: string } | null)?.status;
      if (status === "blocked") continue;
      const prev = lastNonBlockedByCard.get(w.card_id) ?? "";
      if ((w.occurred_at ?? "") > prev) lastNonBlockedByCard.set(w.card_id, w.occurred_at ?? "");
    }
  }
  const liveBlockers = (blockedRaw ?? []).filter((e) => {
    const cleared = lastNonBlockedByCard.get(e.card_id);
    return !cleared || cleared < (e.occurred_at ?? "");
  });

  const blockers = {
    count: liveBlockers.length,
    items: liveBlockers.slice(0, TOP_N).map((e) => {
      const c = (e as { cards: CardRef | null }).cards;
      const p = e.payload as { blocked_on?: string; description?: string };
      return {
        id: `blk_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: p.blocked_on ?? p.description ?? "",
        meta: ageMeta(e.occurred_at ?? ""),
      };
    }),
  };
```

Replace section 3 (defects) — same shape as before but with the new predicate:

```typescript
  // 3. Defects (last 30 days): work events flagged issue=defect
  const thirtyAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: defectEvs, count: defectCount } = await supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `, { count: "exact" })
    .eq("event_kind", "work")
    .contains("payload", { issue: "defect" })
    .gte("occurred_at", thirtyAgo)
    .order("occurred_at", { ascending: false })
    .limit(TOP_N);
```

(keep the existing `defects` item-mapping block unchanged — `severity`/`description` still live in the payload).

Replace section 4 (awaitingClient) — drop the 60-day heuristic, use real status:

```typescript
  // 4. Awaiting client: client_request events still open
  const { data: crEvs, count: crCount } = await supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `, { count: "exact" })
    .eq("event_kind", "client_request")
    .contains("payload", { status: "open" })
    .order("occurred_at", { ascending: true })
    .limit(TOP_N);
```

(keep the existing item-mapping block).

After section 4, add the three new sections:

```typescript
  // 5. Decisions needed — the core coordination list, grouped by actor in meta
  const { data: decEvs, count: decCount } = await supabase
    .from("card_events")
    .select(`
      id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `, { count: "exact" })
    .eq("event_kind", "decision")
    .contains("payload", { status: "needs_decision" })
    .order("occurred_at", { ascending: true })
    .limit(TOP_N);

  const decisionsNeeded = {
    count: decCount ?? 0,
    items: (decEvs ?? []).map((e) => {
      const c = (e as { cards: CardRef | null }).cards;
      const p = e.payload as { topic?: string; proposed_spec?: string; awaiting?: string };
      const actor = p.awaiting ? ACTOR_LABELS[p.awaiting] ?? p.awaiting : null;
      return {
        id: `dec_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: `${p.topic ?? ""}${p.proposed_spec ? ` — ${p.proposed_spec}` : ""}`,
        meta: `${ageMeta(e.occurred_at ?? "")}${actor ? ` · menunggu ${actor}` : ""}`,
      };
    }),
  };

  // 6. Expiring vendor quotes (cost-visible staff only — RLS hides these
  //    events from everyone else, so the section degrades to empty).
  const { data: vendorEvs } = await supabase
    .from("card_events")
    .select(`
      id, card_id, payload, occurred_at,
      cards:card_id (id, slug, title, projects:project_id (project_code, project_name))
    `)
    .eq("event_kind", "vendor")
    .limit(500);

  const todayIso = new Date().toISOString().slice(0, 10);
  const expiring = findExpiringQuotes((vendorEvs ?? []) as unknown as QuoteEvent[], todayIso);
  const expiringQuotes = {
    count: expiring.length,
    items: expiring.slice(0, TOP_N).map((e) => {
      const c = ((e as unknown) as { cards: CardRef | null }).cards;
      return {
        id: `quo_${e.id}`,
        projectCode: c?.projects?.project_code ?? "?",
        cardTitle: c?.title ?? "(kartu)",
        cardHref: c ? `/project/${c.projects?.project_code}/cards/${c.slug}` : "#",
        detail: `${e.payload.vendor_name ?? "vendor"} — berlaku sampai ${e.payload.expires_at}`,
        meta: ageMeta(e.occurred_at ?? ""),
      };
    }),
  };

  // 7. Gates at cascade risk: window started but predecessor gate not ready
  const { data: cellRows } = await supabase
    .from("area_gate_status")
    .select(`
      area_id, gate_code, status, target_start_date, target_end_date,
      areas:area_id (room_name),
      projects:project_id (project_code, project_name)
    `)
    .not("target_start_date", "is", null);

  const scheduleCells: ScheduleCell[] = (cellRows ?? []).map((r) => {
    const area = (r as { areas: { room_name: string } | null }).areas;
    const proj = (r as { projects: { project_code: string; project_name: string } | null }).projects;
    return {
      project_code: proj?.project_code ?? "?",
      project_name: proj?.project_name ?? "?",
      area_id: r.area_id,
      area_name: area?.room_name ?? r.area_id,
      gate_code: r.gate_code,
      status: r.status,
      target_start_date: r.target_start_date,
      target_end_date: r.target_end_date,
    };
  });
  const gateRisks = findCascadeRisks(scheduleCells, todayIso);
```

Update the return statement:

```typescript
  return { pendingDrafts, blockers, defects, decisionsNeeded, awaitingClient, expiringQuotes, gateRisks, staleByProject };
```

(Delete the now-unused `openPendings` block entirely.)

- [ ] **Step 2: Update the brief page**

In `apps/web/app/(app)/brief/page.tsx`:

Update the header description (line 16-18):

```tsx
        <p className="mt-1 text-sm text-[#524E49]">
          Ringkasan lintas-proyek: keputusan yang dibutuhkan, pekerjaan terblokir, defect, permintaan klien, quote kedaluwarsa, dan gate berisiko.
        </p>
```

Replace the "Pending unresolved" `<BriefSection>` with two sections (decisions first — it's the principal's primary list):

```tsx
        <BriefSection
          title="Keputusan dibutuhkan"
          emoji="⚖️"
          count={brief.decisionsNeeded.count}
          items={brief.decisionsNeeded.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[#524E49]">Tidak ada keputusan yang menunggu.</p>
              <p className="mt-1 text-[10px] text-[#847E78]">
                Keputusan terbuka (status: butuh keputusan) muncul di sini, dengan siapa yang ditunggu.
              </p>
            </>
          }
        />
        <BriefSection
          title="Pekerjaan terblokir"
          emoji="⏳"
          count={brief.blockers.count}
          items={brief.blockers.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[#524E49]">Tidak ada pekerjaan terblokir.</p>
              <p className="mt-1 text-[10px] text-[#847E78]">
                Catat pekerjaan dengan status &ldquo;terblokir&rdquo; + alasannya agar muncul di sini.
              </p>
            </>
          }
        />
```

Update the defects section's empty message hint (the query changed):

```tsx
              <p className="mt-1 text-[10px] text-[#847E78]">
                Catat pekerjaan dengan jenis isu &ldquo;defect&rdquo; + severity agar muncul di sini.
              </p>
```

After the "Permintaan klien" section, add:

```tsx
        <BriefSection
          title="Quote akan kedaluwarsa"
          emoji="💸"
          count={brief.expiringQuotes.count}
          items={brief.expiringQuotes.items}
          emptyMessage={
            <>
              <p className="text-xs italic text-[#524E49]">Tidak ada quote yang akan kedaluwarsa.</p>
              <p className="mt-1 text-[10px] text-[#847E78]">
                Quote vendor dengan tanggal berlaku, yang belum dipilih vendornya, muncul 7 hari sebelum habis.
              </p>
            </>
          }
        />
```

Before the existing "Readiness perlu di-recompute" section, add the gate-risk section:

```tsx
      <section className="mt-6 rounded border border-[#B5AFA8] bg-[#FDFAF6] p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#141210]">
          ⛓️ Gate berisiko (cascade)
        </h2>
        {brief.gateRisks.length === 0 ? (
          <p className="text-xs italic text-[#847E78]">Tidak ada gate yang berisiko terlambat berantai.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {brief.gateRisks.slice(0, 12).map((r) => (
              <li key={`${r.projectCode}-${r.areaName}-${r.gateCode}`}>
                <Link
                  href={`/project/${r.projectCode}/schedule`}
                  className="block rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs hover:border-[var(--sand-dark)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#141210]">{r.projectCode} · {r.areaName}</span>
                    <span className="rounded bg-[var(--flag-warning-bg)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--flag-warning)]">
                      Gate {r.gateCode}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[#524E49]">{r.reason}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
```

- [ ] **Step 3: Typecheck, run suite**

Run: `pnpm typecheck && pnpm --filter web test`
Expected: clean.

- [ ] **Step 4: Manual smoke check**

`pnpm --filter web dev` → open `/brief` as Wilson. All sections render; "Pekerjaan terblokir" shows the rescued legacy blockers (from Task 4's note→work conversion); "Keputusan dibutuhkan" lists open decisions. Click through one item of each section to confirm the links resolve.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/brief/queries.ts "apps/web/app/(app)/brief/page.tsx"
git commit -m "feat(brief): decisions-needed, live blockers, defects, expiring quotes, cascade gate risks

Replaces the two dead sections that queried retired event kinds."
```

---

### Task 12: Full verification + recompute pass

- [ ] **Step 1: Full suite**

```bash
pnpm typecheck
pnpm test
```

Expected: all packages typecheck; all unit tests pass.

- [ ] **Step 2: E2E (if environment available)**

```bash
pnpm --filter web test:e2e
```

Expected: PASS. If any board/brief assertion fails on the new chip strings, fix the expectation (new vocabulary: "Butuh keputusan", "Terblokir", "Menunggu Klien", "Keputusan dibutuhkan", "Pekerjaan terblokir").

- [ ] **Step 3: Recompute readiness against the live data**

`pnpm --filter web dev` → open each pilot project's `/project/[code]/schedule` page and trigger the "recompute" action (it calls `recomputeAreaGateStatus`, now on rule version 2). Verify cells move out of permanent `in_progress`: areas whose latest work is blocked show **Terblokir** with a reason; finished areas show **Siap handoff**.

- [ ] **Step 4: Final commit (if any stragglers) and summary**

```bash
git status   # should be clean; commit any leftover test-expectation fixes
```

Report to the user: rule version bumped 1→2, sections restored, what the new chips mean, and that staff should start setting `awaiting` on decisions and `blocked_on` on blocked work to feed the actor labels.

---

## Out of scope (explicitly deferred)

- **AI assistant capture prompts** teaching the model to fill `awaiting`/`blocked_on`/`issue` on proposed events — worth doing once the fields prove out; touchpoint is `apps/web/lib/assistant/` + `app/api/assistant/message/route.ts`.
- **WhatsApp outbound reminders** for aging open decisions — Slice 1.3+ per the blueprint.
- **`card_links` (depends_on/blocks) cross-card bottlenecks** — schema exists; revisit after cascade risks prove useful.
- **Dropping retired enum values from the DB** — Postgres can't safely drop enum values; the drift guard in `apps/web/lib/cards/event-kind-drift.ts` already documents them.
