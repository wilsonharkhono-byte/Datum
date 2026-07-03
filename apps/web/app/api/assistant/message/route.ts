import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { createSupabaseClientForRequest } from "@/lib/supabase/from-request";
import { retrieveProjectContext, buildContextBlock, buildPortfolioContextBlock, jakartaToday } from "@/lib/assistant/retrieval";
import {
  streamAssistant,
  extractCitations,
  AnthropicNotConfiguredError,
  textOf,
  type AssistantStream,
} from "@/lib/assistant/anthropic";
import { ensureSession, recordExchange, fetchRecentMessages } from "@/lib/assistant/audit";
import { ChatRequest } from "@/lib/assistant/types";
import { parseActionTail, stripActionTail } from "@/lib/assistant/actions";

/**
 * Streaming protocol — newline-delimited JSON (NDJSON), one event per line:
 *   {"type":"delta","text":"..."}                                — assistant text chunk
 *   {"type":"done","sessionId":...,"citations":[...],"usage":{}} — final trailer
 *   {"type":"error","message":"..."}                             — mid-stream failure
 * Pre-stream failures (auth, validation, retrieval, not-configured) are plain
 * JSON responses with real HTTP status codes, so the client can decide whether
 * to auto-retry (5xx / network) or not (4xx).
 *
 * Portfolio mode (Phase 3 Task 5): `projectId` is optional. When absent, this
 * is the principal's cross-project /brief assistant — retrieval builds a
 * PORTFOLIO KONTEKS (buildPortfolioContextBlock) instead of a single
 * project's cards/steps context. Action proposals are DISABLED in this mode
 * (see the parseActionTail call below): every executor in actions.ts takes a
 * mandatory `projectId` (there is no "cross-project remind/update/decide"),
 * so a portfolio-mode action tail is stripped server-side and never reaches
 * the client — cheaper and more robust than trying to steer the model away
 * from ever proposing one via the (byte-stable, cached) system prompt.
 */

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

export async function POST(req: Request) {
  const supabase = await createSupabaseClientForRequest(req);

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

  // 1. Retrieval — pull cards + events for context, OR (no projectId) the
  // cross-project PORTFOLIO KONTEKS for the principal's /brief question.
  const { projectId } = parsed;
  const isPortfolio = projectId === undefined;
  let contextBlock: string;
  try {
    if (projectId === undefined) {
      const now = new Date();
      contextBlock = await buildPortfolioContextBlock(supabase, jakartaToday(now), now.toISOString());
    } else {
      const cards = await retrieveProjectContext(supabase, projectId, parsed.question);
      contextBlock = buildContextBlock(cards);
    }
  } catch (e) {
    console.error("[assistant/message] retrieval failed", e);
    return NextResponse.json(
      { error: "retrieval_failed", message: `Gagal memuat konteks kartu: ${errorMessage(e)}` },
      { status: 500 },
    );
  }

  // 1b. History — replay up to the last 8 turns of this session (empty for a
  // brand-new session, i.e. no sessionId yet). Best-effort: a read failure
  // degrades to single-turn rather than failing the request.
  const history = await fetchRecentMessages(supabase, parsed.sessionId);

  // 2. Anthropic — open the stream. getAnthropicClient() throws synchronously
  // when the key is missing, so config errors still get a clean 503 before any
  // bytes are streamed.
  let stream: AssistantStream;
  try {
    stream = streamAssistant({ question: parsed.question, contextBlock, history });
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
          const rawAnswer = textOf(final.content);
          const usage = {
            input_tokens: final.usage.input_tokens,
            output_tokens: final.usage.output_tokens,
          };

          // Confirm-gated action tail (Task 3): parse + validate the trailing
          // <action>{json}</action> block, then strip it from the text that
          // gets displayed/stored/cited — nothing downstream (history replay,
          // citations, the persisted transcript) should ever see the raw tag.
          // Invalid/absent tails silently parse to null; the client-side
          // parse in ChatDock is a defensive fallback for the same text.
          //
          // Portfolio mode (no projectId): actions are disabled outright — every
          // executor requires a projectId (see actions.ts's executeAction), so a
          // parsed action here can never be confirmed successfully. Force it to
          // null (and still strip the raw tag from the displayed/stored text)
          // rather than send the client a chip that always errors on tap.
          const action = isPortfolio ? null : parseActionTail(rawAnswer);
          const answer = stripActionTail(rawAnswer);
          const citations = extractCitations(answer);

          // 3. Audit — best-effort after stream completion. Failure here must
          // NOT swallow the answer the user already received; degrade
          // gracefully and surface a console warning for ops.
          let sessionId: string | null = parsed.sessionId ?? null;
          try {
            sessionId = await ensureSession(supabase, {
              staffId: staff.id, projectId: parsed.projectId ?? null, sessionId: parsed.sessionId,
            });
            await recordExchange(supabase, {
              sessionId, staffId: staff.id, projectId: parsed.projectId ?? null,
              question: parsed.question, answer, citations, usage,
            });
          } catch (e) {
            console.warn("[assistant/message] audit write failed — returning answer without session", e);
            Sentry.captureException(e);
          }

          send({ type: "done", sessionId, citations, usage, action });
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
