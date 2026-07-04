import type { DatumClient } from "../client";
import type { Staff } from "@datum/db";

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

/** Trimmed current-staff shape (the `require-role` flavor). Null ONLY when not
    signed in or no staff row exists yet (orphan auth user). A failed staff
    read THROWS — callers treat null as "orphan, sign out", so conflating a
    transient error with no-row force-logged-out mobile users in the field. */
export async function getCurrentStaff(supabase: DatumClient): Promise<CurrentStaff | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("staff")
    .select("id, full_name, role, email")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`[db] auth.currentStaff: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    full_name: data.full_name,
    role: data.role as StaffRole,
    email: data.email,
  };
}

/** Full staff row (the `get-current-user` flavor). Same contract: null =
    logged out / no row; a failed read throws. */
export async function getCurrentStaffRow(supabase: DatumClient): Promise<Staff | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("staff").select("*").eq("id", user.id).single();
  // PGRST116 = no row (orphan auth user) — that one is a legitimate null.
  if (error && error.code !== "PGRST116") throw new Error(`[db] auth.currentStaffRow: ${error.message}`);
  return data ?? null;
}

/** True when the caller may manage project access + invite new staff. */
export function canManageAccess(staff: CurrentStaff | null): staff is CurrentStaff {
  if (!staff) return false;
  return staff.role === "principal" || staff.role === "admin";
}

/** Pure role-only predicate — no full staff object needed.
    Used by createProject (caller-injected pattern) so core stays server-free. */
export function canManageRole(role: StaffRole): boolean {
  return role === "principal" || role === "admin";
}
