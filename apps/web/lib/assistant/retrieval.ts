import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Card, CardEvent } from "@datum/db";

export type CardWithEvents = {
  card: Card;
  topicName: string;
  events: CardEvent[];
};

const MAX_CARDS_IN_CONTEXT = 40;       // bumped from 30
const MAX_EVENTS_PER_CARD = 8;
const KEYWORD_HITS_CAP = 20;           // how many extra cards to pull via keyword

/**
 * Retrieve cards for the assistant's context.
 * Always includes the N most-recent active cards.
 * If a query is provided, ALSO pulls cards whose title / current_summary /
 * event payload text matches the query, merged dedup.
 */
export async function retrieveProjectContext(
  supabase: SupabaseClient<Database>,
  projectId: string,
  query?: string,
): Promise<CardWithEvents[]> {
  // 1. Always: newest-active cards
  const { data: newest, error: nErr } = await supabase
    .from("cards")
    .select("*, topics!inner(name)")
    .eq("project_id", projectId)
    .eq("status", "active")
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CARDS_IN_CONTEXT);
  if (nErr) throw nErr;

  let cards = (newest ?? []) as unknown as (Card & { topics: { name: string } })[];

  // 2. If query: pull keyword hits and merge
  if (query && query.trim().length >= 2) {
    const trimmed = query.trim();
    const pattern = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;

    // 2a. Cards matching title / current_summary
    const { data: cardHits } = await supabase
      .from("cards")
      .select("*, topics!inner(name)")
      .eq("project_id", projectId)
      .eq("status", "active")
      .or(`title.ilike.${pattern},current_summary.ilike.${pattern}`)
      .limit(KEYWORD_HITS_CAP);

    // 2b. Cards whose events' payload text matches (sweep common text fields)
    const eventFields = ["body","description","topic","request_text","what","notes","title","caption"];
    const eventHitCardIds = new Set<string>();
    for (const f of eventFields) {
      const { data: evHits } = await supabase
        .from("card_events")
        .select("card_id, cards!inner(project_id)")
        .eq("cards.project_id", projectId)
        .ilike(`payload->>${f}`, pattern)
        .limit(KEYWORD_HITS_CAP);
      for (const row of evHits ?? []) {
        if (typeof (row as { card_id?: string }).card_id === "string") {
          eventHitCardIds.add((row as { card_id: string }).card_id);
        }
      }
      if (eventHitCardIds.size >= KEYWORD_HITS_CAP) break;
    }

    let eventHitCards: typeof cards = [];
    if (eventHitCardIds.size > 0) {
      const { data: extraCards } = await supabase
        .from("cards")
        .select("*, topics!inner(name)")
        .in("id", [...eventHitCardIds])
        .limit(KEYWORD_HITS_CAP);
      eventHitCards = (extraCards ?? []) as unknown as typeof cards;
    }

    // Merge dedup by card id
    const byId = new Map<string, typeof cards[number]>();
    for (const c of cards) byId.set(c.id, c);
    for (const c of (cardHits ?? []) as unknown as typeof cards) byId.set(c.id, c);
    for (const c of eventHitCards) byId.set(c.id, c);
    cards = [...byId.values()];
  }

  if (cards.length === 0) return [];

  // 3. Load events for the merged set
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
    const { topics, ...cardRow } = c;
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
