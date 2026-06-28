# Schedule-Aware Assistant Room Entry Point — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the room "Tanya asisten" button open the project's board assistant and auto-ask that room's scheduling question, replacing the clipboard fallback.

**Architecture:** A small per-project React context (`AssistantProvider`) mounted in a new `project/[slug]/layout.tsx` carries a seeded prompt across navigation. The board's `ChatDock` (unchanged in placement) consumes it and auto-asks; `RoomAssistantButton` seeds the prompt and navigates to the board.

**Tech Stack:** Next.js 16 App Router, React client components. No DB, no API change, no new deps.

**Spec:** `docs/superpowers/specs/2026-06-27-schedule-assistant-entry-point-design.md`

## Global Constraints

- The assistant stays **per-project** and **board-docked** — ChatDock's placement/positioning is NOT changed; no layout restructure; no floating-dock conversion.
- No change to `/api/assistant/*` or `lib/assistant/retrieval.ts` (already schedule-aware).
- Conventions: `"use client"` on client components; CSS-var Tailwind; Bahasa Indonesia copy.
- Verify: `pnpm -C apps/web typecheck` for every task; `pnpm -C apps/web build` for the tasks touching the layout/ChatDock (RSC/route boundaries). Browser verification is the final task.

## File structure

| File | Responsibility |
| --- | --- |
| `apps/web/components/chat/AssistantProvider.tsx` | new: context `{ openAndAsk, pendingPrompt, clearPending }` + `useAssistant()` |
| `apps/web/app/(app)/project/[slug]/layout.tsx` | new: wraps `{children}` in `AssistantProvider` (persists the seed across the project's pages) |
| `apps/web/components/chat/ChatDock.tsx` | consume the provider → open + auto-ask the seeded prompt |
| `apps/web/components/rooms/RoomAssistantButton.tsx` | seed via `openAndAsk` + navigate to the board (drop clipboard) |

---

## Task 1: AssistantProvider + project layout

**Files:**
- Create: `apps/web/components/chat/AssistantProvider.tsx`
- Create: `apps/web/app/(app)/project/[slug]/layout.tsx`

**Interfaces:**
- Produces — `AssistantProvider` (client); `useAssistant(): { openAndAsk(prompt: string): void; pendingPrompt: string | null; clearPending(): void }` (throws outside a provider).

- [ ] **Step 1: Create the provider**

`apps/web/components/chat/AssistantProvider.tsx`:
```tsx
"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type AssistantContextValue = {
  openAndAsk: (prompt: string) => void;
  pendingPrompt: string | null;
  clearPending: () => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const openAndAsk = useCallback((prompt: string) => setPendingPrompt(prompt), []);
  const clearPending = useCallback(() => setPendingPrompt(null), []);
  return (
    <AssistantContext.Provider value={{ openAndAsk, pendingPrompt, clearPending }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within an AssistantProvider");
  return ctx;
}
```

- [ ] **Step 2: Create the project layout**

`apps/web/app/(app)/project/[slug]/layout.tsx`:
```tsx
import type { ReactNode } from "react";
import { AssistantProvider } from "@/components/chat/AssistantProvider";

export default function ProjectLayout({ children }: { children: ReactNode }) {
  return <AssistantProvider>{children}</AssistantProvider>;
}
```
> The layout adds no DOM (a context provider renders no wrapper element), so the board page's full-height flex column is unaffected. It does not need `params` or a project fetch.

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/chat/AssistantProvider.tsx "apps/web/app/(app)/project/[slug]/layout.tsx"
git commit -m "feat(assistant): per-project AssistantProvider + project layout"
```

---

## Task 2: ChatDock consumes the provider (auto-ask)

**Files:**
- Modify: `apps/web/components/chat/ChatDock.tsx`

**Interfaces:**
- Consumes — `useAssistant()` (Task 1); the existing `run(mode, input, file)`, `setMode`, `setMobileOpen`, `setMessages` inside ChatDock.

- [ ] **Step 1: Import the hook**

Add to the imports at the top of `apps/web/components/chat/ChatDock.tsx`:
```tsx
import { useAssistant } from "./AssistantProvider";
```

- [ ] **Step 2: Add the consumer effect**

Inside the `ChatDock` component, add the hook next to the other `useState`/`useRef` hooks (e.g. right after the `queueCount` state on line ~131):
```tsx
  const { pendingPrompt, clearPending } = useAssistant();
```
Then add this effect alongside the other `useEffect`s (e.g. after the localStorage-persistence effect, ~line 169). `run` is a hoisted function declaration in this component, so it is callable here:
```tsx
  // A seeded prompt (e.g. from the room "Tanya asisten" button, carried across
  // navigation by AssistantProvider) opens the dock and auto-asks in tanya mode.
  useEffect(() => {
    if (!pendingPrompt) return;
    setMobileOpen(true);
    setMode("tanya");
    setMessages((m) => [...m, { role: "user", content: pendingPrompt }]);
    void run("tanya", pendingPrompt, null);
    clearPending();
    // Fire only when a new prompt arrives; run/setters/clearPending are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);
```

- [ ] **Step 3: Typecheck + build + commit**

Run: `pnpm -C apps/web typecheck && pnpm -C apps/web build` → PASS.
```bash
git add apps/web/components/chat/ChatDock.tsx
git commit -m "feat(assistant): ChatDock opens + auto-asks a seeded prompt"
```

---

## Task 3: Wire the room button (seed + navigate)

**Files:**
- Modify: `apps/web/components/rooms/RoomAssistantButton.tsx`

**Interfaces:**
- Consumes — `useAssistant()` (Task 1); `buildPrompt` (existing in this file).

- [ ] **Step 1: Replace the clipboard fallback**

In `apps/web/components/rooms/RoomAssistantButton.tsx`, add imports:
```tsx
import { usePathname, useRouter } from "next/navigation";
import { useAssistant } from "@/components/chat/AssistantProvider";
```
Replace the component body's `open()` (which currently does `navigator.clipboard?.writeText(prompt)` plus its comment) with the seed-and-navigate version, leaving `buildPrompt` and the returned `<button>` JSX unchanged:
```tsx
export function RoomAssistantButton({
  areaName,
  view,
}: {
  areaName: string;
  view: View;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { openAndAsk } = useAssistant();
  function open() {
    openAndAsk(buildPrompt(areaName, view));
    // The rooms path is /project/<CODE>/rooms → the board is /project/<CODE>.
    router.push(`/project/${pathname.split("/")[2]}`);
  }
  // …unchanged <button onClick={open} …> JSX…
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm -C apps/web typecheck` → PASS.
```bash
git add apps/web/components/rooms/RoomAssistantButton.tsx
git commit -m "feat(rooms): Tanya asisten seeds the board assistant + navigates (drops clipboard)"
```

---

## Task 4: Browser verification (controller-run)

> Needs a running dev server + an authed session on a project that has a seeded room (e.g. Dharmahusada).

- [ ] Open `/project/<CODE>/rooms`; expand a room with steps; click **"Tanya asisten: jadwal & langkah berikutnya"**.
- [ ] Confirm: it navigates to `/project/<CODE>` (the board), the assistant opens (mobile: the sheet; desktop: the inline dock shows the new turn), and it auto-asks that room's question — the user bubble shows the room's ready/blocked/lead-time steps + the scheduling ask, and the assistant answers (project readiness signals folded in).
- [ ] Confirm an existing board conversation is preserved (the seeded question appends as a new turn, not a reset).
- [ ] Confirm the clipboard no longer receives the prompt (the fallback is gone). No console errors.

---

## Self-review checklist (plan author)

- **Spec coverage:** §1 provider+layout → Task 1; §2 ChatDock consume → Task 2; §3 button seed+navigate → Task 3; §4 boundaries honored (board page untouched; no dock relocation). Testing → Task 4.
- **Type consistency:** `useAssistant()` shape (`openAndAsk`/`pendingPrompt`/`clearPending`) defined Task 1, consumed Tasks 2 & 3; `run("tanya", input, file)` matches ChatDock's existing `run(runMode, input, file)` signature.
- **Verify-during-impl:** confirm the `run` function name/signature and that `setMode`/`setMobileOpen`/`setMessages` exist as written (grounded from ChatDock lines 122–337); confirm `Message` user shape `{ role: "user", content: string }` (matches `send`'s own `setMessages` on line 335).
