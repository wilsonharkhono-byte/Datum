"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/require-role";
import { updateAreaStep, setCheckpointResult, removeAreaStep, restoreAreaStep } from "@/lib/steps/mutations";

export type StepActionResult = { ok: true } | { ok: false; error: string };

export async function submitStepUpdate(args: {
  areaStepId: string;
  status?: "not_started" | "in_progress" | "blocked" | "done";
  note?: string;
  percentComplete?: number;
}): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk mengubah langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    await updateAreaStep(supabase, { ...args, loggedByStaffId: staff.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function submitCheckpointResult(args: {
  checkpointId: string;
  result: "pending" | "pass" | "fail";
}): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk mengubah checkpoint" };
  const supabase = await createSupabaseServerClient();
  try {
    await setCheckpointResult(supabase, { ...args, checkedByStaffId: staff.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function addCatalogStep(args: { areaId: string; stepCode: string }): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk menambah langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("add_catalog_area_step", { p_area_id: args.areaId, p_step_code: args.stepCode });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function addCustomStep(args: {
  areaId: string;
  name: string;
  stepType: "decision" | "procurement" | "site_work" | "inspection";
  gateCode: string;
}): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk menambah langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    const { error } = await supabase.rpc("add_custom_area_step", {
      p_area_id: args.areaId, p_name: args.name, p_step_type: args.stepType, p_gate_code: args.gateCode,
    });
    if (error) throw error;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function removeStep(args: { areaStepId: string }): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk menghapus langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    await removeAreaStep(supabase, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function restoreStep(args: { areaStepId: string }): Promise<StepActionResult> {
  const staff = await getCurrentStaff();
  if (!staff) return { ok: false, error: "Harus masuk untuk memulihkan langkah" };
  const supabase = await createSupabaseServerClient();
  try {
    await restoreAreaStep(supabase, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
