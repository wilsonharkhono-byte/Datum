"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/get-current-user";

export type AreaTargetResult = { ok: true } | { ok: false; error: string };

// targetDate: a real ISO calendar date (YYYY-MM-DD) or null to clear (revert
// the area to kickoff-derived dates). z.coerce.date validates it's a real date
// (rejects "2026-13-40" etc.); we re-serialise to YYYY-MM-DD for the date column.
const TargetInput = z.object({
  areaId:    z.string().uuid(),
  projectId: z.string().uuid(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .refine((s) => {
      const d = new Date(`${s}T00:00:00Z`);
      // Round-trip guard: rejects impossible dates like 2026-02-31 that Date
      // would otherwise roll forward.
      return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
    }, "Tanggal tidak valid")
    .nullable(),
});

/**
 * R4 — set (or clear) the honest handover target for a single area.
 * Security: requires an authenticated staff session; verifies the area belongs
 * to the supplied project; writes under the SESSION client so Postgres RLS
 * (current_can_read_project) enforces project membership. Never service-role.
 */
export async function setAreaTargetDate(input: {
  areaId: string;
  projectId: string;
  targetDate: string | null;
}): Promise<AreaTargetResult> {
  let parsed;
  try {
    parsed = TargetInput.parse(input);
  } catch {
    return { ok: false, error: "Input tidak valid" };
  }

  // 1. Auth — must be a known staff member.
  const staff = await getCurrentStaff();
  if (!staff) {
    return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };
  }

  const supabase = await createSupabaseServerClient();

  // 2. Membership / same-project guard. The area must exist and belong to the
  //    project the caller named — prevents flipping an unrelated project's area
  //    by guessing an id. The actual write authorization is RLS below.
  const { data: areaRow } = await supabase
    .from("areas")
    .select("id, project_id")
    .eq("id", parsed.areaId)
    .maybeSingle();
  if (!areaRow) {
    return { ok: false, error: "Area tidak ditemukan" };
  }
  if (areaRow.project_id !== parsed.projectId) {
    return { ok: false, error: "Area tidak termasuk dalam proyek ini" };
  }

  // 3. Project lookup for revalidation paths (and to fail clearly if the
  //    session can't read the project at all).
  const { data: project } = await supabase
    .from("projects")
    .select("project_code")
    .eq("id", parsed.projectId)
    .maybeSingle();
  if (!project) {
    return { ok: false, error: "Proyek tidak ditemukan atau tidak punya akses" };
  }

  // 4. Write under session RLS. If the member lacks write access, RLS makes this
  //    affect 0 rows or error — either way we surface a clean message.
  const { error, data: updated } = await supabase
    .from("areas")
    .update({ target_date: parsed.targetDate })
    .eq("id", parsed.areaId)
    .eq("project_id", parsed.projectId)
    .select("id")
    .maybeSingle();
  if (error) {
    return { ok: false, error: "Gagal menyimpan target. Coba lagi." };
  }
  if (!updated) {
    return { ok: false, error: "Tidak punya izin mengubah area ini" };
  }

  // 5. Re-baselining shifts derived gate windows → refresh schedule + board.
  revalidatePath(`/project/${project.project_code}/schedule`);
  revalidatePath(`/project/${project.project_code}`);
  return { ok: true };
}
