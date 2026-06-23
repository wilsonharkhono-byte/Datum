import { z } from "zod";
import type { DatumClient } from "../client";
import { AREA_TYPES } from "./extract";

// Apply an AI area proposal the user has reviewed + trimmed in the UI.
//
// Security: SESSION client only (never service role). RLS enforces project
// membership on every insert — areas_insert and card_areas_insert both gate on
// membership. Defense in depth: the caller should also verify the user is
// signed-in before calling (web does this in the server action wrapper).

const ApproveAreaSchema = z.object({
  areaCode: z.string().min(1).max(40),
  areaName: z.string().min(1).max(120),
  floor: z.string().max(40).nullish(),
  areaType: z.enum(AREA_TYPES),
});

const ApproveAssignmentSchema = z.object({
  cardId: z.string().uuid(),
  areaCode: z.string().min(1).max(40),
});

export const ApplyAreaProposalInput = z.object({
  projectId: z.string().uuid(),
  // Areas the user kept (new ones to insert; existing codes are skipped).
  areas: z.array(ApproveAreaSchema).max(200),
  // Card→area links the user kept.
  assignments: z.array(ApproveAssignmentSchema).max(2000),
});

export type ApplyAreaProposalInputType = z.input<typeof ApplyAreaProposalInput>;

export type ApplyAreaProposalResult =
  | { ok: true; createdAreas: number; linkedCards: number }
  | { ok: false; error: string };

/**
 * Idempotently apply an AI-generated area proposal:
 *  1. Insert new areas (skip codes that already exist).
 *  2. Upsert card_areas links (ignore-on-conflict for existing pairs).
 *
 * `sb` must be a session (anon) client — RLS enforces project membership.
 * Returns counts of newly created areas and linked cards.
 */
export async function applyAreaProposal(
  sb: DatumClient,
  rawInput: ApplyAreaProposalInputType,
): Promise<ApplyAreaProposalResult> {
  let input: z.infer<typeof ApplyAreaProposalInput>;
  try {
    input = ApplyAreaProposalInput.parse(rawInput);
  } catch {
    return { ok: false, error: "Data usulan tidak valid" };
  }

  // Membership gate: confirm the caller can read this project. RLS returns no
  // row otherwise. Never trust the client to have checked.
  const { data: project, error: projErr } = await sb
    .from("projects")
    .select("id")
    .eq("id", input.projectId)
    .maybeSingle();
  if (projErr) return { ok: false, error: "Gagal memverifikasi proyek" };
  if (!project) {
    return { ok: false, error: "Tidak punya akses ke proyek ini" };
  }

  // ── 1. Load existing areas to skip duplicates + map codes → ids. ───────────
  const { data: existingRows, error: existErr } = await sb
    .from("areas")
    .select("id, area_code, sort_order")
    .eq("project_id", input.projectId);
  if (existErr) return { ok: false, error: existErr.message };

  const codeToId = new Map<string, string>();
  let maxSort = -1;
  for (const row of existingRows ?? []) {
    codeToId.set(row.area_code, row.id);
    if (typeof row.sort_order === "number" && row.sort_order > maxSort) {
      maxSort = row.sort_order;
    }
  }

  // ── 2. Insert new areas (skip codes that already exist). ───────────────────
  // Dedupe the requested area list by code first (the UI shouldn't send dupes,
  // but be defensive — UNIQUE(project_id, area_code) would 23505 otherwise).
  const seenRequested = new Set<string>();
  const toInsert: Array<{
    project_id: string;
    area_code: string;
    area_name: string;
    floor: string | null;
    area_type: (typeof AREA_TYPES)[number];
    sort_order: number;
  }> = [];
  let nextSort = maxSort + 1;
  for (const a of input.areas) {
    if (codeToId.has(a.areaCode)) continue; // already exists, reuse it
    if (seenRequested.has(a.areaCode)) continue; // dup within the request
    seenRequested.add(a.areaCode);
    toInsert.push({
      project_id: input.projectId,
      area_code: a.areaCode,
      area_name: a.areaName,
      floor: a.floor?.trim() ? a.floor.trim() : null,
      area_type: a.areaType,
      sort_order: nextSort++,
    });
  }

  let createdAreas = 0;
  if (toInsert.length > 0) {
    const { data: inserted, error: insErr } = await sb
      .from("areas")
      .insert(toInsert)
      .select("id, area_code");
    if (insErr) {
      // 42501 = RLS denial. Surface clearly so we know if a migration is needed.
      if (insErr.code === "42501") {
        return {
          ok: false,
          error: "Tidak diizinkan menambah area (RLS). Hubungi admin.",
        };
      }
      return { ok: false, error: insErr.message };
    }
    for (const row of inserted ?? []) {
      codeToId.set(row.area_code, row.id);
      createdAreas++;
    }
  }

  // ── 3. Insert card_areas links (ignore-on-conflict for existing pairs). ────
  // Build (card_id, area_id) rows; drop any assignment whose area_code didn't
  // resolve (shouldn't happen — the UI only sends codes present in `areas`).
  const seenPairs = new Set<string>();
  const linkRows: Array<{ card_id: string; area_id: string }> = [];
  for (const asg of input.assignments) {
    const areaId = codeToId.get(asg.areaCode);
    if (!areaId) continue;
    const pairKey = `${asg.cardId}:${areaId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    linkRows.push({ card_id: asg.cardId, area_id: areaId });
  }

  let linkedCards = 0;
  if (linkRows.length > 0) {
    // upsert with ignoreDuplicates: existing (card_id, area_id) pairs are
    // silently skipped (composite PK). The card_areas insert trigger marks the
    // affected gate cells stale — correct; the user recomputes afterwards.
    const { data: linked, error: linkErr } = await sb
      .from("card_areas")
      .upsert(linkRows, { onConflict: "card_id,area_id", ignoreDuplicates: true })
      .select("card_id");
    if (linkErr) {
      if (linkErr.code === "42501") {
        return {
          ok: false,
          error: "Tidak diizinkan menautkan kartu ke area (RLS). Hubungi admin.",
        };
      }
      return { ok: false, error: linkErr.message };
    }
    linkedCards = (linked ?? []).length;
  }

  return { ok: true, createdAreas, linkedCards };
}
