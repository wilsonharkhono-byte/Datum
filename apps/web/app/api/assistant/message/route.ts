import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveProjectContext, buildContextBlock } from "@/lib/assistant/retrieval";
import { askAssistant, extractCitations } from "@/lib/assistant/anthropic";
import { ensureSession, recordExchange } from "@/lib/assistant/audit";
import { ChatRequest, type ChatResponse } from "@/lib/assistant/types";

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // staff.id is a PK that references auth.users(id) directly
  const { data: staff, error: staffErr } = await supabase
    .from("staff").select("id").eq("id", user.id).maybeSingle();
  if (staffErr || !staff) return NextResponse.json({ error: "no staff record" }, { status: 403 });

  let parsed: ChatRequest;
  try {
    parsed = ChatRequest.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "invalid_body", detail: String(e) }, { status: 400 });
  }

  const cards = await retrieveProjectContext(supabase, parsed.projectId);
  const contextBlock = buildContextBlock(cards);
  const { answer, usage } = await askAssistant({ question: parsed.question, contextBlock });
  const citations = extractCitations(answer);

  const sessionId = await ensureSession(supabase, {
    staffId: staff.id, projectId: parsed.projectId, sessionId: parsed.sessionId,
  });
  await recordExchange(supabase, {
    sessionId, staffId: staff.id, projectId: parsed.projectId,
    question: parsed.question, answer, citations, usage,
  });

  const body: ChatResponse = { sessionId, answer, citations };
  return NextResponse.json(body);
}
