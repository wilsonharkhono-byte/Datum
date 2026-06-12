# Optimistic Card-Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make adding a card on the project board paint instantly (Trello-like) using React 19 `useOptimistic`, with the ghost card auto-replaced by the real card when the server settles.

**Architecture:** A pure reducer layers a temp card onto the server `board`. `Board.tsx` drives it with `useOptimistic` and exposes `addOptimisticCard` via context. `AddCardForm` dispatches the optimistic card and clears immediately, then runs `createCard` inside a transition; `useOptimistic` reverts to real data on settle. `MiniCard` renders ghost cards dimmed and non-interactive.

**Tech Stack:** Next.js (App Router, Server Components + Server Actions), React 19 (`useOptimistic`, `useTransition`), TypeScript, Vitest, Supabase.

---

## File Structure

- **Create** `apps/web/lib/cards/optimisticBoard.ts` — pure reducer + view types. One responsibility: compute the optimistic board from the server board + an action.
- **Create** `apps/web/lib/cards/optimisticBoardContext.tsx` — React context + `useOptimisticBoard()` hook so the nested `AddCardForm` can dispatch without prop-drilling.
- **Create** `apps/web/tests/unit/optimistic-board.test.ts` — unit tests for the reducer.
- **Modify** `apps/web/components/board/Board.tsx` — wire `useOptimistic` + provider; render from optimistic board.
- **Modify** `apps/web/components/board/AddCardForm.tsx` — dispatch optimistic card, clear immediately, run action in transition.
- **Modify** `apps/web/components/board/MiniCard.tsx` — accept the view type; render ghost cards dimmed + non-interactive.
- **Modify** `apps/web/components/board/Column.tsx` — pass through the view-typed cards (type-only change).

### Shared types (defined in Task 1, referenced everywhere)

```typescript
// apps/web/lib/cards/optimisticBoard.ts
import type { Board, BoardColumn } from "@/lib/cards/queries";
import type { CardWithLabels } from "@/lib/cards/labels";
import type { Card } from "@datum/db";

/** A board card as rendered on the client: real card data plus an optional
    flag marking a still-saving optimistic (ghost) card. */
export type BoardCardView = CardWithLabels & { __optimistic?: boolean };

export type OptimisticAction = { type: "add-card"; topicId: string; title: string };
```

---

## Task 1: Pure optimistic reducer + types

**Files:**
- Create: `apps/web/lib/cards/optimisticBoard.ts`
- Test: `apps/web/tests/unit/optimistic-board.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/unit/optimistic-board.test.ts
import { describe, expect, it } from "vitest";
import { optimisticReducer } from "@/lib/cards/optimisticBoard";
import type { Board } from "@/lib/cards/queries";

function board(): Board {
  return {
    project: { id: "p1", project_code: "PRJ" } as Board["project"],
    columns: [
      { topic: { id: "t1", name: "Design" } as any, cards: [
        { id: "c1", topic_id: "t1", title: "Existing", slug: "existing", status: "active", labels: [], deadline: null } as any,
      ] },
      { topic: { id: "t2", name: "Build" } as any, cards: [] },
    ],
  };
}

describe("optimisticReducer add-card", () => {
  it("appends an optimistic card to the matching column", () => {
    const next = optimisticReducer(board(), { type: "add-card", topicId: "t2", title: "New room" });
    const col = next.columns.find((c) => c.topic.id === "t2")!;
    expect(col.cards).toHaveLength(1);
    expect(col.cards[0].title).toBe("New room");
    expect(col.cards[0].status).toBe("active");
    expect(col.cards[0].labels).toEqual([]);
    expect((col.cards[0] as any).__optimistic).toBe(true);
  });

  it("preserves existing cards in the target column", () => {
    const next = optimisticReducer(board(), { type: "add-card", topicId: "t1", title: "Second" });
    const col = next.columns.find((c) => c.topic.id === "t1")!;
    expect(col.cards.map((c) => c.title)).toEqual(["Existing", "Second"]);
  });

  it("is a no-op for an unknown topicId", () => {
    const input = board();
    const next = optimisticReducer(input, { type: "add-card", topicId: "nope", title: "X" });
    expect(next.columns.flatMap((c) => c.cards)).toHaveLength(1);
  });

  it("does not mutate the input board", () => {
    const input = board();
    optimisticReducer(input, { type: "add-card", topicId: "t2", title: "New room" });
    expect(input.columns.find((c) => c.topic.id === "t2")!.cards).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run tests/unit/optimistic-board.test.ts`
Expected: FAIL — `optimisticReducer` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/lib/cards/optimisticBoard.ts
import type { Board } from "@/lib/cards/queries";
import type { CardWithLabels } from "@/lib/cards/labels";
import type { Card } from "@datum/db";

/** A board card as rendered on the client: real card data plus an optional
    flag marking a still-saving optimistic (ghost) card. */
export type BoardCardView = CardWithLabels & { __optimistic?: boolean };

export type OptimisticAction = { type: "add-card"; topicId: string; title: string };

/** Build the ghost card shown immediately on submit, before the server insert
    completes. Deterministic id (topic + title) — no Date.now/Math.random so the
    reducer stays pure and SSR-safe. The card is replaced by the real row when
    the server action settles and fresh `board` props arrive. */
function makeOptimisticCard(topicId: string, title: string): BoardCardView {
  const base: Partial<Card> = {
    id: `optimistic:${topicId}:${title}`,
    topic_id: topicId,
    title,
    slug: "",
    status: "active",
    current_summary: null,
    properties: null,
    created_by_staff_id: null,
    created_at: "",
    updated_at: "",
    last_event_at: null,
  };
  return { ...(base as Card), labels: [], deadline: null, __optimistic: true };
}

/** Pure reducer for `useOptimistic`. Returns a new Board with a ghost card
    appended to the matching column; unknown topicId returns the board unchanged.
    Never mutates `board`. */
export function optimisticReducer(board: Board, action: OptimisticAction): Board {
  if (action.type !== "add-card") return board;
  let matched = false;
  const columns = board.columns.map((col) => {
    if (col.topic.id !== action.topicId) return col;
    matched = true;
    return { ...col, cards: [...col.cards, makeOptimisticCard(action.topicId, action.title)] };
  });
  return matched ? { ...board, columns } : board;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run tests/unit/optimistic-board.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/cards/optimisticBoard.ts apps/web/tests/unit/optimistic-board.test.ts
git commit -m "feat(board): pure optimistic-card reducer + view type"
```

---

## Task 2: Optimistic board context + hook

**Files:**
- Create: `apps/web/lib/cards/optimisticBoardContext.tsx`

- [ ] **Step 1: Write the context and hook**

```tsx
// apps/web/lib/cards/optimisticBoardContext.tsx
"use client";
import { createContext, useContext } from "react";

export type OptimisticBoardApi = {
  /** Paint a ghost card in `topicId` immediately. Must be called inside a
      transition (it is, from AddCardForm's startTransition). */
  addOptimisticCard: (topicId: string, title: string) => void;
};

const OptimisticBoardContext = createContext<OptimisticBoardApi | null>(null);

export const OptimisticBoardProvider = OptimisticBoardContext.Provider;

/** Access the board's optimistic API from any descendant of <Board>. */
export function useOptimisticBoard(): OptimisticBoardApi {
  const ctx = useContext(OptimisticBoardContext);
  if (!ctx) throw new Error("useOptimisticBoard must be used inside <Board>");
  return ctx;
}
```

- [ ] **Step 2: Type-check**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: PASS (no errors from the new file).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/cards/optimisticBoardContext.tsx
git commit -m "feat(board): optimistic-board context + useOptimisticBoard hook"
```

---

## Task 3: Wire useOptimistic + provider into Board.tsx

**Files:**
- Modify: `apps/web/components/board/Board.tsx`

- [ ] **Step 1: Add imports**

At the top of `apps/web/components/board/Board.tsx`, update the React import and add the new ones:

```tsx
import { useCallback, useEffect, useMemo, useOptimistic, useState, useTransition } from "react";
import { optimisticReducer } from "@/lib/cards/optimisticBoard";
import { OptimisticBoardProvider, type OptimisticBoardApi } from "@/lib/cards/optimisticBoardContext";
```

- [ ] **Step 2: Drive the board through useOptimistic**

Immediately inside `export function Board({ board })`, after `const router = useRouter();`, add:

```tsx
  const [optimisticBoard, addOptimistic] = useOptimistic(board, optimisticReducer);
  const [, startTransition] = useTransition();
  const api: OptimisticBoardApi = useMemo(
    () => ({
      addOptimisticCard: (topicId, title) =>
        startTransition(() => addOptimistic({ type: "add-card", topicId, title })),
    }),
    [addOptimistic],
  );
```

- [ ] **Step 3: Render from the optimistic board**

In the same component, change every read of `board.columns` used for rendering to `optimisticBoard.columns`. Specifically, in the `filteredColumns` `useMemo`, replace `for (const col of board.columns)` with `for (const col of optimisticBoard.columns)`, and update the `useMemo` dependency array from `[board.columns, query, statuses, labelFilter]` to `[optimisticBoard.columns, query, statuses, labelFilter]`. Also change `const totalCards = board.columns.reduce(...)` to `optimisticBoard.columns.reduce(...)`. Leave `board.project.id` (realtime subscribe) and `board.project.project_code` / `board.project.id` (passed to Column) reading from `board` — project identity is stable.

- [ ] **Step 4: Wrap the rendered tree in the provider**

Wrap the outermost returned `<div className="flex h-full flex-col">…</div>` so the provider is its parent:

```tsx
  return (
    <OptimisticBoardProvider value={api}>
      <div className="flex h-full flex-col">
        {/* …existing BoardFilter + columns markup unchanged… */}
      </div>
    </OptimisticBoardProvider>
  );
```

- [ ] **Step 5: Type-check**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/board/Board.tsx
git commit -m "feat(board): drive board through useOptimistic + provide add API"
```

---

## Task 4: Dispatch optimistic card from AddCardForm

**Files:**
- Modify: `apps/web/components/board/AddCardForm.tsx`

- [ ] **Step 1: Import the hook**

Add to the imports in `apps/web/components/board/AddCardForm.tsx`:

```tsx
import { useOptimisticBoard } from "@/lib/cards/optimisticBoardContext";
```

- [ ] **Step 2: Consume the API and paint on submit**

Inside the component, after `const [pending, startTransition] = useTransition();`, add:

```tsx
  const { addOptimisticCard } = useOptimisticBoard();
```

Replace the existing `submit` function body with the version below. The ghost card paints immediately and the form closes right away; the real insert runs in the background, and a failure re-opens the form with the typed title so the user can retry:

```tsx
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    const fd = new FormData();
    fd.set("projectId", projectId);
    fd.set("topicId", topicId);
    fd.set("projectCode", projectCode);
    fd.set("title", trimmed);
    // Paint the ghost card now and close the form — no blocking "Menyimpan…".
    addOptimisticCard(topicId, trimmed);
    setTitle("");
    setOpen(false);
    startTransition(async () => {
      const res = await createCard(fd);
      if (!res.ok) {
        // Revert is automatic (useOptimistic); surface the error and let the
        // user retry by re-opening the form with their text restored.
        setTitle(trimmed);
        setOpen(true);
        setError(res.error);
      }
    });
  }
```

- [ ] **Step 3: Type-check + run existing board tests**

Run: `cd apps/web && pnpm tsc --noEmit && pnpm vitest run tests/unit/optimistic-board.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/board/AddCardForm.tsx
git commit -m "feat(board): paint optimistic card on add, close form immediately"
```

---

## Task 5: Ghost styling in MiniCard

**Files:**
- Modify: `apps/web/components/board/MiniCard.tsx`
- Modify: `apps/web/components/board/Column.tsx`

- [ ] **Step 1: Widen MiniCard's prop type and render ghosts non-interactively**

In `apps/web/components/board/MiniCard.tsx`, change the import and the prop type to accept the view type, and branch on `__optimistic`. Replace the function signature and the opening `<Link>` with a conditional wrapper:

```tsx
import Link from "next/link";
import { TrelloIcon } from "@/components/icons/Icon";
import { LABEL_STYLE } from "@/lib/cards/labels";
import type { CardDeadline } from "@/lib/gates/board-deadlines";
import type { BoardCardView } from "@/lib/cards/optimisticBoard";

export function MiniCard({ card, projectCode }: { card: BoardCardView; projectCode: string }) {
  const inner = (
    <>
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
      <div className="font-medium text-foreground">{card.title}</div>
      {card.current_summary ? (
        <div className="mt-0.5 line-clamp-2 text-[10px] text-[var(--text-secondary)]">{card.current_summary}</div>
      ) : null}
      {card.last_event_at ? (
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
          {new Date(card.last_event_at).toLocaleDateString("id-ID", { year: "numeric", month: "short", day: "numeric" })}
        </div>
      ) : null}
      {(card.properties as { trello_card_id?: string } | null)?.trello_card_id ? (
        <div className="mt-1 inline-flex items-center gap-1 rounded bg-[var(--surface-alt)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
          <TrelloIcon size={10} />
          <span>Trello</span>
        </div>
      ) : null}
    </>
  );

  if (card.__optimistic) {
    return (
      <div
        aria-busy="true"
        className="block rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs opacity-70"
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={`/project/${projectCode}/cards/${card.slug}`}
      className="block rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs hover:border-[var(--sand-dark)]"
    >
      {inner}
    </Link>
  );
}
```

Leave the `DeadlineChip` function below unchanged.

- [ ] **Step 2: Update Column.tsx card typing**

In `apps/web/components/board/Column.tsx`, the cards now carry the optional `__optimistic` flag. `BoardColumn.cards` is typed `CardWithLabels[]`; the optimistic ones are a structural superset, so the `.map` still type-checks. No code change is required unless `tsc` complains — if it does, change the import to also pull `BoardCardView` and cast at the map boundary: `column.cards.map((card: BoardCardView) => ...)`. Run tsc to confirm.

- [ ] **Step 3: Type-check**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/board/MiniCard.tsx apps/web/components/board/Column.tsx
git commit -m "feat(board): render optimistic ghost cards dimmed + non-interactive"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the full web test suite**

Run: `cd apps/web && pnpm vitest run`
Expected: PASS (all suites, including the new `optimistic-board.test.ts`).

- [ ] **Step 2: Type-check the whole app**

Run: `cd apps/web && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual verification (running app)**

Start the dev server, open a project board, log in as `wilson@datum.local` / `password123`. Add a card:
- The card appears **instantly**, dimmed, before any spinner.
- Within ~1–2s it becomes a normal, clickable card (the real row) with no flicker or duplicate.
- Add a card with a title that forces a slug collision (same title twice) — both resolve to distinct real cards.
- Simulate failure (e.g. temporarily throw in `createCard`) — the ghost disappears and the form re-opens with the typed title + error. Revert the throw afterward.

- [ ] **Step 4: Final commit (if any manual fixes were needed)**

```bash
git add -A
git commit -m "test(board): verify optimistic card-add end to end"
```

---

## Self-Review Notes

- **Spec coverage:** reducer (Task 1) ✓; context/hook (Task 2) ✓; Board `useOptimistic` + provider (Task 3) ✓; AddCardForm instant paint + error revert (Task 4) ✓; ghost styling (Task 5) ✓; unit + manual tests (Tasks 1, 6) ✓. File/event optimistic uploads explicitly out of scope per spec.
- **No `Date.now`/`Math.random`:** temp id is `optimistic:${topicId}:${title}` — deterministic. ✓
- **Type consistency:** `BoardCardView`, `OptimisticAction`, `optimisticReducer`, `addOptimisticCard`, `useOptimisticBoard`, `OptimisticBoardProvider` used identically across tasks. ✓
- **No new data-layer dependency:** `useOptimistic` only. ✓
