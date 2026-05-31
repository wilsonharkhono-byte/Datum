import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Card, CardEvent } from "@datum/db";

export type CardWithEvents = {
  card: Card;
  topicName: string;
  events: CardEvent[];
};

const MAX_CARDS_IN_CONTEXT = 30;
const MAX_EVENTS_PER_CARD = 8;

export async function retrieveProjectContext(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<CardWithEvents[]> {
  const { data: cards, error: cErr } = await supabase
    .from("cards")
    .select("*, topics!inner(name)")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CARDS_IN_CONTEXT);
  if (cErr) throw cErr;
  if (!cards || cards.length === 0) return [];

  const cardIds = cards.map((c) => c.id);
  const { data: events, error: eErr } = await supabase
    .from("card_events")
    .select("*")
    .in("card_id", cardIds)
    .order("occurred_at", { ascending: false });
  if (eErr) throw eErr;

  const evByCard = new Map<string, CardEvent[]>();
  for (const e of events ?? []) {
    const arr = evByCard.get(e.card_id) ?? [];
    if (arr.length < MAX_EVENTS_PER_CARD) arr.push(e);
    evByCard.set(e.card_id, arr);
  }

  return cards.map((c) => {
    const { topics, ...cardRow } = c as unknown as Card & { topics: { name: string } };
    return {
      card: cardRow as Card,
      topicName: topics?.name ?? "",
      events: evByCard.get(c.id) ?? [],
    };
  });
}

export function buildContextBlock(cards: CardWithEvents[]): string {
  if (cards.length === 0) return "Tidak ada kartu yang tersedia untuk proyek ini.";
  const lines: string[] = [];
  for (const { card, topicName, events } of cards) {
    lines.push(`## [card:${card.id}] ${card.title} (${topicName})`);
    if (card.current_summary) lines.push(`Ringkasan: ${card.current_summary}`);
    lines.push(`Status: ${card.status}`);
    if (events.length > 0) {
      lines.push("Aktivitas terbaru:");
      for (const e of events) {
        const date = new Date(e.occurred_at).toISOString().slice(0, 10);
        lines.push(`  - [event:${e.id}] ${date} · ${e.event_kind} · ${JSON.stringify(e.payload)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
