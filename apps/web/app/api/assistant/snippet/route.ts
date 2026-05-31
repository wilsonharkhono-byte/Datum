import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const eventIds = (url.searchParams.get("eventIds") ?? "").split(",").filter(Boolean);
  if (!cardId) return NextResponse.json({ error: "missing cardId" }, { status: 400 });

  const { data: card } = await supabase
    .from("cards").select("id, title, slug, current_summary, topics(name)")
    .eq("id", cardId).maybeSingle();
  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let eventsQ = supabase
    .from("card_events")
    .select("id, event_kind, occurred_at, payload")
    .eq("card_id", cardId)
    .order("occurred_at", { ascending: false })
    .limit(6);
  if (eventIds.length > 0) eventsQ = eventsQ.in("id", eventIds);
  const { data: events } = await eventsQ;

  return NextResponse.json({
    card: { id: card.id, title: card.title, slug: card.slug, current_summary: card.current_summary },
    topicName: (card as { topics?: { name?: string } }).topics?.name ?? "",
    events: events ?? [],
  });
}
