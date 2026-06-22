/**
 * getCardSnippet — fetch a card + its recent events for inline display.
 *
 * Isomorphic — takes a client-injected SupabaseClient.
 * Web: called from the snippet route (thin HTTP wrapper).
 * Mobile: called directly with the anon Supabase client (RLS-scoped).
 *
 * Moved from apps/web/app/api/assistant/snippet/route.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

export type SnippetEvent = {
  id: string;
  event_kind: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export type CardSnippet = {
  card: {
    id: string;
    title: string;
    slug: string;
    current_summary: string | null;
  };
  topicName: string;
  events: SnippetEvent[];
};

/**
 * Fetch a card snippet for inline citation rendering.
 *
 * @param supabase  Client-injected Supabase client (anon or server-side).
 * @param args.cardId    UUID of the card.
 * @param args.eventIds  Optional list of specific event IDs to fetch.
 *                       When empty/absent, returns the 6 most recent events.
 * @returns  CardSnippet or null if the card is not found (or RLS hides it).
 */
export async function getCardSnippet(
  supabase: SupabaseClient<Database>,
  args: { cardId: string; eventIds?: string[] },
): Promise<CardSnippet | null> {
  const { cardId, eventIds = [] } = args;

  const { data: card } = await supabase
    .from("cards")
    .select("id, title, slug, current_summary, topics(name)")
    .eq("id", cardId)
    .maybeSingle();

  if (!card) return null;

  let eventsQ = supabase
    .from("card_events")
    .select("id, event_kind, occurred_at, payload")
    .eq("card_id", cardId)
    .order("occurred_at", { ascending: false })
    .limit(6);

  if (eventIds.length > 0) {
    eventsQ = eventsQ.in("id", eventIds);
  }

  const { data: events } = await eventsQ;

  return {
    card: {
      id: card.id,
      title: card.title,
      slug: card.slug,
      current_summary: card.current_summary,
    },
    topicName:
      (card as { topics?: { name?: string } }).topics?.name ?? "",
    events: ((events ?? []) as unknown[]).map((e) => {
      const ev = e as Record<string, unknown>;
      return {
        id: ev.id as string,
        event_kind: ev.event_kind as string,
        occurred_at: ev.occurred_at as string,
        payload: (ev.payload ?? {}) as Record<string, unknown>,
      };
    }),
  };
}
