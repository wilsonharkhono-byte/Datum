import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff as coreGetCurrentStaff } from "@datum/core";

export type { StaffRole, CurrentStaff } from "@datum/core";
export { canManageAccess } from "@datum/core";

/**
 * Loads the current staff row for the signed-in user. Returns null if the
 * caller is not signed in or has no staff row yet (edge: orphan auth user).
 */
export async function getCurrentStaff() {
  const supabase = await createSupabaseServerClient();
  return coreGetCurrentStaff(supabase);
}
