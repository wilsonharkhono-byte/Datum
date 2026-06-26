"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";

export type LibraryActionResult = { ok: true } | { ok: false; error: string };

async function manager() {
  const staff = await getCurrentStaff();
  return staff && canManageAccess(staff) ? staff : null;
}

export async function updateStandardStep(args: {
  code: string;
  name: string;
  stepType: "decision" | "procurement" | "site_work" | "inspection";
  tradeRole: string | null;
  typicalDurationDays: number;
  leadTimeDays: number;
  appliesToAreaTypes: string[] | null;
  /** Passed through unchanged — the v1 editor does not edit finish-profile conditions, but must NOT wipe them. */
  applicability: Record<string, unknown>;
}): Promise<LibraryActionResult> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang mengubah pustaka" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("update_standard_step", {
      p_code: args.code, p_name: args.name, p_step_type: args.stepType, p_trade_role: args.tradeRole as string,
      p_typical_duration_days: args.typicalDurationDays, p_lead_time_days: args.leadTimeDays,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p_applicability: args.applicability as any, p_applies_to_area_types: args.appliesToAreaTypes ?? [],
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function setStandardStepActive(args: { code: string; active: boolean }): Promise<LibraryActionResult> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("set_standard_step_active", { p_code: args.code, p_active: args.active });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function reorderStandardSteps(args: { gateCode: string; codes: string[] }): Promise<LibraryActionResult> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("reorder_standard_steps", { p_gate_code: args.gateCode, p_codes: args.codes });
    if (error) throw error;
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function addStandardStep(args: {
  gateCode: string;
  name: string;
  stepType: "decision" | "procurement" | "site_work" | "inspection";
  tradeRole: string | null;
  typicalDurationDays: number;
  leadTimeDays: number;
  appliesToAreaTypes: string[] | null;
}): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  if (!(await manager())) return { ok: false, error: "Tidak berwenang" };
  const supabase = await createSupabaseServerClient();
  try {
    const { data, error } = await supabase.rpc("add_standard_step", {
      p_gate_code: args.gateCode, p_name: args.name, p_step_type: args.stepType, p_trade_role: args.tradeRole as string,
      p_typical_duration_days: args.typicalDurationDays, p_lead_time_days: args.leadTimeDays,
      p_applies_to_area_types: args.appliesToAreaTypes ?? [],
    });
    if (error) throw error;
    return { ok: true, code: data as string };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
