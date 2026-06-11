import { createSupabaseServerClient } from "@/lib/supabase/server";

export type StaffRole =
  | "principal"
  | "designer"
  | "pic"
  | "site_supervisor"
  | "admin"
  | "estimator";

export type CurrentStaff = {
  id: string;
  full_name: string;
  role: StaffRole;
  email: string | null;
};

/**
 * Loads the current staff row for the signed-in user. Returns null if the
 * caller is not signed in or has no staff row yet (edge: orphan auth user).
 */
export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("staff")
    .select("id, full_name, role, email")
    .eq("id", user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    full_name: data.full_name,
    role: data.role as StaffRole,
    email: data.email,
  };
}

/** True when the caller may manage project access + invite new staff. */
export function canManageAccess(staff: CurrentStaff | null): staff is CurrentStaff {
  if (!staff) return false;
  return staff.role === "principal" || staff.role === "admin";
}
