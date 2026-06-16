import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Card, CardEvent } from "@datum/db";
import { getAdvisorData } from "@/lib/advisor/queries";

export type CardWithEvents = {
  card: Card;
  topicName: string;
  events: CardEvent[];
  /** AI captions for an event's attachments, keyed by event id. */
  captionsByEventId?: Record<string, string[]>;
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
  opts?: { includeAdvisor?: boolean },
): Promise<CardWithEvents[]> {
  // 0. "Hari Ini" advisor + gate-deadline context — kicked off first so its
  // internal Promise.all overlaps the card queries below; attached to the
  // result right before returning (see advisorSectionByCards). The capture
  // route skips it: proposals don't use the priority section.
  const advisorPromise = opts?.includeAdvisor === false
    ? Promise.resolve("")
    : buildAdvisorSections(supabase, projectId, new Date()).catch(() => "");

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

    // 2b. Cards whose events' payload text matches (sweep common text fields in one .or() query)
    const eventFields = ["body","description","topic","request_text","what","notes","title","caption"];
    const orTerm = trimmed.replace(/[,()]/g, "").replace(/[%_]/g, (m) => `\\${m}`);
    const orPattern = `*${orTerm}*`;
    const eventHitCardIds = new Set<string>();
    const { data: evHits } = await supabase
      .from("card_events")
      .select("card_id, cards!inner(project_id)")
      .eq("cards.project_id", projectId)
      .or(eventFields.map((f) => `payload->>${f}.ilike.${orPattern}`).join(","))
      .limit(KEYWORD_HITS_CAP * 2);
    for (const row of evHits ?? []) {
      if (typeof (row as { card_id?: string }).card_id === "string") {
        eventHitCardIds.add((row as { card_id: string }).card_id);
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

  if (cards.length === 0) {
    const empty: CardWithEvents[] = [];
    advisorSectionByCards.set(empty, await advisorPromise);
    return empty;
  }

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

  // Attachment captions for the events actually in context (RLS-scoped, so the
  // cost-visibility gating on the parent event is inherited).
  const contextEventIds: string[] = [];
  for (const arr of evByCard.values()) for (const e of arr) contextEventIds.push(e.id);
  const capByEvent = new Map<string, string[]>();
  if (contextEventIds.length > 0) {
    const { data: caps } = await supabase
      .from("card_attachments")
      .select("card_event_id, ai_caption")
      .in("card_event_id", contextEventIds)
      .not("ai_caption", "is", null);
    for (const row of caps ?? []) {
      const r = row as { card_event_id: string; ai_caption: string | null };
      if (!r.ai_caption) continue;
      const arr = capByEvent.get(r.card_event_id) ?? [];
      arr.push(r.ai_caption);
      capByEvent.set(r.card_event_id, arr);
    }
  }

  const result = cards.map((c) => {
    const { topics, ...cardRow } = c;
    const evs = evByCard.get(c.id) ?? [];
    const captionsByEventId: Record<string, string[]> = {};
    for (const e of evs) {
      const caps = capByEvent.get(e.id);
      if (caps && caps.length > 0) captionsByEventId[e.id] = caps;
    }
    return {
      card: cardRow as Card,
      topicName: topics?.name ?? "",
      events: evs,
      captionsByEventId,
    };
  });
  advisorSectionByCards.set(result, await advisorPromise);
  return result;
}

export function buildContextBlock(cards: CardWithEvents[]): string {
  const advisorSections = advisorSectionByCards.get(cards) ?? "";
  if (cards.length === 0) {
    return ["Tidak ada kartu yang tersedia untuk proyek ini.", advisorSections]
      .filter(Boolean)
      .join("\n\n");
  }
  const lines: string[] = [];
  for (const { card, topicName, events, captionsByEventId } of cards) {
    lines.push(`## [card:${card.id}] ${card.title} (${topicName})`);
    if (card.current_summary) lines.push(`Ringkasan: ${card.current_summary}`);
    lines.push(`Status: ${card.status}`);
    if (events.length > 0) {
      lines.push("Aktivitas terbaru:");
      for (const e of events) {
        const date = new Date(e.occurred_at).toISOString().slice(0, 10);
        lines.push(`  - [event:${e.id}] ${date} · ${e.event_kind} · ${JSON.stringify(e.payload)}`);
        const caps = captionsByEventId?.[e.id];
        if (caps && caps.length > 0) {
          for (const cap of caps) lines.push(`    Lampiran: ${cap}`);
        }
      }
    }
    lines.push("");
  }
  if (advisorSections) lines.push(advisorSections);
  return lines.join("\n");
}

// ─── "Hari Ini" advisor context injection ────────────────────────────────────
// The advisor + gate-deadline sections ride along with the cards array via a
// WeakMap keyed on the exact array instance, so retrieveProjectContext and
// buildContextBlock keep their public signatures (the API routes call them as
// a pair: the block returned for a retrieved card set automatically carries
// that project's priorities). Entries are GC'd with the arrays themselves.
const advisorSectionByCards = new WeakMap<CardWithEvents[], string>();

const MAX_ADVISOR_ITEMS_IN_CONTEXT = 5;
const MAX_GATE_DEADLINES_IN_CONTEXT = 5;

async function buildAdvisorSections(
  supabase: SupabaseClient<Database>,
  projectId: string,
  now: Date,
): Promise<string> {
  const { items, upcomingGateCells } = await getAdvisorData(supabase, {
    projectId,
    now,
    limit: MAX_ADVISOR_ITEMS_IN_CONTEXT,
  });

  const lines: string[] = [];
  if (items.length > 0) {
    lines.push("PRIORITAS PROYEK SAAT INI:");
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.title}${it.dueLabel ? ` (${it.dueLabel})` : ""}`);
    });
  }
  if (upcomingGateCells.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("TENGGAT GATE TERDEKAT:");
    for (const c of upcomingGateCells.slice(0, MAX_GATE_DEADLINES_IN_CONTEXT)) {
      lines.push(`- ${c.areaName} · Gate ${c.gateCode} — target selesai ${c.targetEndDate}`);
    }
  }
  return lines.join("\n");
}
