# Schedule-Aware Assistant — Seeded Open — Design

**Date:** 2026-06-27
**Status:** Design (autonomous build); spec → plan → implementation.
**Module:** Readiness system, feature 3. Completes the Piece A deferred "Tanya asisten" flow.

## Goal

Make the "Tanya asisten" button actually **open the assistant pre-seeded** with the room's step context, instead of copying the prompt to the clipboard. The assistant's context is **already schedule-aware** (`retrieval.ts` folds the top-15 readiness signals + the "Hari Ini" advisor into every project conversation), so this is purely the missing open-UX.

## Context — what exists

- **`RoomAssistantButton`** (Piece A) already builds a rich Bahasa prompt (ready / blocked / lead-time-critical steps + a scheduling question) but can only `navigator.clipboard.writeText` it — its own comment says "ChatDock has no exported seeded-open mechanism."
- **`ChatDock`** (`components/chat/ChatDock.tsx`) holds all state internally (`messages`, `sessionId`, `mobileOpen`, an offline send-queue) and exposes `send(input, file)`. It is mounted **only** on `app/(app)/project/[slug]/page.tsx` (the board), not in the layout — so it is absent on the rooms page.
- **`retrieval.ts`** `retrieveProjectContext` already injects readiness signals → the assistant answers with schedule awareness once it receives the question.

## Decision — sessionStorage handoff (low-risk, additive)

The button writes the seed prompt to `sessionStorage` and navigates to the board page; `ChatDock` (on the board) reads + consumes the seed on mount, opens, and sends it. Rationale vs. alternatives:
- **Chosen:** no relocation of the complex `ChatDock`; additive (one `useEffect`); works cross-page; avoids putting the prompt in a URL (it's app data). Minor UX cost: navigates from rooms → board.
- **Rejected (for now):** moving `ChatDock` into the project **layout** as a persistent dock (better UX — no navigation — but a larger change touching every project page's chrome; a product decision worth the user's call, flagged in the PR). A same-page event bus alone doesn't help because ChatDock isn't on the rooms page.

## §1 · Seed module (pure-ish, tested)

`apps/web/lib/assistant/seed.ts`:
```
const KEY = "datum_assistant_seed";
setAssistantSeed(prompt: string): void   // sessionStorage.setItem(KEY, prompt) (guarded for SSR / no storage)
takeAssistantSeed(): string | null       // read + remove (one-shot); null if absent/unavailable
```
Both guard `typeof window === "undefined"` and a `try/catch` around storage (private-mode / disabled storage → no-op / null).

## §2 · Button writes seed + navigates

`RoomAssistantButton` gains a `projectCode: string` prop (threaded rooms page → `RoomsView` → `RoomRow` → button). Its `open()` becomes: build the prompt (unchanged), `setAssistantSeed(prompt)`, then `router.push(\`/project/${projectCode}\`)`. The clipboard line is removed (the seed handoff replaces it). If `setAssistantSeed` no-ops (no storage), still navigate — the assistant simply opens without a seed (acceptable degradation).

## §3 · ChatDock consumes the seed on mount

Add one `useEffect(() => { … }, [])` to `ChatDock` (after `send` is defined): `const seed = takeAssistantSeed(); if (seed) { setMobileOpen(true); void send(seed, null); }`. Runs once on mount, after hydration. `setMobileOpen(true)` reveals the dock on mobile (desktop already shows it); `send` reuses the existing path (so the seeded question flows through retrieval → schedule-aware answer). The seed is one-shot (`takeAssistantSeed` removes it) so a later refresh doesn't re-send.

## §4 · Scope & boundaries

- Reuses ChatDock's existing `send` + retrieval — **no change to the assistant brain or API**; it's already schedule-aware.
- **Out of scope:** persistent-dock relocation (flagged for a product decision); per-step "ask about this step" buttons (could reuse `setAssistantSeed` later); seeding the dock's mode (always `tanya`).
- Threads only `projectCode` (a string already on every room's data) — no new queries.
- **Verification gap:** this is a UI-behavior change (navigate + auto-open + auto-send) that can't be browser-verified in this autonomous run — the user verifies on prod (flagged in the PR).

## Testing

- `lib/assistant/seed.ts` unit-tested with a `sessionStorage` mock: set→take round-trips; `take` is one-shot (second call returns null); SSR/no-storage guards return null / no-op without throwing.
- `ChatDock` + `RoomAssistantButton` changes are typecheck-gated (no unit test for the wiring) + flagged for browser verification.
