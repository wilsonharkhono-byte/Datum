import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveProjectContext, buildContextBlock } from "@/lib/assistant/retrieval";
import { askAssistant, extractCitations, AnthropicNotConfiguredError } from "@/lib/assistant/anthropic";
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

  const cards = await retrieveProjectContext(supabase, parsed.projectId, parsed.question);
  const contextBlock = buildContextBlock(cards);

  let answer: string;
  let usage: { input_tokens: number; output_tokens: number };
  try {
    ({ answer, usage } = await askAssistant({ question: parsed.question, contextBlock }));
  } catch (e) {
    if (e instanceof AnthropicNotConfiguredError) {
      return NextResponse.json(
        { error: "assistant_not_configured",
          message: "Asisten belum dikonfigurasi. Set ANTHROPIC_API_KEY di .env.local untuk mengaktifkan." },
        { status: 503 },
      );
    }
    throw e;
  }

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
