"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/require-role";
import { GateCodes } from "@datum/types";

/**
 * R3 — Gate advance by confirmation, not bookkeeping.
 *
 * `markGatePassed` flips a single area_gate_status cell to `passed` + writes
 * `actual_end_date`, after the rule engine has already judged it
 * `ready_for_handoff`. The 39 Lampiran-A checkpoint templates are surfaced at
 * confirm-time as a skippable reminder (see getGateCheckpoints); ticked items
 * MAY be persisted to area_gate_checkpoints, but ticking never blocks the pass.
 *
 * Security model: SESSION client under RLS (never service-role); auth +
 * project-membership double-checked server-side; zod on every input; and a
 * server-side state guard so only a cell the engine already considers
 * advanceable can be passed. The confirmed status survives recompute — see
 * lib/gates/recompute.ts (sticky-passed cells).
 */

// ─── getGateCheckpoints: the confirm-time reminder checklist ──────────────────

export type GateCheckpoint = {
  id: string;
  itemText: string;
  required: boolean;
  sortOrder: number;
};

/**
 * The seeded Lampiran-A QA items for one gate (static reference data, safe to
 * read for anyone signed in). Used to render the confirm-sheet reminder list.
 */
export async function getGateCheckpoints(
  gateCode: string,
): Promise<GateCheckpoint[]> {
  const code = (GateCodes as readonly string[]).includes(gateCode) ? gateCode : null;
  if (!code) return [];

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("gate_checkpoint_templates")
    .select("id, item_text, required, sort_order")
    .eq("gate_code", code as (typeof GateCodes)[number])
    .order("sort_order", { ascending: true });

  return (data ?? []).map((r) => ({
    id: r.id,
    itemText: r.item_text,
    required: r.required,
    sortOrder: r.sort_order,
  }));
}

// ─── markGatePassed: the one guarded mutation ─────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MarkGatePassedInput = z.object({
  projectId: z.string().uuid(),
  areaId: z.string().uuid(),
  gateCode: z.enum(GateCodes),
  /** YYYY-MM-DD; defaults to today (server clock) when omitted. */
  completedDate: z
    .string()
    .regex(ISO_DATE, "Tanggal tidak valid")
    .optional(),
  /** Optional: template_ids the user ticked. Persisted best-effort only. */
  checkedTemplateIds: z.array(z.string().uuid()).max(100).optional(),
});

export type MarkGatePassedInput = z.input<typeof MarkGatePassedInput>;

export type MarkGatePassedResult =
  | { ok: true; completedDate: string }
  | { ok: false; error: string };

/** A cell may only be advanced from these states. Re-checked server-side. */
const ADVANCEABLE = new Set(["ready_for_handoff", "in_progress"]);

export async function markGatePassed(
  raw: MarkGatePassedInput,
): Promise<MarkGatePassedResult> {
  // 1. Validate input.
  let input;
  try {
    input = MarkGatePassedInput.parse(raw);
  } catch {
    return { ok: false, error: "Data tidak valid" };
  }

  // 2. Auth: must be signed-in staff.
  const staff = await getCurrentStaff();
  if (!staff) {
    return { ok: false, error: "Harus masuk untuk menandai gate selesai" };
  }

  const supabase = await createSupabaseServerClient();

  // 3. Membership + state guard in one read. RLS already restricts this row to
  //    projects the caller can read; the explicit project_id filter + the
  //    not-found check below turn "no access" and "wrong project" into the
  //    same safe rejection (never trust the client's projectId).
  const { data: cell, error: cellErr } = await supabase
    .from("area_gate_status")
    .select("status, actual_end_date, project_id")
    .eq("project_id", input.projectId)
    .eq("area_id", input.areaId)
    .eq("gate_code", input.gateCode)
    .maybeSingle();
  if (cellErr) return { ok: false, error: cellErr.message };
  if (!cell) {
    return { ok: false, error: "Gate tidak ditemukan atau tidak punya akses" };
  }

  // 4. State guard: never silently pass a blocked / not_started cell, and treat
  //    an already-passed cell as a no-op error (idempotent-safe, no surprise).
  if (cell.status === "passed" || cell.actual_end_date != null) {
    return { ok: false, error: "Gate ini sudah ditandai selesai" };
  }
  if (!ADVANCEABLE.has(cell.status)) {
    return {
      ok: false,
      error: "Gate ini belum siap diselesaikan — masih ada pekerjaan terkait",
    };
  }

  const completedDate =
    input.completedDate ?? new Date().toISOString().slice(0, 10);

  // 5. Write the confirmation. The cell itself is the audit record: who
  //    (current_owner_id), when (actual_end_date + updated_at bumped on UPDATE).
  //    Guard the UPDATE with the same not-yet-passed predicate so two racing
  //    confirms can't both win. RLS (current_can_read_project) authorizes it.
  const { data: updated, error: updErr } = await supabase
    .from("area_gate_status")
    .update({
      status: "passed",
      actual_end_date: completedDate,
      current_owner_id: staff.id,
    })
    .eq("project_id", input.projectId)
    .eq("area_id", input.areaId)
    .eq("gate_code", input.gateCode)
    .is("actual_end_date", null)
    .select("area_id")
    .maybeSingle();
  if (updErr) return { ok: false, error: updErr.message };
  if (!updated) {
    // Lost the race (another confirm landed first) — surface it plainly.
    return { ok: false, error: "Gate ini sudah ditandai selesai" };
  }

  // 6. Best-effort: persist any ticked checkpoint items as passed. This is a
  //    per-item audit trail (passed_by_staff_id + passed_at), RLS-allowed via
  //    area_gate_checkpoints_insert/update. Failure here NEVER fails the pass —
  //    the checklist is a reminder, not a gate.
  if (input.checkedTemplateIds && input.checkedTemplateIds.length > 0) {
    const passedAt = new Date().toISOString();
    const rows = input.checkedTemplateIds.map((templateId) => ({
      project_id: input.projectId,
      area_id: input.areaId,
      gate_code: input.gateCode,
      template_id: templateId,
      status: "passed" as const,
      passed_by_staff_id: staff.id,
      passed_at: passedAt,
    }));
    // onConflict on the natural key avoids dupes if confirmed twice; ignore err.
    await supabase
      .from("area_gate_checkpoints")
      .upsert(rows, { onConflict: "project_id,area_id,gate_code,template_id" });
  }

  // 7. Refresh every surface that reads gate status.
  const { data: proj } = await supabase
    .from("projects")
    .select("project_code")
    .eq("id", input.projectId)
    .maybeSingle();
  const code = proj?.project_code;
  if (code) {
    revalidatePath(`/project/${code}/schedule`);
    revalidatePath(`/project/${code}/rooms`);
    revalidatePath(`/project/${code}`);
  }
  revalidatePath("/brief");

  return { ok: true, completedDate };
}
