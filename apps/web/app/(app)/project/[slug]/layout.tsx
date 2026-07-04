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
      {children}
      {project ? <ChatDock projectId={project.id} projectCode={project.project_code} /> : null}
    </AssistantProvider>
  );
}
