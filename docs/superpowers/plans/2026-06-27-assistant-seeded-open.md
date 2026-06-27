# Schedule-Aware Assistant — Seeded Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Tanya asisten" open the (already schedule-aware) assistant pre-seeded with the room's prompt, via a sessionStorage handoff to ChatDock on the board page — replacing the clipboard fallback.

**Architecture:** A tiny `lib/assistant/seed.ts` (sessionStorage set/take, one-shot, SSR-guarded). `RoomAssistantButton` writes the seed and navigates to the board; `ChatDock` reads + consumes it on mount, opens, and `send`s it (flowing through the existing schedule-aware retrieval). No change to the assistant brain/API.

**Tech Stack:** Next.js 16 App Router, React client components, vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-27-assistant-seeded-open-design.md`

## Global Constraints

- **Additive only** — do NOT restructure ChatDock's internal state/queue; add exactly one mount `useEffect`. The seed is one-shot (consumed on read) so a refresh doesn't re-send.
- SSR/no-storage safe: `seed.ts` guards `typeof window === "undefined"` + `try/catch`; degradation = navigate without a seed.
- Conventions: `"use client"`, CSS-var Tailwind, Bahasa unchanged. Server actions n/a (no DB).
- **Verify per task:** pure module → vitest TDD; `pnpm -C apps/web typecheck`; `pnpm -C apps/web build` for the ChatDock/page changes. (This is a UI-behavior change — browser verification is the user's, post-merge.)

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/lib/assistant/seed.ts` | `setAssistantSeed` / `takeAssistantSeed` (sessionStorage, one-shot, guarded) |
| `apps/web/tests/unit/assistant-seed.test.ts` | unit tests with a sessionStorage mock |
| `apps/web/components/chat/ChatDock.tsx` | mount `useEffect` consumes the seed → open + send |
| `apps/web/components/rooms/RoomAssistantButton.tsx` | write seed + navigate to board (gains `projectCode`) |
| `apps/web/components/rooms/RoomRow.tsx` + `RoomsView.tsx` + rooms `page.tsx` | thread `projectCode` to the button |

---

## Task 1: Seed module (TDD)

**Files:**
- Create: `apps/web/lib/assistant/seed.ts`
- Test: `apps/web/tests/unit/assistant-seed.test.ts`

**Interfaces:**
- Produces — `setAssistantSeed(prompt: string): void`; `takeAssistantSeed(): string | null`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/unit/assistant-seed.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAssistantSeed, takeAssistantSeed } from "@/lib/assistant/seed";

describe("assistant seed", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("set then take round-trips", () => {
    setAssistantSeed("halo");
    expect(takeAssistantSeed()).toBe("halo");
  });
  it("take is one-shot (second call is null)", () => {
    setAssistantSeed("x");
    expect(takeAssistantSeed()).toBe("x");
    expect(takeAssistantSeed()).toBeNull();
  });
  it("take returns null when nothing set", () => {
    expect(takeAssistantSeed()).toBeNull();
  });
  it("does not throw if storage throws", () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} });
    expect(() => setAssistantSeed("x")).not.toThrow();
    expect(takeAssistantSeed()).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `pnpm -C apps/web test -- assistant-seed`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/assistant/seed.ts`:
```ts
const KEY = "datum_assistant_seed";

/** Stash a prompt for ChatDock to pick up after navigation. SSR/no-storage safe. */
export function setAssistantSeed(prompt: string): void {
  if (typeof window === "undefined") return;
  try { window.sessionStorage.setItem(KEY, prompt); } catch { /* storage disabled — degrade to no seed */ }
}

/** Read and clear the seed (one-shot). Returns null if absent or storage unavailable. */
export function takeAssistantSeed(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v !== null) window.sessionStorage.removeItem(KEY);
    return v;
  } catch { return null; }
}
```

- [ ] **Step 4: Run → PASS, typecheck, commit**

Run: `pnpm -C apps/web test -- assistant-seed` → PASS; `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/lib/assistant/seed.ts apps/web/tests/unit/assistant-seed.test.ts
git commit -m "feat(assistant): one-shot sessionStorage seed (set/take)"
```

---

## Task 2: ChatDock consumes the seed on mount

**Files:**
- Modify: `apps/web/components/chat/ChatDock.tsx`

**Interfaces:**
- Consumes — `takeAssistantSeed` (Task 1); ChatDock's existing `send(input, file)` + `setMobileOpen`.

- [ ] **Step 1: Add the mount effect**

In `ChatDock.tsx`: import `takeAssistantSeed` from `@/lib/assistant/seed`. After the `send` function is defined (so it's in scope), add a one-time mount effect:
```tsx
  useEffect(() => {
    const seed = takeAssistantSeed();
    if (seed) {
      setMobileOpen(true);
      void send(seed, null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```
Place it after the existing hydration/queue effects. Do NOT alter any existing state or the offline queue. (`send` and `setMobileOpen` already exist in the component.)

- [ ] **Step 2: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add apps/web/components/chat/ChatDock.tsx
git commit -m "feat(assistant): ChatDock opens + sends a seeded prompt on mount"
```

---

## Task 3: Button writes seed + navigates; thread projectCode

**Files:**
- Modify: `apps/web/components/rooms/RoomAssistantButton.tsx`
- Modify: `apps/web/components/rooms/RoomRow.tsx`, `apps/web/components/rooms/RoomsView.tsx`, `apps/web/app/(app)/project/[slug]/rooms/page.tsx`

**Interfaces:**
- Consumes — `setAssistantSeed` (Task 1); `useRouter`.
- Produces — `<RoomAssistantButton areaName view projectCode />`.

- [ ] **Step 1: Update the button**

In `RoomAssistantButton.tsx`: add `projectCode: string` to props; import `useRouter` (`next/navigation`) + `setAssistantSeed`. Replace the clipboard line in `open()` with:
```tsx
    setAssistantSeed(prompt);
    router.push(`/project/${projectCode}`);
```
(Keep `buildPrompt` unchanged. Remove the now-unused clipboard fallback + its comment.)

- [ ] **Step 2: Thread projectCode to the button**

Read `rooms/page.tsx`, `RoomsView.tsx`, `RoomRow.tsx` to find the existing prop flow. The rooms page already has the project (slug / `data`). Pass `projectCode` (the uppercase project code used in `/project/{code}` links — confirm the exact field; the schedule/board links use `project.project_code`) from the page → `RoomsView` → `RoomRow` → `<RoomAssistantButton … projectCode={…} />`. Match the existing prop-threading style (e.g. how `stepViews` is already threaded).

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add apps/web/components/rooms/RoomAssistantButton.tsx apps/web/components/rooms/RoomRow.tsx apps/web/components/rooms/RoomsView.tsx "apps/web/app/(app)/project/[slug]/rooms/page.tsx"
git commit -m "feat(rooms): Tanya asisten seeds the assistant + navigates to the board"
```

---

## Task 4: Verification (controller-run, browser)

> UI behavior — browser-verify on prod (post-merge).

- [ ] On the rooms page, expand a room, click "Tanya asisten" → navigates to the project board, the assistant dock opens, and the seeded question is sent + answered (the answer reflects schedule context via retrieval).
- [ ] Refreshing the board page does NOT re-send the seed (one-shot consumed).
- [ ] Private-mode / storage-disabled: the button still navigates (no crash), assistant opens without a seed.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 seed module → Task 1; §2 button → Task 3; §3 ChatDock → Task 2; §4 scope/verification → Task 4.
- **Type consistency:** `setAssistantSeed`/`takeAssistantSeed` (Task 1) consumed in Tasks 2/3; `projectCode` prop added (Task 3) and threaded.
- **Risk:** ChatDock change is one additive mount effect — explicitly no restructuring. The seed is one-shot.
- **Verify-during-impl:** exact `send`/`setMobileOpen` scope in ChatDock (Task 2 — place the effect after `send` is defined); the real `projectCode` field name + the prop-threading path (Task 3 Step 2 — read the components).
- **Known gap:** persistent-dock relocation deferred (product decision — flag in PR); UI not browser-verified in this run (Task 4 = user).
