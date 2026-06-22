import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCardSnippet } from "@datum/core";

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient();
  const url = new URL(req.url);
  const cardId = url.searchParams.get("cardId");
  const eventIds = (url.searchParams.get("eventIds") ?? "").split(",").filter(Boolean);
  if (!cardId) return NextResponse.json({ error: "missing cardId" }, { status: 400 });

  const snippet = await getCardSnippet(supabase, { cardId, eventIds });
  if (!snippet) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(snippet);
}
