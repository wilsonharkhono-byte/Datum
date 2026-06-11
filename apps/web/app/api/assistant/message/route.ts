import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveProjectContext, buildContextBlock } from "@/lib/assistant/retrieval";
import { askAssistant, extractCitations, AnthropicNotConfiguredError } from "@/lib/assistant/anthropic";
import { ensureSession, recordExchange } from "@/lib/assistant/audit";
import { ChatRequest, type ChatResponse } from "@/lib/assistant/types";

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // staff.id is a PK that references auth.users(id) directly
  const { data: staff, error: staffErr } = await supabase
    .from("staff").select("id").eq("id", user.id).maybeSingle();
  if (staffErr || !staff) {
    return NextResponse.json(
      { error: "no_staff_record", message: "Akun Anda belum terdaftar sebagai staf di DATUM." },
      { status: 403 },
    );
  }

  let parsed: ChatRequest;
  try {
    parsed = ChatRequest.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: "invalid_body", message: `Format permintaan salah: ${errorMessage(e)}` },
      { status: 400 },
    );
  }

  // 1. Retrieval — pull cards + events for context
  let contextBlock: string;
  try {
    const cards = await retrieveProjectContext(supabase, parsed.projectId, parsed.question);
    contextBlock = buildContextBlock(cards);
  } catch (e) {
    console.error("[assistant/message] retrieval failed", e);
    return NextResponse.json(
      { error: "retrieval_failed", message: `Gagal memuat konteks kartu: ${errorMessage(e)}` },
      { status: 500 },
    );
  }

  // 2. Anthropic — generate answer
  let answer: string;
  let usage: { input_tokens: number; output_tokens: number };
  try {
    ({ answer, usage } = await askAssistant({ question: parsed.question, contextBlock }));
  } catch (e) {
    if (e instanceof AnthropicNotConfiguredError) {
      return NextResponse.json(
        {
          error: "assistant_not_configured",
          message: "Asisten belum dikonfigurasi. Set ANTHROPIC_API_KEY di .env.local untuk mengaktifkan.",
        },
        { status: 503 },
      );
    }
    console.error("[assistant/message] anthropic call failed", e);
    return NextResponse.json(
      { error: "assistant_call_failed", message: `Asisten gagal menjawab: ${errorMessage(e)}` },
      { status: 502 },
    );
  }

  const citations = extractCitations(answer);

  // 3. Audit — record session + messages. Failure here should NOT swallow the
  // user's answer; we degrade gracefully so the chat still works while we
  // surface a console warning for ops.
  try {
    const sessionId = await ensureSession(supabase, {
      staffId: staff.id, projectId: parsed.projectId, sessionId: parsed.sessionId,
    });
    await recordExchange(supabase, {
      sessionId, staffId: staff.id, projectId: parsed.projectId,
      question: parsed.question, answer, citations, usage,
    });
    const body: ChatResponse = { sessionId, answer, citations };
    return NextResponse.json(body);
  } catch (e) {
    console.warn("[assistant/message] audit write failed — returning answer without session", e);
    const body: ChatResponse = {
      sessionId: parsed.sessionId ?? null,
      answer,
      citations,
    };
    return NextResponse.json(body);
  }
}
