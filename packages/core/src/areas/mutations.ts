import { z } from "zod";
import type { DatumClient } from "../client";

// ─── Shared area_type enum ────────────────────────────────────────────────────
// Mirrors packages/db/src/types.generated.ts ("area_type"). Kept inline so
// this module stays import-free from the extract helpers.
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

// ─── createArea ───────────────────────────────────────────────────────────────

export const CreateAreaInput = z.object({
  projectId: z.string().uuid(),
  areaCode: z.string().min(1, "Kode area wajib").max(40),
  areaName: z.string().min(1, "Nama area wajib").max(120),
  floor: z.string().max(40).optional(),
  areaType: z.enum(AREA_TYPES),
  areaSqm: z.number().nonnegative().max(99999.99).optional(),
});

export type CreateAreaInputType = z.input<typeof CreateAreaInput>;

/**
 * Insert a new area at the end of the project's area list.
 * `sb` must be a session (anon) client — RLS on areas_insert enforces project
 * membership. Returns {ok:true} on success or {ok:false,error} on failure.
 */
export async function createArea(
  sb: DatumClient,
  rawInput: CreateAreaInputType,
): Promise<AreaMutationResult> {
  let input: z.infer<typeof CreateAreaInput>;
  try {
    input = CreateAreaInput.parse(rawInput);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Input tidak valid";
    return { ok: false, error: msg ?? "Input tidak valid" };
  }

  // Append to end: find current max sort_order in this project.
  const { data: maxRow } = await sb
    .from("areas")
    .select("sort_order")
    .eq("project_id", input.projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? -1) + 1;

  const { error } = await sb.from("areas").insert({
    project_id: input.projectId,
    area_code: input.areaCode,
    area_name: input.areaName,
    floor: input.floor ?? null,
    area_type: input.areaType,
    area_sqm: input.areaSqm ?? null,
    sort_order: nextSort,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Kode area "${input.areaCode}" sudah ada di proyek ini` };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// ─── updateArea ───────────────────────────────────────────────────────────────

export const UpdateAreaInput = z.object({
  areaId: z.string().uuid(),
  projectId: z.string().uuid(),
  areaCode: z.string().min(1, "Kode area wajib").max(40),
  areaName: z.string().min(1, "Nama area wajib").max(120),
  floor: z.string().max(40).optional(),
  areaType: z.enum(AREA_TYPES),
  areaSqm: z.number().nonnegative().max(99999.99).optional(),
  sortOrder: z.number().int().min(0).max(99999).optional(),
});

export type UpdateAreaInputType = z.input<typeof UpdateAreaInput>;

export async function updateArea(
  sb: DatumClient,
  rawInput: UpdateAreaInputType,
): Promise<AreaMutationResult> {
  let input: z.infer<typeof UpdateAreaInput>;
  try {
    input = UpdateAreaInput.parse(rawInput);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Input tidak valid";
    return { ok: false, error: msg ?? "Input tidak valid" };
  }

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
    floor: input.floor ?? null,
    area_type: input.areaType,
    area_sqm: input.areaSqm ?? null,
  };
  if (typeof input.sortOrder === "number") patch.sort_order = input.sortOrder;

  const { error } = await sb
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

  return { ok: true };
}

// ─── deleteArea ───────────────────────────────────────────────────────────────

export const DeleteAreaInput = z.object({
  areaId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export type DeleteAreaInputType = z.input<typeof DeleteAreaInput>;

export async function deleteArea(
  sb: DatumClient,
  rawInput: DeleteAreaInputType,
): Promise<AreaMutationResult> {
  let input: z.infer<typeof DeleteAreaInput>;
  try {
    input = DeleteAreaInput.parse(rawInput);
  } catch {
    return { ok: false, error: "Input tidak valid" };
  }

  const { error } = await sb
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

  return { ok: true };
}

// ─── reorderAreas ─────────────────────────────────────────────────────────────

export const ReorderAreasInput = z.object({
  projectId: z.string().uuid(),
  areaIds: z.array(z.string().uuid()).min(1).max(200),
});

export type ReorderAreasInputType = z.input<typeof ReorderAreasInput>;

/**
 * Atomically renumber areas via the `reorder_project_areas` SQL RPC.
 * Anon-callable under RLS (project membership check is inside the function).
 */
export async function reorderAreas(
  sb: DatumClient,
  rawInput: ReorderAreasInputType,
): Promise<AreaMutationResult> {
  let input: z.infer<typeof ReorderAreasInput>;
  try {
    input = ReorderAreasInput.parse(rawInput);
  } catch {
    return { ok: false, error: "Input tidak valid" };
  }

  // Cast is needed until @datum/db types are regenerated against the new RPC.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (sb.rpc as any)("reorder_project_areas", {
    p_project_id: input.projectId,
    p_area_ids: input.areaIds,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
