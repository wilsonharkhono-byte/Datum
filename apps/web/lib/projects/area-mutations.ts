"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import {
  createArea as coreCreateArea,
  updateArea as coreUpdateArea,
  deleteArea as coreDeleteArea,
  reorderAreas as coreReorderAreas,
  recomputeProjectSchedule as coreRecomputeProjectSchedule,
  type AreaMutationResult,
} from "@datum/core";
import { instantiateAreaSteps, writePlannedDates } from "@/lib/steps/mutations";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

/**
 * Part B kickoff-fallback: an area's gate windows (area_gate_status.
 * target_start_date/target_end_date) are normally derived by the
 * projects.kickoff_date DB trigger (compute_project_schedule), but that only
 * fires on kickoff_date INSERT/UPDATE — an area created/updated afterward,
 * for a project whose kickoff_date was already set earlier (or never
 * re-triggered for any other reason), can still have no target window at
 * all. Detect that gap here and run compute_project_schedule once before
 * writePlannedDates, so planned_start/planned_end never silently stay null
 * just because of insert ordering. No-ops (cheap) when a target already
 * exists or the project has no kickoff_date yet.
 */
async function ensureGateScheduleForArea(
  supabase: SupabaseClient<Database>,
  projectId: string,
  areaId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("area_gate_status")
    .select("target_start_date")
    .eq("area_id", areaId)
    .not("target_start_date", "is", null)
    .limit(1)
    .maybeSingle();
  if (existing) return; // already scheduled — nothing to backfill

  const { data: project } = await supabase
    .from("projects")
    .select("kickoff_date")
    .eq("id", projectId)
    .maybeSingle();
  if (!project?.kickoff_date) return; // no kickoff yet — nothing to derive from

  await coreRecomputeProjectSchedule(supabase, projectId);
}

// ─── FormData coercions ───────────────────────────────────────────────────────

function optStr(v: FormDataEntryValue | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

function optNum(v: FormDataEntryValue | null): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s.length === 0) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// ─── createArea ───────────────────────────────────────────────────────────────

export async function createArea(formData: FormData): Promise<AreaMutationResult> {
  // Any project member may add an area. The areas_insert RLS policy gates on
  // project membership; deletion stays principal/admin-only (see deleteArea).
  const caller = await getCurrentStaff();
  if (!caller) {
    return { ok: false, error: "Harus masuk untuk mengubah area" };
  }

  const projectCode = String(formData.get("projectCode") ?? "").trim();
  const projectId = String(formData.get("projectId") ?? "");
  const areaCode = String(formData.get("areaCode") ?? "");
  const areaType = String(formData.get("areaType") ?? "");
  const supabase = await createSupabaseServerClient();

  const result = await coreCreateArea(supabase, {
    projectId,
    areaCode,
    areaName: String(formData.get("areaName") ?? ""),
    floor: optStr(formData.get("floor")),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    areaType: areaType as any,
    areaSqm: optNum(formData.get("areaSqm")),
  });

  if (result.ok) {
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}/schedule`);

    // Readiness (Gate B): bathrooms get trade-steps instantiated. Best-effort —
    // never blocks area creation. coreCreateArea doesn't return the new id, so
    // resolve it by the project-unique area_code (RLS already passed above).
    if (areaType === "bathroom") {
      try {
        const { data: created } = await supabase
          .from("areas")
          .select("id")
          .eq("project_id", projectId)
          .eq("area_code", areaCode)
          .maybeSingle();
        if (created) {
          await instantiateAreaSteps(supabase, created.id);
          await ensureGateScheduleForArea(supabase, projectId, created.id);
          await writePlannedDates(supabase, created.id);
        }
      } catch (e) {
        console.warn("[steps] instantiation failed:", (e as Error).message);
      }
    }
  }
  return result;
}

// ─── updateArea ───────────────────────────────────────────────────────────────

export async function updateArea(formData: FormData): Promise<AreaMutationResult> {
  const caller = await getCurrentStaff();
  if (!caller) {
    return { ok: false, error: "Harus masuk untuk mengubah area" };
  }

  const projectCode = String(formData.get("projectCode") ?? "").trim();
  const areaId = String(formData.get("areaId") ?? "");
  const areaType = String(formData.get("areaType") ?? "");
  const supabase = await createSupabaseServerClient();

  const result = await coreUpdateArea(supabase, {
    areaId,
    projectId: String(formData.get("projectId") ?? ""),
    areaCode: String(formData.get("areaCode") ?? ""),
    areaName: String(formData.get("areaName") ?? ""),
    floor: optStr(formData.get("floor")),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    areaType: areaType as any,
    areaSqm: optNum(formData.get("areaSqm")),
    sortOrder: optNum(formData.get("sortOrder")),
  });

  if (result.ok) {
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}/schedule`);

    // best-effort: (re)instantiate Gate B steps for bathrooms when area_type set.
    if (areaType === "bathroom") {
      try {
        await instantiateAreaSteps(supabase, areaId);
        await ensureGateScheduleForArea(supabase, String(formData.get("projectId") ?? ""), areaId);
        await writePlannedDates(supabase, areaId);
      } catch (e) {
        console.warn("[steps] re-instantiation failed:", (e as Error).message);
      }
    }
  }
  return result;
}

// ─── deleteArea ───────────────────────────────────────────────────────────────

export async function deleteArea(formData: FormData): Promise<AreaMutationResult> {
  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) {
    return { ok: false, error: "Hanya principal atau admin yang bisa mengubah daftar area" };
  }

  const projectCode = String(formData.get("projectCode") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  const result = await coreDeleteArea(supabase, {
    areaId: String(formData.get("areaId") ?? ""),
    projectId: String(formData.get("projectId") ?? ""),
  });

  if (result.ok) {
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}/schedule`);
  }
  return result;
}

// ─── reorderAreas ─────────────────────────────────────────────────────────────

export async function reorderAreas(formData: FormData): Promise<AreaMutationResult> {
  const caller = await getCurrentStaff();
  if (!caller) {
    return { ok: false, error: "Harus masuk untuk mengubah area" };
  }

  const projectCode = String(formData.get("projectCode") ?? "").trim();
  const supabase = await createSupabaseServerClient();

  let areaIds: string[];
  try {
    areaIds = JSON.parse(String(formData.get("areaIds") ?? "[]"));
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const result = await coreReorderAreas(supabase, {
    projectId: String(formData.get("projectId") ?? ""),
    areaIds,
  });

  if (result.ok) {
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}/schedule`);
  }
  return result;
}
