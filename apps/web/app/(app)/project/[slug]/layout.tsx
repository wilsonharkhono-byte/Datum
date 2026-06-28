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
