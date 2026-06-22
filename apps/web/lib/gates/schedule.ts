"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getProjectScheduleCells as coreGetProjectScheduleCells,
  getAreaTargetDates as coreGetAreaTargetDates,
  getCardNextDeadline as coreGetCardNextDeadline,
  recomputeProjectSchedule as coreRecomputeProjectSchedule,
} from "@datum/core";

// Re-export types from core so existing web importers are unbroken.
export type { ScheduledCell } from "@datum/core";
export type { NextDeadline } from "@datum/core";

const RecomputeInput = z.object({
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
});

export type ScheduleRecomputeResult =
  | { ok: true; cellsUpdated: number }
  | { ok: false; error: string };

export async function recomputeProjectSchedule(formData: FormData): Promise<ScheduleRecomputeResult> {
  let input;
  try {
    input = RecomputeInput.parse({
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const result = await coreRecomputeProjectSchedule(supabase, input.projectId);
  if (result.ok) {
    revalidatePath(`/project/${input.projectCode}/schedule`);
  }
  return result;
}

export async function getProjectScheduleCells(projectId: string) {
  const supabase = await createSupabaseServerClient();
  return coreGetProjectScheduleCells(supabase, projectId);
}

export async function getAreaTargetDates(projectId: string) {
  const supabase = await createSupabaseServerClient();
  return coreGetAreaTargetDates(supabase, projectId);
}

export async function getCardNextDeadline(cardId: string) {
  const supabase = await createSupabaseServerClient();
  return coreGetCardNextDeadline(supabase, cardId);
}
