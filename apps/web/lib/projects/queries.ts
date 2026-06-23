import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getProjectsList as coreGetProjectsList, getDevelopments } from "@datum/core";

export type { ProjectListItem, DevelopmentOption } from "@datum/core";

export function getProjectsList(supabase: SupabaseClient<Database>) {
  return coreGetProjectsList(supabase, process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}

export { getDevelopments };
