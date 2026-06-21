"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { instantiateAreaSteps, writePlannedDates } from "@/lib/steps/mutations";

const AREA_TYPES = [
  "bathroom",
  "kitchen",
  "bedroom",
  "living",
  "dining",
  "garden",
  "circulation",
  "utility",
  "general",
] as const;

export type AreaMutationResult = { ok: true } | { ok: false; error: string };

// Coerce a possibly-empty FormData entry to a trimmed string or undefined.
function optStr(v: FormDataEntryValue | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length === 0 ? undefined : s;
}

// Coerce a possibly-empty FormData entry to a number or undefined.
function optNum(v: FormDataEntryValue | null): number | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (s.length === 0) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const CreateInput = z.object({
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  areaCode:    z.string().min(1, "Kode area wajib").max(40),
  areaName:    z.string().min(1, "Nama area wajib").max(120),
  floor:       z.string().max(40).optional(),
  areaType:    z.enum(AREA_TYPES),
  areaSqm:     z.number().nonnegative().max(99999.99).optional(),
});

export async function createArea(formData: FormData): Promise<AreaMutationResult> {
  let input;
  try {
    input = CreateInput.parse({
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      areaCode:    formData.get("areaCode"),
      areaName:    formData.get("areaName"),
      floor:       optStr(formData.get("floor")),
      areaType:    formData.get("areaType"),
      areaSqm:     optNum(formData.get("areaSqm")),
    });
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Form tidak valid";
    return { ok: false, error: msg ?? "Form tidak valid" };
  }

  // Any project member may add an area. The areas_insert RLS policy gates on
  // project membership; deletion stays principal/admin-only (see deleteArea).
  const caller = await getCurrentStaff();
  if (!caller) {
    return { ok: false, error: "Harus masuk untuk mengubah area" };
  }
  const supabase = await createSupabaseServerClient();

  // Append to end: find current max sort_order in this project.
  const { data: maxRow } = await supabase
    .from("areas")
    .select("sort_order")
    .eq("project_id", input.projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? -1) + 1;

  const { data: created, error } = await supabase
    .from("areas")
    .insert({
      project_id: input.projectId,
      area_code:  input.areaCode,
      area_name:  input.areaName,
      floor:      input.floor ?? null,
      area_type:  input.areaType,
      area_sqm:   input.areaSqm ?? null,
      sort_order: nextSort,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Kode area "${input.areaCode}" sudah ada di proyek ini` };
    }
    return { ok: false, error: error.message };
  }

  // best-effort: instantiate Gate B steps for bathrooms (never blocks area creation)
  if (created && input.areaType === "bathroom") {
    try {
      await instantiateAreaSteps(supabase, created.id);
      await writePlannedDates(supabase, created.id);
    } catch (e) {
      console.warn("[steps] instantiation failed:", (e as Error).message);
    }
  }

  revalidatePath(`/project/${input.projectCode}/settings`);
  revalidatePath(`/project/${input.projectCode}/schedule`);
  return { ok: true };
}

const UpdateInput = z.object({
  areaId:      z.string().uuid(),
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  areaCode:    z.string().min(1, "Kode area wajib").max(40),
  areaName:    z.string().min(1, "Nama area wajib").max(120),
  floor:       z.string().max(40).optional(),
  areaType:    z.enum(AREA_TYPES),
  areaSqm:     z.number().nonnegative().max(99999.99).optional(),
  sortOrder:   z.number().int().min(0).max(99999).optional(),
});

export async function updateArea(formData: FormData): Promise<AreaMutationResult> {
  let input;
  try {
    input = UpdateInput.parse({
      areaId:      formData.get("areaId"),
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      areaCode:    formData.get("areaCode"),
      areaName:    formData.get("areaName"),
      floor:       optStr(formData.get("floor")),
      areaType:    formData.get("areaType"),
      areaSqm:     optNum(formData.get("areaSqm")),
      sortOrder:   optNum(formData.get("sortOrder")),
    });
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Form tidak valid";
    return { ok: false, error: msg ?? "Form tidak valid" };
  }

  // Project members may edit areas; deletion stays principal/admin-only.
  const caller = await getCurrentStaff();
  if (!caller) {
    return { ok: false, error: "Harus masuk untuk mengubah area" };
  }
  const supabase = await createSupabaseServerClient();

  const patch: {
    area_code: string;
    area_name: string;
    floor: string | null;
    area_type: (typeof AREA_TYPES)[number];
    area_sqm: number | null;
    sort_order?: number;
  } = {
    area_code: input.areaCode,
    area_name: input.areaName,
    floor:     input.floor ?? null,
    area_type: input.areaType,
    area_sqm:  input.areaSqm ?? null,
  };
  if (typeof input.sortOrder === "number") patch.sort_order = input.sortOrder;

  const { error } = await supabase
    .from("areas")
    .update(patch)
    .eq("id", input.areaId)
    .eq("project_id", input.projectId);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Kode area "${input.areaCode}" sudah ada di proyek ini` };
    }
    return { ok: false, error: error.message };
  }

  // best-effort: (re)instantiate Gate B steps for bathrooms when area_type/finish set
  if (input.areaType === "bathroom") {
    try {
      await instantiateAreaSteps(supabase, input.areaId);
      await writePlannedDates(supabase, input.areaId);
    } catch (e) {
      console.warn("[steps] re-instantiation failed:", (e as Error).message);
    }
  }

  revalidatePath(`/project/${input.projectCode}/settings`);
  revalidatePath(`/project/${input.projectCode}/schedule`);
  return { ok: true };
}

const DeleteInput = z.object({
  areaId:      z.string().uuid(),
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
});

export async function deleteArea(formData: FormData): Promise<AreaMutationResult> {
  let input;
  try {
    input = DeleteInput.parse({
      areaId:      formData.get("areaId"),
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) {
    return { ok: false, error: "Hanya principal atau admin yang bisa mengubah daftar area" };
  }
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("areas")
    .delete()
    .eq("id", input.areaId)
    .eq("project_id", input.projectId);
  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        error: "Area tidak bisa dihapus karena masih terkait dengan kartu atau status gate.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/project/${input.projectCode}/settings`);
  revalidatePath(`/project/${input.projectCode}/schedule`);
  return { ok: true };
}

const ReorderInput = z.object({
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  areaIds:     z.array(z.string().uuid()).min(1).max(200),
});

export async function reorderAreas(formData: FormData): Promise<AreaMutationResult> {
  let parsed;
  try {
    const raw = String(formData.get("areaIds") ?? "[]");
    const ids = JSON.parse(raw);
    parsed = ReorderInput.parse({
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      areaIds:     ids,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  // Project members may reorder areas; deletion stays principal/admin-only.
  const caller = await getCurrentStaff();
  if (!caller) {
    return { ok: false, error: "Harus masuk untuk mengubah area" };
  }
  const supabase = await createSupabaseServerClient();

  // Atomic renumber via SQL function — see 20260605000002_reorder_areas_rpc.
  // A single statement avoids the partial-failure window where the first K
  // rows were renumbered and the rest still had stale sort_order values.
  // Cast is needed until @datum/db types are regenerated against the new RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)("reorder_project_areas", {
    p_project_id: parsed.projectId,
    p_area_ids:   parsed.areaIds,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${parsed.projectCode}/settings`);
  revalidatePath(`/project/${parsed.projectCode}/schedule`);
  return { ok: true };
}
