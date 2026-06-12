"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GateCodes } from "@datum/types";
import { evaluateGate, RULE_VERSION } from "./readiness-rules";
import type { CardEvent } from "@datum/db";

const RecomputeInput = z.object({
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
});

export type RecomputeResult =
  | { ok: true; cellsUpdated: number; ruleVersion: number }
  | { ok: false; error: string };

export async function recomputeAreaGateStatus(formData: FormData): Promise<RecomputeResult> {
  let input;
  try {
    input = RecomputeInput.parse({
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  return recomputeProjectGates(input.projectId, input.projectCode);
}

/**
 * Project-wide recompute of every (area, gate) cell. Shared by the manual
 * button above and the fire-and-forget trigger after gate-relevant
 * card_event inserts (lib/cards/mutations.ts createCardEvent).
 */
export async function recomputeProjectGates(
  projectId:   string,
  projectCode: string,
): Promise<RecomputeResult> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // 1. Load all areas for the project
  const { data: areas, error: aErr } = await supabase
    .from("areas").select("id").eq("project_id", projectId);
  if (aErr) return { ok: false, error: aErr.message };
  if (!areas || areas.length === 0) {
    return { ok: true, cellsUpdated: 0, ruleVersion: RULE_VERSION };
  }

  // 2. For each area, fetch card_events on cards linked to that area
  //    Two-step query for type clarity
  const { data: cardLinks, error: clErr } = await supabase
    .from("card_areas")
    .select("card_id, area_id, cards!inner(project_id)")
    .eq("cards.project_id", projectId);
  if (clErr) return { ok: false, error: clErr.message };

  const cardsByArea = new Map<string, string[]>();
  for (const link of cardLinks ?? []) {
    const arr = cardsByArea.get(link.area_id) ?? [];
    arr.push(link.card_id);
    cardsByArea.set(link.area_id, arr);
  }

  const allCardIds = Array.from(new Set([...cardsByArea.values()].flat()));
  const eventsByCard = new Map<string, CardEvent[]>();
  if (allCardIds.length > 0) {
    const { data: events, error: eErr } = await supabase
      .from("card_events")
      .select("*")
      .in("card_id", allCardIds);
    if (eErr) return { ok: false, error: eErr.message };
    for (const ev of events ?? []) {
      const arr = eventsByCard.get(ev.card_id) ?? [];
      arr.push(ev);
      eventsByCard.set(ev.card_id, arr);
    }
  }

  // 3. For each (area, gate), evaluate the rule and upsert area_gate_status
  const now = new Date().toISOString();
  let cellsUpdated = 0;
  for (const area of areas) {
    const areaCardIds = cardsByArea.get(area.id) ?? [];
    const areaEvents = areaCardIds.flatMap((cid) => eventsByCard.get(cid) ?? []);
    for (const gate of GateCodes) {
      const result = evaluateGate(gate, { events: areaEvents });
      const { error: uErr } = await supabase.from("area_gate_status").upsert({
        project_id:           projectId,
        area_id:              area.id,
        gate_code:            gate,
        status:               result.status,
        readiness_score:      result.readinessScore,
        blocking_reason:      result.blockingReason,
        last_recomputed_at:   now,
        stale:                false,
      }, { onConflict: "project_id,area_id,gate_code" });
      if (uErr) return { ok: false, error: `${gate}/${area.id}: ${uErr.message}` };
      cellsUpdated++;
    }
  }

  revalidatePath(`/project/${projectCode}/schedule`);
  return { ok: true, cellsUpdated, ruleVersion: RULE_VERSION };
}
