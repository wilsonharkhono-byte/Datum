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
import { writePlannedDates } from "@/lib/steps/mutations";

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

/**
 * Recompute kickoff-derived gate windows (area_gate_status.target_start_date/
 * target_end_date, via the compute_project_schedule SQL fn) AND cascade them
 * onto area_steps.planned_start/planned_end (writePlannedDates) for every area
 * in the project.
 *
 * Part B fix: previously nothing in the app called compute_project_schedule
 * outside the projects.kickoff_date DB trigger, and writePlannedDates only ran
 * for bathrooms at area-create/update time — so any project whose areas
 * predate a kickoff_date being set (or whose target windows were never
 * derived for any other reason) was stuck with target_start_date/
 * target_end_date AND area_steps.planned_* universally null, which made
 * readiness signals (lib/steps/signals.ts, lead-time based) mathematically
 * unable to fire. This is the one-shot backfill path for existing areas —
 * wired to the schedule page's "Hitung ulang jadwal" button below.
 *
 * Overwrite semantics: the underlying SQL function `compute_project_schedule`
 * (packages/db/supabase/migrations/20260601000019_compute_area_gate_schedule.sql)
 * unconditionally RECOMPUTES AND OVERWRITES target_start_date/target_end_date
 * for every (area, gate) row in the project on every call — `on conflict
 * (project_id, area_id, gate_code) do update set target_start_date =
 * excluded.target_start_date, target_end_date = excluded.target_end_date`,
 * no `where` guard, no check for prior manual edits. This is harmless today
 * because nothing else ever writes those two columns — the PM-editable
 * `areas.target_date` is a separate overlay column (see setAreaTargetDate /
 * overlayAreaTargetDates) that this recompute does not touch and is not
 * touched by. If a per-cell gate-target editor is ever added (i.e. something
 * starts writing area_gate_status.target_start_date/target_end_date directly
 * outside this recompute), this call must become conditional — e.g. an `on
 * conflict ... do update ... where area_gate_status.target_start_date is
 * null` guard in the migration, or an equivalent check here before invoking
 * the RPC — or it will silently clobber that manual edit on the next click.
 */
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
    // Cascade the freshly-computed gate windows onto area_steps.planned_*.
    // Best-effort per area — one area's step-template gap must not abort the
    // whole project's backfill.
    const { data: areas } = await supabase
      .from("areas").select("id").eq("project_id", input.projectId);
    for (const area of areas ?? []) {
      try {
        await writePlannedDates(supabase, area.id);
      } catch (e) {
        console.warn(`[schedule] writePlannedDates failed for area ${area.id}:`, (e as Error).message);
      }
    }
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
