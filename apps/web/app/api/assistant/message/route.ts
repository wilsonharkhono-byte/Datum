import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveProjectContext, buildContextBlock } from "@/lib/assistant/retrieval";
import {
  streamAssistant,
  extractCitations,
  AnthropicNotConfiguredError,
  type AssistantStream,
} from "@/lib/assistant/anthropic";
import { ensureSession, recordExchange } from "@/lib/assistant/audit";
import { ChatRequest } from "@/lib/assistant/types";

/**
 * Streaming protocol — newline-delimited JSON (NDJSON), one event per line:
 *   {"type":"delta","text":"..."}                                — assistant text chunk
 *   {"type":"done","sessionId":...,"citations":[...],"usage":{}} — final trailer
 *   {"type":"error","message":"..."}                             — mid-stream failure
 * Pre-stream failures (auth, validation, retrieval, not-configured) are plain
 * JSON responses with real HTTP status codes, so the client can decide whether
 * to auto-retry (5xx / network) or not (4xx).
 */

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

  // 2. Anthropic — open the stream. getAnthropicClient() throws synchronously
  // when the key is missing, so config errors still get a clean 503 before any
  // bytes are streamed.
  let stream: AssistantStream;
  try {
    stream = streamAssistant({ question: parsed.question, contextBlock });
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

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Client disconnected mid-stream — nothing left to deliver to.
        }
      };

      stream.on("text", (delta) => {
        send({ type: "delta", text: delta });
      });

      void (async () => {
        try {
          const final = await stream.finalMessage();
          const answer = final.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("");
          const usage = {
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
          };
          const citations = extractCitations(answer);

          // 3. Audit — best-effort after stream completion. Failure here must
          // NOT swallow the answer the user already received; degrade
          // gracefully and surface a console warning for ops.
          let sessionId: string | null = parsed.sessionId ?? null;
          try {
            sessionId = await ensureSession(supabase, {
              staffId: staff.id, projectId: parsed.projectId, sessionId: parsed.sessionId,
            });
            await recordExchange(supabase, {
              sessionId, staffId: staff.id, projectId: parsed.projectId,
              question: parsed.question, answer, citations, usage,
            });
          } catch (e) {
            console.warn("[assistant/message] audit write failed — returning answer without session", e);
          }

          send({ type: "done", sessionId, citations, usage });
        } catch (e) {
          console.error("[assistant/message] anthropic stream failed", e);
          send({ type: "error", message: `Asisten gagal menjawab: ${errorMessage(e)}` });
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      })();
    },
    cancel() {
      // Browser went away (tab closed / connection dropped) — stop paying for tokens.
      try { stream.abort(); } catch { /* already done */ }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
