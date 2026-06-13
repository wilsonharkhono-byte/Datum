import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type CardLinkRelation = Database["public"]["Enums"]["card_link_relation"];

/**
 * One normalized "Terkait" row for the card sidebar. card_links has a
 * composite PK (from_card_id, to_card_id, relation) — there is no surrogate
 * id column — so `id` here is a synthetic stable key and mutations identify
 * rows by the triple.
 */
export type CardLinkItem = {
  id: string;
  relation: CardLinkRelation;
  /** "out" = this card is from_card_id; "in" = this card is to_card_id. */
  direction: "out" | "in";
  fromCardId: string;
  toCardId: string;
  otherCard: { slug: string; title: string; projectCode: string };
};

type OtherCardJoin = {
  id: string;
  slug: string;
  title: string;
  projects: { project_code: string } | null;
} | null;

/**
 * Fetch links in both directions for a card. The schema allows cross-project
 * links (insert RLS only requires both endpoints readable), so the other
 * card's project_code rides along for href building. Joined cards the viewer
 * cannot read come back null under cards RLS and are dropped.
 */
export async function getCardLinks(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CardLinkItem[]> {
  const [outRes, inRes] = await Promise.all([
    supabase
      .from("card_links")
      .select("from_card_id, to_card_id, relation, created_at, other:to_card_id (id, slug, title, projects:project_id (project_code))")
      .eq("from_card_id", cardId)
      .order("created_at", { ascending: true }),
    supabase
      .from("card_links")
      .select("from_card_id, to_card_id, relation, created_at, other:from_card_id (id, slug, title, projects:project_id (project_code))")
      .eq("to_card_id", cardId)
      .order("created_at", { ascending: true }),
  ]);
  if (outRes.error) throw outRes.error;
  if (inRes.error) throw inRes.error;

  const items: CardLinkItem[] = [];
  for (const [direction, rows] of [
    ["out", outRes.data ?? []],
    ["in", inRes.data ?? []],
  ] as const) {
    for (const raw of rows) {
      const row = raw as unknown as {
        from_card_id: string;
        to_card_id: string;
        relation: CardLinkRelation;
        other: OtherCardJoin;
      };
      if (!row.other || !row.other.projects) continue;
      items.push({
        id: `${row.from_card_id}:${row.to_card_id}:${row.relation}`,
        relation: row.relation,
        direction,
        fromCardId: row.from_card_id,
        toCardId: row.to_card_id,
        otherCard: {
          slug: row.other.slug,
          title: row.other.title,
          projectCode: row.other.projects.project_code,
        },
      });
    }
  }
  return items;
}
