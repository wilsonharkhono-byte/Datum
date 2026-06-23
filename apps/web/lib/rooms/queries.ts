// Thin wrapper — source of truth moved to @datum/core.
// Web injects the server Supabase client; core handles the query.
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getProjectRooms as coreGetProjectRooms } from "@datum/core";

export type { Room, ProjectRooms } from "@datum/core";

/**
 * Web-side wrapper: injects the server Supabase client and delegates to core.
 */
export async function getProjectRooms(slug: string) {
  const supabase = await createSupabaseServerClient();
  return coreGetProjectRooms(supabase, slug);
}
