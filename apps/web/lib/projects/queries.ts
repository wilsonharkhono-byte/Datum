import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type ProjectListItem = {
  id: string; project_code: string; project_name: string;
  client_name: string | null; location: string | null;
  status: string; target_handover: string | null;
};

export async function getProjectsList(
  supabase: SupabaseClient<Database>,
): Promise<ProjectListItem[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, project_code, project_name, client_name, location, status, target_handover")
    .order("project_code");
  if (error) throw error;
  return (data ?? []) as ProjectListItem[];
}
