import { NextResponse } from "next/server";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveProjectContext } from "@/lib/assistant/retrieval";
import {
  AnthropicNotConfiguredError,
  getAnthropicClient,
  getModel,
  cachedSystemBlock,
  textOf,
} from "@/lib/assistant/anthropic";
import { EVENT_KINDS, EventPayloadSchemas, type EventKind } from "@datum/types";
import { isTemplateCardTitle, deriveCardLabel } from "@/lib/cards/template-card";
import { CaptureRequest } from "@datum/core";

// CaptureRequest from core is the canonical body schema (shared with mobile).
const Body = CaptureRequest;

const CAPTURE_SYSTEM = `Anda adalah asisten internal DATUM untuk WHAstudio.

TUGAS: Pengguna memberi sebuah input bebas (catatan lapangan, keputusan klien, info vendor, dll). Anda harus mengusulkan SATU card_event yang TEPAT untuk dicatat di kartu yang sesuai.

ATURAN:
- Pilih kartu (card_id) HANYA dari daftar KARTU TERSEDIA di bawah. Jangan menebak UUID.
- Pilih event_kind dari daftar berikut: decision, drawing, vendor, material, work, client_request, note, photo, document.
- Susun payload sesuai dengan kind yang dipilih. Field penting per kind (lihat catatan implementasi DATUM):
  - decision: { topic, current_spec?, proposed_spec?, approved_by? (client|principal|pic), approval_evidence? }
  - drawing: { description, drawing_code?, revision?, file_ref? }
  - vendor: { interaction (quote|pick|survey|contract), vendor_name, amount? (number IDR), quote_date? (YYYY-MM-DD), expires_at?, location?, attendees?[], rationale?, notes? }
  - material: { item, spec?, status: "specified"|"sample_approved"|"ordered"|"delivered", quantity?, unit? }
  - work: { status: "assigned"|"in_progress"|"blocked"|"done", worker_name?, role?, scope?, percent_complete? (0-100), description?, severity? ("low"|"medium"|"high"), location? }
  - client_request: { request_text, requested_by?, awaiting? }
  - note: { body }
  - photo: { caption?, taken_at? }
  - document: { title, doc_type?, notes? }
- Confidence 0–1: berapa yakin Anda dengan pilihan ini. Turunkan jika input ambigu.
- Rationale: 1 kalimat Bahasa Indonesia pendek menjelaskan kenapa kartu+kind itu cocok.
- Jika tidak ada kartu yang cocok sama sekali, gunakan event_kind "note" dengan body=input asli dan pilih kartu paling mungkin terkait.
- area_hint (OPSIONAL): jika input jelas merujuk ke sebuah RUANGAN yang ada di daftar AREA TERSEDIA, sertakan area_code-nya. Pilih HANYA dari daftar AREA TERSEDIA; jangan menebak kode baru. Jika tidak ada area yang cocok atau daftar kosong, kosongkan (null).
- suggested_title (judul kartu): Beberapa KARTU TERSEDIA adalah placeholder kosong dari import Trello — judulnya diawali "YYYY-MM-DD" atau "GUIDE". Placeholder BUKAN pekerjaan nyata; jika Anda memilih salah satunya, sistem akan MEMBUAT KARTU BARU. Dalam kasus itu WAJIB isi suggested_title: judul ringkas Bahasa Indonesia (3–8 kata) yang mendeskripsikan item/permintaan/gambar, TANPA tanggal (sistem menambah tanggal otomatis). Jika Anda memilih kartu nyata yang sudah ada, set suggested_title = null.

FORMAT OUTPUT — WAJIB JSON murni, TANPA markdown fence, TANPA penjelasan di luar JSON:
{
  "card_id": "<uuid dari KARTU TERSEDIA>",
  "event_kind": "<salah satu dari 9 kind>",
  "payload": { ... },
  "rationale": "<kalimat Bahasa Indonesia>",
  "confidence": 0.0..1.0,
  "area_hint": "<area_code dari AREA TERSEDIA, atau null>",
  "suggested_title": "<judul kartu ringkas tanpa tanggal, atau null>"
}`;

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

  const cards = await retrieveProjectContext(supabase, body.projectId, body.text, { includeAdvisor: false });
  if (cards.length === 0) {
    return NextResponse.json({ ok: false, error: "Belum ada kartu di proyek ini — buat kartu dulu" });
  }

  const cardList = cards.map(({ card, topicName }) =>
    `- card_id=${card.id} | topic="${topicName}" | title="${card.title}"${card.current_summary ? ` | summary="${card.current_summary}"` : ""}`
  ).join("\n");

  // Fetch the project's existing areas so the AI can hint which room the note
  // refers to. Read-only, room-naming fields only — no cost data.
  const { data: areaRows } = await supabase
    .from("areas")
    .select("id, area_code, area_name, floor")
    .eq("project_id", body.projectId)
    .order("sort_order", { ascending: true });
  const areas = areaRows ?? [];
  const validAreaCodes = new Set(areas.map((a) => a.area_code));
  const areaBlock = areas.length > 0
    ? `\n\nAREA TERSEDIA (untuk area_hint — pilih hanya dari sini):\n${areas
        .map((a) => `- ${a.area_code} | ${a.area_name}${a.floor ? ` | ${a.floor}` : ""}`)
        .join("\n")}`
    : "";

  const fileHint = body.file
    ? `\n\nLAMPIRAN FILE TERLAMPIR:\n- Nama: ${body.file.name}\n- Mime: ${body.file.mime}\n- Ukuran: ${Math.round(body.file.size / 1024)} KB\nPilih event_kind "photo" untuk gambar (image/*) atau "document" untuk PDF, kecuali konteks input jelas-jelas berbeda.`
    : "";

  // Static system prompt is sent as a cache_control content block (prompt
  // caching beta — see lib/assistant/anthropic.ts); the card list + user input
  // change per request and stay in the user message, uncached.
  let res: Anthropic.Message;
  try {
    res = await getAnthropicClient().messages.create({
      model: getModel(),
      max_tokens: 1024,
      system: cachedSystemBlock(CAPTURE_SYSTEM),
      messages: [{
        role: "user",
        content: `KARTU TERSEDIA:\n${cardList}${areaBlock}\n\nINPUT PENGGUNA:\n${body.text}${fileHint}`,
      }],
    });
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

  const raw = textOf(res.content).trim();

  // Be lenient: strip markdown fence if present
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();

  let parsed: {
    card_id?: unknown;
    event_kind?: unknown;
    payload?: unknown;
    rationale?: unknown;
    confidence?: unknown;
    area_hint?: unknown;
    suggested_title?: unknown;
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

  // Validate area_hint: must be an existing area_code in THIS project.
  // The model can only ever choose from the list we sent; we still verify so a
  // hallucinated/stale code never leaks into the proposal.
  const hintStr = typeof parsed.area_hint === "string" ? parsed.area_hint.trim() : "";
  const hintArea = hintStr && validAreaCodes.has(hintStr)
    ? areas.find((a) => a.area_code === hintStr) ?? null
    : null;

  // If the AI matched a Trello-import template placeholder, the proposal will
  // CREATE A NEW card (named "<WIB-date> - <label>") rather than bury the event
  // in the stub. The placeholder card is left untouched as a naming guide.
  const createNew = isTemplateCardTitle(target.card.title);
  let newCardTitle: string | null = null;
  if (createNew) {
    const wibToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })
      .format(new Date());
    const label = deriveCardLabel(
      parsed.suggested_title,
      payloadCheck.data as Record<string, unknown>,
      body.text,
    );
    newCardTitle = `${wibToday} - ${label}`.slice(0, 120);
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
      fileMeta:   body.file ? { name: body.file.name, mime: body.file.mime, size: body.file.size } : null,
      areaHint:   hintArea ? { areaId: hintArea.id, areaCode: hintArea.area_code, areaName: hintArea.area_name } : null,
      createNew,
      newCardTitle,
      topicId:    target.card.topic_id,
    },
  });
}
