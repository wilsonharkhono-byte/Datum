# Schedule-Aware Assistant — Room Entry Point

**Date:** 2026-06-27
**Status:** Design approved in brainstorming (incl. the "open on the board" refinement); pending implementation plan.
**Scope:** Make Piece A's "Tanya asisten" room button open the project's assistant and auto-ask that room's scheduling question, replacing today's clipboard fallback. The assistant lives on the **board** (its home); the button navigates there with the question seeded.

## Goal

The per-project assistant already answers schedule-aware: `lib/assistant/retrieval.ts` (`retrieveProjectContext`) injects `getProjectStepSignals` (behind-plan / lead-time-risk / blocked, severity-sorted, top-15) into every turn's context. The missing piece is the **entry point** — `ChatDock` has purely internal state and no programmatic "open seeded" API, so `RoomAssistantButton` (Piece A) degrades to copying the prompt to the clipboard. This piece closes that gap.

## Context (current state)

- **`ChatDock`** (`apps/web/components/chat/ChatDock.tsx`, client): props `{ projectId, projectCode }`; internal `useState` for `mode` (`"tanya" | "catat"`), `messages`, `sessionId`, `mobileOpen`, etc.; persists to `localStorage` keyed per project. Send pipeline: `send(input, file)` appends a **user** bubble then `run(mode, input, file)`; `run` calls `runTanya`/`runCatat` and owns busy/error/offline handling.
- **It is a bottom-docked panel, not a floating widget** — both the desktop dock (`border-t … md:flex`, expands to 34vh) and the mobile pill (`h-12 w-full`) are **in-flow**, sized to sit at the bottom of the board page's full-height flex column (`app/(app)/project/[slug]/page.tsx`). It is mounted **only** on the board page. The rooms/schedule pages use scroll-content layouts, so the dock can't be relocated there without restructuring those pages — hence the assistant stays on the board.
- **`RoomAssistantButton`** (`apps/web/components/rooms/RoomAssistantButton.tsx`, Piece A, on main): has `buildPrompt(areaName, view)` (composes the room's ready/blocked/lead-time-critical steps + a scheduling question, in Bahasa) and an `open()` that falls back to `navigator.clipboard.writeText(prompt)`.
- The assistant is **per-project** (scoped by `projectId`); this piece keeps it so.

## Decisions (from brainstorming)

1. **Scope = entry point only.** No change to `/api/assistant/*` or `retrieval.ts` (already schedule-aware); no new assistant mode/capability.
2. **Auto-send.** The seeded scheduling question is asked immediately (the assistant answers right away).
3. **Open on the board (low-risk).** ChatDock stays docked on the board — untouched. Clicking the room button **navigates to the board** and the board's ChatDock auto-asks. A small layout-level provider carries the seeded prompt across the navigation. (Chosen over restructuring pages / floating the dock, which carry board-layout regression risk.)
4. **Room context rides in the seeded prompt text** (`buildPrompt`'s output) — no deeper structured per-room context injection (a possible follow-on).

## §1. Project layout + assistant-open context

- **`AssistantProvider`** (new client component, `apps/web/components/chat/AssistantProvider.tsx`): a React context, backed by `useState<string | null>(null)`, exposing exactly `{ openAndAsk(prompt: string): void; pendingPrompt: string | null; clearPending(): void }`. `openAndAsk` sets `pendingPrompt`; the consumer reads `pendingPrompt` and calls `clearPending()` once it has acted. A `useAssistant()` hook returns it (throws if used outside a provider).
- **Create `app/(app)/project/[slug]/layout.tsx`** (server component): renders `<AssistantProvider>{children}</AssistantProvider>` — nothing else. Because Next App Router layouts persist across their child segments, `pendingPrompt` set on the **rooms** page survives the navigation to the **board** page (both are children of this layout), where ChatDock reads it. The layout does **not** mount ChatDock and does **not** fetch the project (the board page keeps mounting ChatDock as it does today).

## §2. ChatDock consumes the context (on the board)

- `ChatDock` (mounted on the board, now inside the provider via the layout) calls `useAssistant()`; an effect keyed on `pendingPrompt` fires when it is non-null: open the dock (`setMobileOpen(true)`), set `mode = "tanya"`, append the user bubble (`setMessages((m) => [...m, { role: "user", content: pendingPrompt }])`), call `run("tanya", pendingPrompt, null)` (the existing pipeline — explicit `"tanya"` avoids a stale `mode` closure), then `clearPending()`. On mobile this opens the sheet; on desktop the inline dock is already present and the new turn appears in it.
- All existing ChatDock state/behavior is untouched — the seeded question appends as a new turn, so an in-progress conversation is preserved.

## §3. Wire the room button (seed + navigate)

- `RoomAssistantButton` calls `useAssistant().openAndAsk(buildPrompt(areaName, view))` then navigates to the board with `useRouter().push("/project/" + projectCodeFromPath)`. The board URL is derived from `usePathname()` (the rooms path is `/project/<CODE>/rooms`, so the board is `/project/<CODE>` = `"/project/" + pathname.split("/")[2]`) — no new prop threading. Remove the `navigator.clipboard` fallback and the `__openAssistant` shim. `buildPrompt` is unchanged.

## §4. Boundaries

- **No change to the board page** — ChatDock stays mounted there; it just reads the provider now (provided by the new layout). No removal, no layout restructure, no floating-dock conversion.
- **Out of scope:** an on-page dock on the rooms/schedule pages; deeper structured room-context injection into retrieval; any new assistant capability/mode; cross-project/global assistant.

## Testing

- `buildPrompt` is already pure (Piece A). The `AssistantProvider` reducer (set/clear `pendingPrompt`) is trivial and unit-testable if extracted, but is verified end-to-end in the browser.
- The seed-across-navigation + auto-ask path is UI → **browser-verify**: on a project's Rooms page, expand a room, click "Tanya asisten" → lands on that project's board with the assistant opened and answering that room's scheduling question (project readiness signals folded in); the existing board conversation is preserved; the clipboard fallback is gone.

## Open implementation notes

- The effect's dep array is `[pendingPrompt]`; `run`/setters/`clearPending` are intentionally omitted (fire only on a new prompt) — use an `eslint-disable-next-line react-hooks/exhaustive-deps` with a one-line comment.
- Confirm ChatDock is `"use client"` (it is) so adding `useAssistant()` is safe; the new layout is a server component rendering the client provider.
- Verify there is no second ChatDock mount elsewhere (only the board page was found) — the provider must be an ancestor of every `useAssistant()` consumer (the layout guarantees this for the board page's ChatDock and the rooms page's button).
