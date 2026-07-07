import { z } from "zod";
import { GateCodes } from "@datum/types";
import type { CardEvent } from "@datum/db";
import type { DatumClient } from "../client";
import { evaluateGate, RULE_VERSION } from "./readiness-rules";

export const RecomputeInput = z.object({
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
});

export type RecomputeResult =
  | { ok: true; cellsUpdated: number; ruleVersion: number }
  | { ok: false; error: string };

/**
 * Project-wide recompute of every (area, gate) cell from card_events.
 *
 * STICKY-PASSED: cells where status='passed' AND actual_end_date IS NOT NULL are
 * human decisions — recompute never clobbers their status/blocking_reason. Only
 * readiness_score/last_recomputed_at/stale are refreshed for those cells.
 *
 * Web wrapper (apps/web/lib/gates/recompute.ts) adds auth guard + revalidatePath.
 * Mobile calls this directly; react-query invalidation handles cache refresh.
 *
 * NOTE: recomputeProjectGates is NOT a "use server" export in core — it is the
 * extracted query body. The web "use server" file wraps it; mobile calls directly.
 *
 * opts.skipAuthCheck: system/background callers (e.g. the Next `after()` hook
 * that fires post-inference using the service-role admin client) have no
 * end-user session to check — the admin client already bypasses RLS by design,
 * so the getUser() guard would always fail there. Only pass this from trusted
 * server-only call sites (never from a request path driven by end-user input).
 */
export async function recomputeProjectGates(
  sb: DatumClient,
  projectId:   string,
  projectCode: string,
  opts?: { skipAuthCheck?: boolean },
): Promise<RecomputeResult> {
  if (!opts?.skipAuthCheck) {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return { ok: false, error: "Sesi tidak ditemukan" };
  }

  // 1. Load all areas for the project
  const { data: areas, error: aErr } = await sb
    .from("areas").select("id").eq("project_id", projectId);
  if (aErr) return { ok: false, error: aErr.message };
  if (!areas || areas.length === 0) {
    return { ok: true, cellsUpdated: 0, ruleVersion: RULE_VERSION };
  }

  // 2. For each area, fetch card_events on cards linked to that area
  //    Two-step query for type clarity
  const { data: cardLinks, error: clErr } = await sb
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
    const { data: events, error: eErr } = await sb
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

  // 2b. A gate the PM manually confirmed is a human decision, NOT a derived
  //     value — recompute must never clobber it back to a rule-computed state,
  //     or the next gate-relevant card_event (which triggers a recompute)
  //     would silently "un-pass" the gate. `actual_end_date IS NOT NULL` alone
  //     marks a cell sticky (not status+date): a cell that previously got its
  //     status clobbered while keeping its date is wedged — treating the date
  //     as the source of truth lets the upsert below restore status='passed'
  //     and self-heal it. Bookkeeping (score/last_recomputed_at/stale) still
  //     refreshes for diagnostics.
  const { data: passedCells, error: pErr } = await sb
    .from("area_gate_status")
    .select("area_id, gate_code")
    .eq("project_id", projectId)
    .not("actual_end_date", "is", null);
  if (pErr) return { ok: false, error: pErr.message };
  const stickyPassed = new Set(
    (passedCells ?? []).map((c) => `${c.area_id}|${c.gate_code}`),
  );

  // 3. For each (area, gate), evaluate the rule and write area_gate_status
  const now = new Date().toISOString();
  let cellsUpdated = 0;
  for (const area of areas) {
    const areaCardIds = cardsByArea.get(area.id) ?? [];
    const areaEvents = areaCardIds.flatMap((cid) => eventsByCard.get(cid) ?? []);
    for (const gate of GateCodes) {
      const result = evaluateGate(gate, { events: areaEvents });
      const isSticky = stickyPassed.has(`${area.id}|${gate}`);

      if (isSticky) {
        // Restore/hold the human decision (self-heals wedged cells) and
        // refresh bookkeeping. blocking_reason left untouched.
        const { error: uErr } = await sb.from("area_gate_status").upsert({
          project_id:         projectId,
          area_id:            area.id,
          gate_code:          gate,
          status:             "passed",
          readiness_score:    result.readinessScore,
          last_recomputed_at: now,
          stale:              false,
        }, { onConflict: "project_id,area_id,gate_code" });
        if (uErr) return { ok: false, error: `${gate}/${area.id}: ${uErr.message}` };
        cellsUpdated++;
        continue;
      }

      // Non-sticky: guarded UPDATE so a pass confirmed *after* the sticky set
      // was read (mid-recompute) can't be clobbered — the actual_end_date
      // predicate re-checks at write time.
      const { data: updRows, error: updErr } = await sb
        .from("area_gate_status")
        .update({
          status:             result.status,
          blocking_reason:    result.blockingReason,
          readiness_score:    result.readinessScore,
          last_recomputed_at: now,
          stale:              false,
        })
        .eq("project_id", projectId)
        .eq("area_id", area.id)
        .eq("gate_code", gate)
        .is("actual_end_date", null)
        .select("area_id");
      if (updErr) return { ok: false, error: `${gate}/${area.id}: ${updErr.message}` };
      if ((updRows ?? []).length === 0) {
        // Either the row doesn't exist yet (first recompute for this cell) or
        // a pass landed mid-recompute. ignoreDuplicates inserts the former and
        // leaves the latter completely untouched.
        const { error: insErr } = await sb.from("area_gate_status").upsert({
          project_id:         projectId,
          area_id:            area.id,
          gate_code:          gate,
          status:             result.status,
          blocking_reason:    result.blockingReason,
          readiness_score:    result.readinessScore,
          last_recomputed_at: now,
          stale:              false,
        }, { onConflict: "project_id,area_id,gate_code", ignoreDuplicates: true });
        if (insErr) return { ok: false, error: `${gate}/${area.id}: ${insErr.message}` };
      }
      cellsUpdated++;
    }
  }

  // NOTE: projectCode is accepted so the web wrapper can call revalidatePath
  // without re-fetching it. This function does not revalidate — that's web-only.
  void projectCode;

  return { ok: true, cellsUpdated, ruleVersion: RULE_VERSION };
}
