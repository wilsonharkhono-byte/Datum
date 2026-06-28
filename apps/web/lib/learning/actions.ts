"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";

export type LearningActionResult = { ok: true } | { ok: false; error: string };

export async function applyLearnedDuration(args: { code: string; days: number }): Promise<LearningActionResult> {
  const staff = await getCurrentStaff();
  if (!staff || !canManageAccess(staff)) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("apply_learned_duration", {
      p_code: args.code, p_typical_duration_days: args.days,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function applyLearnedLeadTime(args: { code: string; days: number }): Promise<LearningActionResult> {
  const staff = await getCurrentStaff();
  if (!staff || !canManageAccess(staff)) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("apply_learned_lead_time", { p_code: args.code, p_lead_time_days: args.days });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
