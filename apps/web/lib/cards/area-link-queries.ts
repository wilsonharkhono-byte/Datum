import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Area } from "@datum/db";

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

  const areas = ((data ?? [])
    .map((row) => (row as unknown as { area: Area | null }).area)
    .filter((a): a is Area => a !== null));

  areas.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return areas;
}
