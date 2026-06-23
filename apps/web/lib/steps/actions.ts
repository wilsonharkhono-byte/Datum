"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/require-role";
import { updateAreaStep, setCheckpointResult } from "@/lib/steps/mutations";

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
