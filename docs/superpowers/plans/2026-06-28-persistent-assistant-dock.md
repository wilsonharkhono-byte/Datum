# Persistent Assistant Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assistant dock always present on every project page (mount ChatDock in the project layout) and drop the navigate-to-board from the Tanya-asisten button.

**Architecture:** `project/[slug]/layout.tsx` becomes async, resolves the project, and renders `<ChatDock>` inside the existing `<AssistantProvider>`; the board page stops mounting ChatDock; `RoomAssistantButton` stops navigating. No ChatDock-internals/API change.

**Tech Stack:** Next.js 16 App Router, React, Supabase. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-28-persistent-assistant-dock-design.md`

## Global Constraints

- **Atomic move:** ChatDock must end up mounted in exactly ONE place (the layout). Removing it from the board page in the same change prevents a double-mount (two `datum.chat.${id}` threads).
- No change to ChatDock internals, AssistantProvider, or the assistant API — only mount location + the button's navigation.
- **Verify:** `pnpm -C apps/web typecheck && pnpm -C apps/web build` (Node 22 via nvm: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22`). UI behavior is the user's browser-verify.

## File structure

| File | Change |
| --- | --- |
| `apps/web/app/(app)/project/[slug]/layout.tsx` | async; resolve project; render `<ChatDock>` in the provider |
| `apps/web/app/(app)/project/[slug]/page.tsx` | remove `<ChatDock>` render + import |
| `apps/web/components/rooms/RoomAssistantButton.tsx` | drop `router.push` + `useRouter`/`pathname` |

---

## Task 1: Move the dock into the layout (atomic)

**Files:**
- Modify: `apps/web/app/(app)/project/[slug]/layout.tsx`
- Modify: `apps/web/app/(app)/project/[slug]/page.tsx`
- Modify: `apps/web/components/rooms/RoomAssistantButton.tsx`

**Interfaces:**
- Consumes — `ChatDock` (`{ projectId, projectCode }`), `AssistantProvider`, `createSupabaseServerClient`, `useAssistant().openAndAsk`.

- [ ] **Step 1: Layout mounts ChatDock**

Rewrite `apps/web/app/(app)/project/[slug]/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AssistantProvider } from "@/components/chat/AssistantProvider";
import { ChatDock } from "@/components/chat/ChatDock";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, project_code")
    .eq("project_code", slug.toUpperCase())
    .maybeSingle();

  return (
    <AssistantProvider>
      {children}
      {project ? <ChatDock projectId={project.id} projectCode={project.project_code} /> : null}
    </AssistantProvider>
  );
}
```
(Confirm `project/[slug]/layout.tsx` receives `params` — App Router layouts do; `params` is a Promise in Next 16, matching the page convention.)

- [ ] **Step 2: Board page stops mounting ChatDock**

In `apps/web/app/(app)/project/[slug]/page.tsx`: remove the `<ChatDock projectId={…} projectCode={…} />` render line AND the `import { ChatDock } from "@/components/chat/ChatDock";` (it's now in the layout). Leave everything else (header, advisor, board) untouched.

- [ ] **Step 3: Button stops navigating**

In `apps/web/components/rooms/RoomAssistantButton.tsx`: remove `router.push(...)` and the now-unused `useRouter()` call + the `pathname` usage (and the `next/navigation` import if those were its only uses). Keep `const { openAndAsk } = useAssistant();` and the `open()` handler calling `openAndAsk(buildPrompt(areaName, view))`. The dock is now always mounted, so it opens in place.

- [ ] **Step 4: Typecheck + build + commit**

Run (Node 22): `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
> The build's RSC boundary check is the key gate — ChatDock is a client component rendered by an async server layout; that's valid (server renders client), but confirm no error. Also confirm only ONE ChatDock mount remains (grep `<ChatDock` → only the layout).
```bash
git add "apps/web/app/(app)/project/[slug]/layout.tsx" "apps/web/app/(app)/project/[slug]/page.tsx" apps/web/components/rooms/RoomAssistantButton.tsx
git commit -m "feat(assistant): persistent dock — mount ChatDock in the project layout, drop navigation"
```

---

## Task 2: Verification (controller-run, browser)

> UI behavior — browser-verify on prod (post-merge).

- [ ] The assistant dock is present on the board, rooms, schedule, and activity pages (not only the board).
- [ ] "Tanya asisten" on a room opens the dock **in place** (no navigation away from the rooms page) and asks the seeded question.
- [ ] The chat thread persists when moving between the project's pages (same `datum.chat.${projectId}`), and does not double up.
- [ ] No console/server errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 layout → Step 1; §2 board page → Step 2; §3 button → Step 3; §4 scope honored (apps/web only, no internals change).
- **Atomicity:** the double-mount risk is eliminated by removing the board-page ChatDock in the same task.
- **Verify-during-impl:** layout `params` Promise shape (Step 1); RoomAssistantButton's exact `useRouter`/`pathname` lines to remove (Step 3 — read the file); single ChatDock mount after (Step 4).
