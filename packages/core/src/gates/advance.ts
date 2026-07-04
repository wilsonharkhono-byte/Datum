import { z } from "zod";
import { GateCodes } from "@datum/types";
import type { DatumClient } from "../client";

/**
 * R3 — Gate advance by confirmation, not bookkeeping.
 *
 * `markGatePassed` flips a single area_gate_status cell to `passed` + writes
 * `actual_end_date`. The Lampiran-A checkpoint templates are surfaced at
 * confirm-time as a skippable reminder; ticking never blocks the pass.
 *
 * Security model: SESSION client under RLS (never service-role); auth +
 * project-membership double-checked server-side; zod on every input; and a
 * server-side state guard so only a cell the engine already considers
 * advanceable can be passed.
 *
 * Web wrapper (apps/web/lib/gates/advance.ts) adds getCurrentStaff() + revalidatePath.
 * Mobile calls this function directly with the staffId from the session.
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
  sb: DatumClient,
  gateCode: string,
): Promise<GateCheckpoint[]> {
  const code = (GateCodes as readonly string[]).includes(gateCode) ? gateCode : null;
  if (!code) return [];

  const { data } = await sb
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

export const MarkGatePassedInput = z.object({
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
export const ADVANCEABLE = new Set(["ready_for_handoff", "in_progress"]);

export async function markGatePassed(
  sb: DatumClient,
  staffId: string,
  raw: MarkGatePassedInput,
): Promise<MarkGatePassedResult> {
  // 1. Validate input.
  let input;
  try {
    input = MarkGatePassedInput.parse(raw);
  } catch {
    return { ok: false, error: "Data tidak valid" };
  }

  // 2. Membership + state guard in one read — fetch the whole area's row set so
  //    the predecessor check below costs no extra round-trip. RLS already
  //    restricts these rows to projects the caller can read; the explicit
  //    project_id filter + the not-found check below turn "no access" and
  //    "wrong project" into the same safe rejection (never trust the client's
  //    projectId).
  const { data: areaCells, error: cellErr } = await sb
    .from("area_gate_status")
    .select("gate_code, status, actual_end_date, project_id")
    .eq("project_id", input.projectId)
    .eq("area_id", input.areaId);
  if (cellErr) return { ok: false, error: cellErr.message };
  const cell = (areaCells ?? []).find((c) => c.gate_code === input.gateCode);
  if (!cell) {
    return { ok: false, error: "Gate tidak ditemukan atau tidak punya akses" };
  }

  // 3. State guard: never silently pass a blocked / not_started cell, and treat
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

  // 3b. Predecessor guard: gates are a sequence (A→H) — passing gate N with
  //     gate N-1 not passed would render sequence-valid progress that isn't.
  //     Walk back past not_applicable gates; the nearest applicable
  //     predecessor must be passed. A missing row counts as not_started.
  //     (DB-level enforcement can follow as a trigger; this closes the gap
  //     for both web and mobile, which share this function.)
  const byGate = new Map((areaCells ?? []).map((c) => [c.gate_code, c]));
  const gateIdx = GateCodes.indexOf(input.gateCode);
  for (let i = gateIdx - 1; i >= 0; i--) {
    const prevCode = GateCodes[i]!;
    const prev = byGate.get(prevCode);
    if (prev?.status === "not_applicable") continue; // skip over — walk further back
    const prevPassed = prev != null && (prev.status === "passed" || prev.actual_end_date != null);
    if (!prevPassed) {
      return {
        ok: false,
        error: `Gate ${prevCode} belum selesai — gate harus diselesaikan berurutan`,
      };
    }
    break; // nearest applicable predecessor is passed — sequence holds
  }

  const completedDate =
    input.completedDate ?? new Date().toISOString().slice(0, 10);

  // 4. Write the confirmation. Guard the UPDATE with the same not-yet-passed
  //    predicate so two racing confirms can't both win. RLS authorizes it.
  const { data: updated, error: updErr } = await sb
    .from("area_gate_status")
    .update({
      status: "passed",
      actual_end_date: completedDate,
      current_owner_id: staffId,
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

  // 5. Best-effort: persist any ticked checkpoint items as passed. This is a
  //    per-item audit trail. Failure here NEVER fails the pass — the checklist
  //    is a reminder, not a gate.
  if (input.checkedTemplateIds && input.checkedTemplateIds.length > 0) {
    const passedAt = new Date().toISOString();
    const rows = input.checkedTemplateIds.map((templateId) => ({
      project_id: input.projectId,
      area_id: input.areaId,
      gate_code: input.gateCode,
      template_id: templateId,
      status: "passed" as const,
      passed_by_staff_id: staffId,
      passed_at: passedAt,
    }));
    // onConflict on the natural key avoids dupes if confirmed twice. The gate
    // pass itself already succeeded so don't fail it — but a lost checkpoint
    // audit trail must at least be visible in logs.
    const { error: cpErr } = await sb
      .from("area_gate_checkpoints")
      .upsert(rows, { onConflict: "project_id,area_id,gate_code,template_id" });
    if (cpErr) {
      console.error(`[gates] markGatePassed: checkpoint rows not recorded for area ${input.areaId} gate ${input.gateCode}: ${cpErr.message}`);
    }
  }

  // NOTE: Web wrapper (apps/web/lib/gates/advance.ts) calls revalidatePath after
  // this returns. Mobile does not need revalidatePath — react-query invalidation
  // handles cache refresh.

  return { ok: true, completedDate };
}
