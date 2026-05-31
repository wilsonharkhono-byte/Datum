import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Project,
  Topic,
  Card,
  CardEvent,
} from "@datum/db";

export type BoardColumn = { topic: Topic; cards: Card[] };
export type Board = { project: Project; columns: BoardColumn[] };
export type CardDetail = { card: Card; events: CardEvent[] };

export async function getBoardForProject(
  supabase: SupabaseClient<Database>,
  projectSlug: string,
): Promise<Board> {
  // Pilot: projects.slug not yet a column; fall back to project_code lookup case-insensitively.
  const slugUpper = projectSlug.toUpperCase();
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("*")
    .eq("project_code", slugUpper)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project) throw new Error(`Project not found: ${projectSlug}`);

  const [topicsRes, cardsRes] = await Promise.all([
    supabase
      .from("topics")
      .select("*")
      .eq("project_id", project.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("cards")
      .select("*")
      .eq("project_id", project.id)
      .order("last_event_at", { ascending: false, nullsFirst: false }),
  ]);
  if (topicsRes.error) throw topicsRes.error;
  if (cardsRes.error) throw cardsRes.error;

  const cardsByTopic = new Map<string, Card[]>();
  for (const c of cardsRes.data ?? []) {
    const arr = cardsByTopic.get(c.topic_id) ?? [];
    arr.push(c);
    cardsByTopic.set(c.topic_id, arr);
  }

  const columns: BoardColumn[] = (topicsRes.data ?? []).map((t) => ({
    topic: t,
    cards: cardsByTopic.get(t.id) ?? [],
  }));

  return { project, columns };
}

export async function getCardWithTimeline(
  supabase: SupabaseClient<Database>,
  projectId: string,
  cardSlug: string,
): Promise<CardDetail> {
  const { data: card, error: cardErr } = await supabase
    .from("cards")
    .select("*")
    .eq("project_id", projectId)
    .eq("slug", cardSlug)
    .maybeSingle();
  if (cardErr) throw cardErr;
  if (!card) throw new Error(`Card not found: ${cardSlug}`);

  const { data: events, error: evErr } = await supabase
    .from("card_events")
    .select("*")
    .eq("card_id", card.id)
    .order("occurred_at", { ascending: false });
  if (evErr) throw evErr;

  return { card, events: events ?? [] };
}
