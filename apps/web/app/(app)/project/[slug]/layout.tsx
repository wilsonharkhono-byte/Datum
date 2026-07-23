import type { ReactNode } from "react";
import { getProjectBySlug } from "@datum/core";
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
  // Fail-soft: the dock is auxiliary — a failed lookup must not 500 the
  // whole project section, but it should be visible in logs.
  const project = await getProjectBySlug(supabase, slug).catch((e) => {
    console.error(`[layout] project lookup failed for ${slug}: ${(e as Error).message}`);
    return null;
  });

  return (
    <AssistantProvider>
      {/* The page scrolls in its own column so the assistant dock stays
          pinned to the bottom of the viewport on every project screen —
          long pages (card viewer, schedule) must not bury it below the
          fold, especially on phones. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {project ? <ChatDock projectId={project.id} projectCode={project.project_code} /> : null}
      </div>
    </AssistantProvider>
  );
}
