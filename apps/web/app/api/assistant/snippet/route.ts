import { NextResponse } from "next/server";
import { createSupabaseClientForRequest } from "@/lib/supabase/from-request";
import { getCardSnippet } from "@datum/core";

export async function GET(req: Request) {
  const supabase = await createSupabaseClientForRequest(req);
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const eventIds = (url.searchParams.get("eventIds") ?? "").split(",").filter(Boolean);
  if (!cardId) return NextResponse.json({ error: "missing cardId" }, { status: 400 });

  const snippet = await getCardSnippet(supabase, { cardId, eventIds });
  if (!snippet) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(snippet);
}
