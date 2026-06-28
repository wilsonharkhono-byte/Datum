# Persistent Assistant Dock — Design

**Date:** 2026-06-28
**Status:** Design (autonomous build); spec → plan → implementation.
**Module:** Readiness system. Completes the dock assistant (PR #31) so it's always available, no navigation.

## Goal (vs the readiness end-goal)

Make the schedule-aware assistant **always reachable** on any project page, so a busy PM can ask "what's slipping / what's next" from wherever they are — removing the navigate-to-board friction. The assistant is the *guidance* surface of the proactive engine; persistent availability is what makes it usable in the flow of work.

## Context — what exists (PR #31)

- `project/[slug]/layout.tsx` wraps every project page in `<AssistantProvider>` (a context with `openAndAsk(prompt)` / `pendingPrompt` / `clearPending()`).
- `ChatDock` consumes `pendingPrompt` (sends it, clears it), persists per-project chat via `storageKey = datum.chat.${projectId}`, and is mounted **only** on the board page `project/[slug]/page.tsx` (`<ChatDock projectId={board.project.id} projectCode={…} />`).
- `RoomAssistantButton` calls `openAndAsk(prompt)` then `router.push(/project/{code})` — i.e. it navigates to the board because that's the only place the dock lives.

## Decision

**Mount `ChatDock` in the project layout** (inside the existing `AssistantProvider`), so it's present on every project page, and **drop the navigation** from `RoomAssistantButton`. The provider context already carries the pending prompt across pages, so a button anywhere sets it and the always-mounted dock reacts in place.

## §1 · Layout mounts the dock

`project/[slug]/layout.tsx` becomes an async server component:
- Resolve the project by `slug` (uppercased `project_code`) via `createSupabaseServerClient` → `{ id, project_code }`.
- Render `<AssistantProvider>{children}{project ? <ChatDock projectId={project.id} projectCode={project.project_code} /> : null}</AssistantProvider>`.
- If the project isn't found, render just `{children}` (the page already handles not-found).
- One small indexed `projects` lookup per project-page load — acceptable; the dock is worth it.

## §2 · Board page stops mounting the dock

`project/[slug]/page.tsx`: remove the `<ChatDock … />` render and its import (now provided by the layout — otherwise it double-mounts on the board, with two `datum.chat.${id}` instances).

## §3 · Button stops navigating

`RoomAssistantButton`: drop `router.push(...)` + the `useRouter`/`pathname` usage; keep `openAndAsk(buildPrompt(...))`. The always-mounted dock opens in place. (On mobile the dock's `mobileOpen` is set by the pending-prompt effect, as today.)

## §4 · Scope & boundaries

- **apps/web only.** No API/provider/ChatDock-internals change — ChatDock already reads `pendingPrompt`; we only change *where it's mounted* and *that the button no longer navigates*.
- Per-project chat persistence is unchanged (`storageKey` by `projectId`; same project → same thread across pages).
- **Out of scope:** a global (cross-project) dock; collapsing/resizing UX; mounting on non-project pages.
- **Verification gap:** UI behavior — browser-verify on prod (the user): the dock is present on rooms/schedule/etc., "Tanya asisten" opens it in place (no navigation), the thread persists across pages.

## Testing

- Typecheck + build gated (the layout becoming async + rendering a client component is the main risk — the build's RSC boundary check covers it).
- No new unit tests (pure-logic untouched); browser verification is the user's.
