# Readiness Escalation Ladder + Push Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escalate readiness reminders to supervision (`high`) then principal (`critical`) as a step's silence worsens, switch to the real `readiness_reminder` notification kind, and fan out Expo push for each new reminder.

**Architecture:** A pure `escalateRecipients(severity, base, members, project)` widens the recipient set by signal severity; `buildReadinessReminders` wraps `resolveRecipients` with it. The placeholder kind becomes `readiness_reminder` (already a DB enum value). The cron calls the existing `sendExpoPush` for each newly-inserted (non-deduped) intent.

**Tech Stack:** Next.js 16 API route (cron), Supabase, `@datum/core`, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-27-readiness-escalation-design.md`

## Global Constraints

- **Escalation is additive by severity:** `info`/`warning` → base; `high` → + `{site_supervisor, pic}` members + `project.pic_id`; `critical` → + that tier + `principal` members + `project.principal_id`. De-dupe by staff id, first-seen order, drop null/empty.
- **Push is best-effort and inside the insert branch only** — `sendExpoPush` never throws / no-ops without tokens; push once per *new* (non-deduped) intent.
- No schema change — the `readiness_reminder` enum value is already migrated (`20260623000002`); only the stale committed types need it.
- **Verify per task:** pure logic → vitest TDD (extend `apps/web/tests/unit/readiness-reminders.test.ts`); `pnpm -C apps/web typecheck`; root `pnpm typecheck` + `pnpm test` (turbo, all workspaces) before push.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/steps/reminders.ts` | add `escalateRecipients`; wrap recipients in `buildReadinessReminders`; flip `READINESS_REMINDER_KIND` |
| `apps/web/tests/unit/readiness-reminders.test.ts` | tests for `escalateRecipients` + escalated `buildReadinessReminders` |
| `packages/db/src/types.generated.ts` | add `readiness_reminder` to the `notification_kind` enum (type union + const array) |
| `apps/web/app/api/cron/readiness-reminders/route.ts` | `sendExpoPush` per inserted intent |

---

## Task 1: Escalation ladder (pure) + wire into the builder

**Files:**
- Modify: `apps/web/lib/steps/reminders.ts`
- Modify: `apps/web/tests/unit/readiness-reminders.test.ts`

**Interfaces:**
- Consumes — `StepSignalSeverity` (`@/lib/steps/signals`), existing `ProjectMember`/`ActiveProject`/`resolveRecipients`.
- Produces — `escalateRecipients(severity, base, members, project): string[]`; `buildReadinessReminders` now widens recipients by each signal's severity.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/tests/unit/readiness-reminders.test.ts` (import `escalateRecipients` alongside the existing imports):
```ts
import { escalateRecipients } from "@/lib/steps/reminders";

describe("escalateRecipients", () => {
  const members = [
    { staff_id: "trade1", role_on_project: "x", staff_role: "site_supervisor" },
    { staff_id: "pic1", role_on_project: "x", staff_role: "pic" },
    { staff_id: "prin1", role_on_project: "x", staff_role: "principal" },
  ];
  const project = { principal_id: "prinP", pic_id: "picP" };

  it("info/warning → base unchanged", () => {
    expect(escalateRecipients("info", ["base1"], members, project)).toEqual(["base1"]);
    expect(escalateRecipients("warning", ["base1"], members, project)).toEqual(["base1"]);
  });
  it("high → base + supervision tier (site_supervisor, pic) + project.pic_id, deduped", () => {
    expect(escalateRecipients("high", ["trade1"], members, project)).toEqual(["trade1", "pic1", "picP"]);
  });
  it("critical → also principal members + project.principal_id", () => {
    expect(escalateRecipients("critical", ["base1"], members, project)).toEqual(["base1", "trade1", "pic1", "picP", "prin1", "prinP"]);
  });
  it("skips null project ids", () => {
    expect(escalateRecipients("critical", ["b"], [], { principal_id: null, pic_id: null })).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm -C apps/web test -- readiness-reminders`
Expected: FAIL — `escalateRecipients` not exported.

- [ ] **Step 3: Implement + wire**

In `apps/web/lib/steps/reminders.ts`:

(a) Add the import near the top:
```ts
import type { StepSignalSeverity } from "@/lib/steps/signals";
```

(b) Add the pure function (after `resolveRecipients`):
```ts
/**
 * Widen the recipient set by signal severity (escalation ladder):
 *  - info/warning: base only
 *  - high:     + supervision tier (site_supervisor, pic) + project.pic_id
 *  - critical: + that tier + principals + project.principal_id
 * De-dupes by staff id (first-seen order), drops null/empty.
 */
export function escalateRecipients(
  severity: StepSignalSeverity,
  base: string[],
  members: ProjectMember[],
  project: Pick<ActiveProject, "principal_id" | "pic_id">,
): string[] {
  const out = [...base];
  const add = (ids: (string | null | undefined)[]) => {
    for (const id of ids) if (id && !out.includes(id)) out.push(id);
  };
  if (severity === "high" || severity === "critical") {
    add(members.filter((m) => m.staff_role === "site_supervisor" || m.staff_role === "pic").map((m) => m.staff_id));
    add([project.pic_id]);
  }
  if (severity === "critical") {
    add(members.filter((m) => m.staff_role === "principal").map((m) => m.staff_id));
    add([project.principal_id]);
  }
  return out;
}
```

(c) In `buildReadinessReminders`, change the recipient resolution inside the signal loop from:
```ts
      const recipients = resolveRecipients(row.tradeRole, members, project);
```
to:
```ts
      const base = resolveRecipients(row.tradeRole, members, project);
      const recipients = escalateRecipients(row.signal.severity, base, members, project);
```

- [ ] **Step 4: Run → PASS, typecheck, commit**

Run: `pnpm -C apps/web test -- readiness-reminders` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/steps/reminders.ts apps/web/tests/unit/readiness-reminders.test.ts
git commit -m "feat(reminders): severity escalation ladder (supervision → principal)"
```

---

## Task 2: Real `readiness_reminder` notification kind

**Files:**
- Modify: `apps/web/lib/steps/reminders.ts`
- Modify: `packages/db/src/types.generated.ts`

**Interfaces:**
- Produces — `READINESS_REMINDER_KIND === "readiness_reminder"`; `notification_kind` type/const include it.

- [ ] **Step 1: Add the enum value to the generated types**

In `packages/db/src/types.generated.ts`, add `"readiness_reminder"` to the `notification_kind` enum in BOTH places (the value already exists in the DB via `20260623000002` — this only unsticks the stale committed types):
- The **type union** under `Database["public"]["Enums"]`: find `notification_kind:` followed by the `"mention" | "watcher_event" | …` union and append `| "readiness_reminder"`.
- The **const array** under `Constants` / `Enums`: find `notification_kind: [ "mention", … ]` and append `"readiness_reminder",`.

- [ ] **Step 2: Flip the constant**

In `apps/web/lib/steps/reminders.ts`:
```ts
export const READINESS_REMINDER_KIND = "readiness_reminder" as const;
```
(Update the doc-comment above it that says it reuses `watcher_event` — it now uses the dedicated kind.)

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C packages/db typecheck` → PASS.
> If the existing `readiness-reminders.test.ts` asserts `kind === "watcher_event"`, update those assertions to `"readiness_reminder"`. Run `pnpm -C apps/web test -- readiness-reminders` → PASS.
```bash
git add apps/web/lib/steps/reminders.ts packages/db/src/types.generated.ts apps/web/tests/unit/readiness-reminders.test.ts
git commit -m "feat(reminders): use the dedicated readiness_reminder notification kind"
```

---

## Task 3: Push delivery in the cron

**Files:**
- Modify: `apps/web/app/api/cron/readiness-reminders/route.ts`

**Interfaces:**
- Consumes — `sendExpoPush` (`@/lib/notifications/push-send`); the `ReminderIntent` (`message`, `link`, `recipientStaffId`).

- [ ] **Step 1: Wire push into the insert branch**

In `app/api/cron/readiness-reminders/route.ts`:

(a) Import:
```ts
import { sendExpoPush } from "@/lib/notifications/push-send";
```
(b) Inside the per-intent loop, **after** a successful `notifications` INSERT (the branch that runs only when dedup did NOT skip and `insertErr` is falsy), add:
```ts
        await sendExpoPush([intent.recipientStaffId], {
          title: "Pengingat kesiapan",
          body: intent.message,
          data: { link: intent.link },
        });
```
Place it after the `if (insertErr) { … }` handling, in the success path (so deduped/ skipped intents do NOT push). `sendExpoPush` never throws and no-ops without tokens.

- [ ] **Step 2: Test push is called once per inserted intent, not for deduped**

In `apps/web/tests/unit/readiness-reminders.test.ts` (or the cron's own test if one exists — check `apps/web/app/api/cron/readiness-reminders/` for a colocated test first), add a test that mocks `sendExpoPush` and asserts it is called for an inserted intent and not for a deduped one. If the cron route has no existing unit test (it may be integration-only), instead add a focused assertion where feasible and note in the report that cron push is covered by the existing route test or manual trigger. Use `vi.mock("@/lib/notifications/push-send", () => ({ sendExpoPush: vi.fn() }))`.

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add "apps/web/app/api/cron/readiness-reminders/route.ts" apps/web/tests/unit/readiness-reminders.test.ts
git commit -m "feat(reminders): fan out Expo push for each new readiness reminder"
```

---

## Task 4: Verification (controller-run)

> Controller-run; the cron runs on its 08:00 WIB schedule on prod (Vercel cron). No prod DB schema change needed (enum already applied).

- [ ] Confirm the cron route still returns 200 and inserts `readiness_reminder` notifications (vs `watcher_event`) — check a recent run or trigger manually.
- [ ] Confirm a `critical` signal produced notifications for base + supervision + principal recipients (inspect `notifications` rows for a project with a long-silent step, or via the unit tests).
- [ ] Confirm push tokens registered for a recipient receive a push when a new reminder is inserted (device check) — best-effort; no-op if no tokens.
- [ ] No console/server errors in the cron logs.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 escalation → Task 1; §2 kind → Task 2; §3 push → Task 3; §4 testing → Tasks 1/3 (pure + cron) + Task 4 (verify).
- **Type consistency:** `escalateRecipients` signature (Task 1) matches the spec; `StepSignalSeverity` import from `signals.ts` (confirmed export); `ProjectMember`/`ActiveProject` reused from `reminders.ts`; `READINESS_REMINDER_KIND` literal change (Task 2) flows to the cron insert + dedup (kind matching).
- **Grounded:** `sendExpoPush(staffIds, {title,body,data?})` signature confirmed; `notification_kind` enum stale in committed types but `20260623000002` migration present; existing tests `readiness-reminders.test.ts`.
- **Verify-during-impl:** the exact insert-success branch in the cron route (Task 3 Step 1b — read the route); whether a colocated cron test exists (Task 3 Step 2); update any `watcher_event` assertions in the existing test (Task 2 Step 3).
