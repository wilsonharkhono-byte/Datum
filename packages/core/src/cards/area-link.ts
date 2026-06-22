/**
 * Card ↔ area link operations (read + mutations).
 *
 * Isomorphic — client-injected SupabaseClient; no revalidatePath, no
 * server-only, no Next.js imports. RLS enforces project-scoping.
 *
 * Read: getCardAreas — moved from apps/web/lib/cards/area-link-queries.ts.
 * Mutations: linkCardToArea / unlinkCardFromArea — moved from
 *            apps/web/lib/cards/area-link-mutations.ts, minus FormData parsing
 *            and revalidatePath (those remain in the web server-action wrappers).
 */

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Area } from "@datum/db";

// ─── Result type ──────────────────────────────────────────────────────────────

export type AreaLinkResult = { ok: true } | { ok: false; error: string };

// ─── Input schema ─────────────────────────────────────────────────────────────

export const AreaLinkInput = z.object({
  cardId: z.string().uuid(),
  areaId: z.string().uuid(),
});
export type AreaLinkInputType = z.infer<typeof AreaLinkInput>;

// ─── getCardAreas ─────────────────────────────────────────────────────────────

/**
 * Return all areas currently linked to a card, ordered by areas.sort_order.
 * RLS handles visibility — caller passes a supabase client already scoped to
 * the active session.
 */
export async function getCardAreas(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<Area[]> {
  const { data, error } = await supabase
    .from("card_areas")
    .select("area:area_id (*)")
    .eq("card_id", cardId);
  if (error) throw error;

  const areas = (data ?? [])
    .map((row) => (row as unknown as { area: Area | null }).area)
    .filter((a): a is Area => a !== null);

  areas.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return areas;
}

// ─── linkCardToArea ───────────────────────────────────────────────────────────

/**
 * Link a card to an area.
 *
 * Includes a same-project guard: the DB has no FK constraint that the area
 * belongs to the same project as the card; without this check a cross-project
 * areaId would silently corrupt the gate × area matrix.
 *
 * Treats a unique-constraint conflict (already linked, PG code 23505) as success.
 */
export async function linkCardToArea(
  supabase: SupabaseClient<Database>,
  input: AreaLinkInputType,
): Promise<AreaLinkResult> {
  const parsed = AreaLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Input tidak valid" };
  const { cardId, areaId } = parsed.data;

  const [cardRow, areaRow] = await Promise.all([
    supabase.from("cards").select("project_id").eq("id", cardId).maybeSingle(),
    supabase.from("areas").select("project_id").eq("id", areaId).maybeSingle(),
  ]);

  if (!cardRow.data || !areaRow.data) {
    return { ok: false, error: "Kartu atau area tidak ditemukan" };
  }
  if (cardRow.data.project_id !== areaRow.data.project_id) {
    return { ok: false, error: "Area dan kartu harus berasal dari proyek yang sama" };
  }

  const { error } = await supabase
    .from("card_areas")
    .insert({ card_id: cardId, area_id: areaId });

  // PK conflict = already linked → treat as success
  if (error && error.code !== "23505") {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// ─── unlinkCardFromArea ───────────────────────────────────────────────────────

/**
 * Unlink a card from an area.
 */
export async function unlinkCardFromArea(
  supabase: SupabaseClient<Database>,
  input: AreaLinkInputType,
): Promise<AreaLinkResult> {
  const parsed = AreaLinkInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Input tidak valid" };
  const { cardId, areaId } = parsed.data;

  const { error } = await supabase
    .from("card_areas")
    .delete()
    .eq("card_id", cardId)
    .eq("area_id", areaId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
