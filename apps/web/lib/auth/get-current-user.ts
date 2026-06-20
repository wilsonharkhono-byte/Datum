import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaffRow } from "@datum/core";
import type { Staff } from "@datum/db";

export async function getCurrentStaff(): Promise<Staff | null> {
  const supabase = await createSupabaseServerClient();
  return getCurrentStaffRow(supabase);
}
