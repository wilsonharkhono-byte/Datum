import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Area } from "@datum/db";

export async function getProjectAreas(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<Area[]> {
  const { data, error } = await supabase
    .from("areas")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("area_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Area[];
}
