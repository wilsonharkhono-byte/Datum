import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff } from "@/lib/auth/require-role";
import { AnthropicNotConfiguredError } from "@/lib/assistant/anthropic";
import {
  extractAreaProposal,
  type ExtractCard,
  type ExistingArea,
  type AreaType,
} from "@/lib/areas/extract";

// READ-ONLY suggest endpoint. Runs AI extraction for a project and returns a
// proposal. Writes nothing — the user reviews + applies via applyAreaProposal.

const Body = z.object({
  projectId: z.string().uuid(),
});

// Cap how many cards we feed the model. Newest-active first; rooms recur, so a
// generous cap covers a project without an unbounded prompt.
const MAX_CARDS = 200;

export async function POST(req: Request) {
  // Auth: signed-in staff only.
  const caller = await getCurrentStaff();
  if (!caller) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  // Membership gate: read the project under the session client. RLS only
  // returns the row if the caller is a member (or principal/admin/estimator).
  // No row → not authorized to read this project.
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id")
    .eq("id", body.projectId)
    .maybeSingle();
  if (projErr) {
    return NextResponse.json({ error: "project_lookup_failed" }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Fetch cards — ONLY room-naming text fields. No cost data, no payloads,
  // no vendor amounts ever reach the prompt (security: §SECURITY CHECKLIST).
  const { data: cardRows, error: cardErr } = await supabase
    .from("cards")
    .select("id, title, current_summary, topics!inner(name)")
    .eq("project_id", body.projectId)
    .eq("status", "active")
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(MAX_CARDS);
  if (cardErr) {
    return NextResponse.json({ error: "cards_lookup_failed" }, { status: 500 });
  }

  const cards: ExtractCard[] = (cardRows ?? []).map((c) => {
    const row = c as unknown as {
      id: string;
      title: string;
      current_summary: string | null;
      topics: { name: string } | null;
    };
    return {
      id: row.id,
      title: row.title,
      currentSummary: row.current_summary,
      topicName: row.topics?.name ?? null,
    };
  });

  if (cards.length === 0) {
    return NextResponse.json({
      ok: false,
      error: "Belum ada kartu aktif di proyek ini — buat kartu dulu sebelum mendeteksi area.",
    });
  }

  // Existing areas so re-runs reuse codes and stay idempotent.
  const { data: areaRows, error: areaErr } = await supabase
    .from("areas")
    .select("area_code, area_name, floor, area_type")
    .eq("project_id", body.projectId);
  if (areaErr) {
    return NextResponse.json({ error: "areas_lookup_failed" }, { status: 500 });
  }
  const existingAreas: ExistingArea[] = (areaRows ?? []).map((a) => ({
    areaCode: a.area_code,
    areaName: a.area_name,
    floor: a.floor,
    areaType: a.area_type as AreaType,
  }));

  try {
    const proposal = await extractAreaProposal({ cards, existingAreas });
    // Ship card titles too so the review UI can show readable labels instead
    // of raw ids. Only assigned cards are needed, but sending all kept cards is
    // cheap and lets the UI label everything consistently.
    const cardTitles = cards.map((c) => ({ id: c.id, title: c.title }));
    return NextResponse.json({ ok: true, proposal, cards: cardTitles });
  } catch (e) {
    if (e instanceof AnthropicNotConfiguredError) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Asisten belum dikonfigurasi. Set ANTHROPIC_API_KEY di .env.local untuk mengaktifkan deteksi area.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Gagal menganalisis kartu. Coba lagi sebentar." },
      { status: 502 },
    );
  }
}
