import type { ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AssistantProvider } from "@/components/chat/AssistantProvider";
import { ChatDock } from "@/components/chat/ChatDock";
import { BriefDigestSeed } from "@/components/brief/BriefDigestSeed";
import { getTodaysDigestCandidates } from "@/lib/notifications/queries";
import { findTodaysUnreadDigest } from "@/lib/assistant/daily-brief";
import { jakartaToday } from "@/lib/assistant/retrieval";

/**
 * /brief-scoped layout (mirrors project/[slug]/layout.tsx's pattern) —
 * Phase 3 Task 5: mounts the assistant dock in its PORTFOLIO variant (no
 * projectId/projectCode — ChatDock treats that as cross-project mode, see
 * ChatDock.tsx's docstring). Scoped to just this route (not the shared
 * (app)/layout.tsx) so project pages keep their own project-scoped dock
 * unchanged — the two never both mount on the same page.
 *
 * Also completes Task 4's deferred wiring: server-fetches today's still-unread
 * daily-digest notification (if any) for the current user and hands its text
 * to BriefDigestSeed, which seeds the dock with it as an assistant-authored
 * first message on mount. Best-effort — a query failure degrades to no seed
 * (the page still renders; the user can still open the dock and ask
 * manually), matching this codebase's other retrieval degrade-to-"" patterns.
 */
export default async function BriefLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();

  const today = jakartaToday();
  const todayStartIso = new Date(`${today}T00:00:00+07:00`).toISOString();
  const tomorrow = new Date(new Date(todayStartIso).getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStartIso = tomorrow.toISOString();

  const digestText = await getTodaysDigestCandidates(supabase, todayStartIso, tomorrowStartIso)
    .then((rows) => findTodaysUnreadDigest(rows, todayStartIso, tomorrowStartIso))
    .catch(() => null);

  return (
    <AssistantProvider>
      <BriefDigestSeed digestText={digestText} />
      {children}
      <ChatDock />
    </AssistantProvider>
  );
}
