# Optimistic Card-Add — Design

**Date:** 2026-06-12
**Status:** Approved, ready for implementation
**Goal:** Make adding a card on the project board feel instant (Trello-like) by painting the card immediately on submit instead of blocking the UI on a server round-trip.

## Problem

Today, adding a card blocks the form in a "Menyimpan…" state until `createCard` completes (slug-uniqueness query + insert + RLS + `revalidatePath`), typically ~1–2s. The card only appears after the server confirms and the board re-renders. Trello feels instant because it uses optimistic UI: the card paints locally first, the network request runs in the background.

## Architecture context

- The board is server-rendered. A `board` prop flows from a Server Component into `apps/web/components/board/Board.tsx`, down through `Column` → `AddCardForm`.
- There is **no client cache** (no React Query/SWR). The rendered state *is* the server `board` prop.
- `createCard` (`apps/web/lib/cards/mutations.ts`) already calls `revalidatePath()`, so after a successful write the server re-renders and the `board` prop updates on its own.
- Realtime (`apps/web/lib/cards/realtime.ts`) calls `router.refresh()` on any project change (250ms debounce) — a second path to the same re-render.

## Approach: React 19 `useOptimistic`

`useOptimistic` is built for this shape. It layers a pending card on top of the server `board` and **auto-reverts to the real data** when the dispatching transition settles and fresh props arrive — no manual temp-card cleanup, and no risk of a stranger's realtime refresh wiping a still-pending card.

### Components

1. **`Board.tsx`** — call `useOptimistic(board, optimisticReducer)`. Render columns from the optimistic copy rather than the raw prop. The reducer is pure and lives in its own file so it can be unit-tested in isolation.

2. **`optimisticBoard.ts`** (new, `apps/web/lib/cards/`) — exports:
   - `optimisticReducer(board, action)` where `action = { type: "add-card"; topicId: string; title: string }`. Returns a new `Board` with a temp card appended to the matching column. Temp card shape: `id: "optimistic:" + title` (or a monotonic counter — no `Math.random`/`Date.now`), `status: "active"`, `labels: []`, `current_summary: null`, `deadline: null`, plus a marker `__optimistic: true`. Unknown `topicId` returns the board unchanged.
   - A type for the optimistic action.

3. **`OptimisticBoardContext`** (new, in `Board.tsx` or a small sibling file) — provides `addOptimisticCard(topicId, title)` so the deeply-nested `AddCardForm` can dispatch without prop-drilling. `AddCardForm` consumes it via a `useOptimisticBoard()` hook.

4. **`AddCardForm.tsx`** — on submit:
   - call `addOptimisticCard(topicId, title)` so the card paints **instantly**;
   - clear + close the form immediately (no "Menyimpan…" wait);
   - run `createCard` inside `startTransition` (the dispatch must occur inside a transition for `useOptimistic`);
   - on `{ ok: false }`, surface the error (inline message re-opening the form, or a toast); the optimistic card disappears automatically on revert.

5. **`MiniCard` / card rendering** — when `__optimistic` is true, render dimmed (`opacity-70`), non-interactive (no link/click target, no drag). Reads as "saving" without a blocking spinner — Trello's ghost-card feel.

### Data flow

```
submit → addOptimisticCard(dispatch)   → ghost card paints immediately
       → startTransition(createCard)   → server insert + revalidatePath
       → server re-render, new board prop
       → transition settles → useOptimistic reverts to real board (ghost replaced by real card)
```

### Error handling

- `createCard` returns `{ ok: false, error }` → show the error to the user and let them retry. The optimistic card is gone (reverted) so there is no duplicate.
- Network/throw inside the transition → same revert; surface a generic failure message.

## Scope

**In scope:** optimistic add for cards only.
**Out of scope (next pass):** optimistic/background file + event uploads; optimistic column add; optimistic card moves/drag. These are larger changes (background upload queue) and are deliberately deferred.

## Testing

- **Unit:** `optimisticReducer` — adds a card to the right column; unknown `topicId` is a no-op; existing cards/columns are preserved; temp card has the `__optimistic` marker and `active` status.
- **Component/behavioral:** submitting `AddCardForm` paints a card before the server action resolves; a failed `createCard` removes the optimistic card and shows an error.
- **Manual:** verify in the running app that the card appears instantly and is replaced seamlessly by the real card (no flicker/duplicate).

## Non-goals / constraints

- No `Math.random()` / `Date.now()` for temp ids (keep deterministic; use title + a render-scoped counter).
- No new client-data-layer dependency (React Query etc.) — `useOptimistic` only.
- Keep the existing realtime + `revalidatePath` paths unchanged.
