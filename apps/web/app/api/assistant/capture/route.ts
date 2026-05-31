import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveProjectContext } from "@/lib/assistant/retrieval";
import { EVENT_KINDS, EventPayloadSchemas, type EventKind } from "@datum/types";

const Body = z.object({
  projectId: z.string().uuid(),
  text:      z.string().min(1).max(4000),
});

const CAPTURE_SYSTEM = `Anda adalah asisten internal DATUM untuk WHAstudio.

TUGAS: Pengguna memberi sebuah input bebas (catatan lapangan, keputusan klien, info vendor, dll). Anda harus mengusulkan SATU card_event yang TEPAT untuk dicatat di kartu yang sesuai.

ATURAN:
- Pilih kartu (card_id) HANYA dari daftar KARTU TERSEDIA di bawah. Jangan menebak UUID.
- Pilih event_kind dari daftar berikut: decision, drawing, survey, vendor_quote, vendor_pick, material, worker_assigned, progress, defect, photo, document, client_request, note, pending.
- Susun payload sesuai dengan kind yang dipilih. Field penting per kind (lihat catatan implementasi DATUM):
  - decision: { topic, current_spec?, proposed_spec?, approved_by? (client|principal|pic), approval_evidence? }
  - drawing: { description, drawing_code?, revision?, file_ref? }
  - survey: { vendor_name?, location?, attendees?[], notes? }
  - vendor_quote: { vendor_name, amount (number IDR), currency: "IDR", quote_date (YYYY-MM-DD), expires_at?, notes? }
  - vendor_pick: { vendor_name, vendor_id?, rationale? }
  - material: { item, spec?, status: "specified"|"sample_approved"|"ordered"|"delivered", quantity?, unit? }
  - worker_assigned: { worker_name, role?, scope?, start_date? }
  - progress: { status, percent_complete? (0-100), notes? }
  - defect: { description, severity: "low"|"medium"|"high", location?, fix_required_by? }
  - photo: { caption?, taken_at? }
  - document: { title, doc_type?, notes? }
  - client_request: { request_text, requested_by?, awaiting? }
  - note: { body }
  - pending: { what, blocked_on? }
- Confidence 0–1: berapa yakin Anda dengan pilihan ini. Turunkan jika input ambigu.
- Rationale: 1 kalimat Bahasa Indonesia pendek menjelaskan kenapa kartu+kind itu cocok.
- Jika tidak ada kartu yang cocok sama sekali, gunakan event_kind "note" dengan body=input asli dan pilih kartu paling mungkin terkait.

FORMAT OUTPUT — WAJIB JSON murni, TANPA markdown fence, TANPA penjelasan di luar JSON:
{
  "card_id": "<uuid dari KARTU TERSEDIA>",
  "event_kind": "<salah satu dari 14 kind>",
  "payload": { ... },
  "rationale": "<kalimat Bahasa Indonesia>",
  "confidence": 0.0..1.0
}`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: staff } = await supabase.from("staff").select("id").eq("id", user.id).maybeSingle();
  if (!staff) return NextResponse.json({ error: "no staff record" }, { status: 403 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const cards = await retrieveProjectContext(supabase, body.projectId);
  if (cards.length === 0) {
    return NextResponse.json({ ok: false, error: "Belum ada kartu di proyek ini — buat kartu dulu" });
  }

  const cardList = cards.map(({ card, topicName }) =>
    `- card_id=${card.id} | topic="${topicName}" | title="${card.title}"${card.current_summary ? ` | summary="${card.current_summary}"` : ""}`
  ).join("\n");

  const res = await getClient().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: CAPTURE_SYSTEM,
    messages: [{
      role: "user",
      content: `KARTU TERSEDIA:\n${cardList}\n\nINPUT PENGGUNA:\n${body.text}`,
    }],
  });

  const raw = res.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  // Be lenient: strip markdown fence if present
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  let parsed: {
    card_id?: unknown;
    event_kind?: unknown;
    payload?: unknown;
    rationale?: unknown;
    confidence?: unknown;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ ok: false, error: "AI mengembalikan format tidak valid", raw: cleaned.slice(0, 400) });
  }

  // Validate cardId belongs to retrieved context
  const cardIdStr = typeof parsed.card_id === "string" ? parsed.card_id : "";
  const target = cards.find(({ card }) => card.id === cardIdStr);
  if (!target) {
    return NextResponse.json({ ok: false, error: `AI memilih kartu yang tidak ada (${cardIdStr})` });
  }

  // Validate event_kind
  const kindStr = typeof parsed.event_kind === "string" ? parsed.event_kind : "";
  if (!(EVENT_KINDS as readonly string[]).includes(kindStr)) {
    return NextResponse.json({ ok: false, error: `AI memilih event_kind tidak valid (${kindStr})` });
  }
  const eventKind = kindStr as EventKind;

  // Validate payload against schema
  const payloadCheck = EventPayloadSchemas[eventKind].safeParse(parsed.payload);
  if (!payloadCheck.success) {
    return NextResponse.json({
      ok: false,
      error: `Payload tidak valid untuk ${eventKind}: ${payloadCheck.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`,
      raw: cleaned.slice(0, 400),
    });
  }

  return NextResponse.json({
    ok: true,
    proposal: {
      projectId:  body.projectId,
      cardId:     target.card.id,
      cardTitle:  target.card.title,
      cardSlug:   target.card.slug,
      topicName:  target.topicName,
      eventKind,
      payload:    payloadCheck.data,
      rationale:  typeof parsed.rationale === "string" ? parsed.rationale : "",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    },
  });
}
