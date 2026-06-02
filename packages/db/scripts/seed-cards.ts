import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import type { Database } from "../src";

config({ path: resolve(__dirname, "../../../.env") });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const srk = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient<Database>(url, srk, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SeedCard = {
  projectCode: string;
  topicCode: string;
  title: string;
  slug: string;
  currentSummary?: string;
  events: Array<{
    kind: Database["public"]["Enums"]["card_event_kind"];
    occurredAt: string;
    payload: Record<string, unknown>;
    costVisible?: boolean;
  }>;
};

const SEED: SeedCard[] = [
  {
    projectCode: "BDG-H1",
    topicCode: "A09",
    title: "Master bathroom",
    slug: "master-bathroom",
    currentSummary: "Marmer Statuario disetujui klien; vendor PT Galleria; pelebaran shower lt 2 menunggu",
    events: [
      { kind: "drawing", occurredAt: "2026-02-11T10:00:00Z",
        payload: { description: "Survei Galleria — sample marmer", drawing_code: "A09" } },
      { kind: "vendor", occurredAt: "2026-05-18T09:00:00Z",
        payload: { interaction: "quote", vendor_name: "PT Galleria", amount: 2400000, currency: "IDR", quote_date: "2026-05-18" },
        costVisible: true },
      { kind: "decision", occurredAt: "2026-05-20T14:30:00Z",
        payload: { topic: "marmer lantai master bath", proposed_spec: "Statuario", approved_by: "client" } },
      { kind: "note", occurredAt: "2026-05-22T08:00:00Z",
        payload: { body: "(menunggu) Pelebaran shower lt 2 — menunggu konfirmasi Wilson" } },
    ],
  },
  {
    projectCode: "BDG-H1",
    topicCode: "A05",
    title: "Pintu utama lt 1",
    slug: "pintu-utama-lt1",
    events: [
      { kind: "drawing", occurredAt: "2024-10-18T09:00:00Z",
        payload: { description: "Kusen D11, D12 dan D13", drawing_code: "A05" } },
      { kind: "decision", occurredAt: "2024-11-05T11:00:00Z",
        payload: { topic: "finishing kayu", proposed_spec: "jati natural duco", approved_by: "client" } },
    ],
  },
  {
    projectCode: "PKW-PC1012",
    topicCode: "A09",
    title: "Master bathroom",
    slug: "master-bathroom",
    events: [
      { kind: "drawing", occurredAt: "2026-02-11T10:00:00Z",
        payload: { description: "Survei Galleria", drawing_code: "A09" } },
      { kind: "client_request", occurredAt: "2026-03-15T14:00:00Z",
        payload: { request_text: "Klien minta sample marmer 3 opsi", requested_by: "Bu Setiono" } },
    ],
  },
];

async function main() {
  const { data: staff } = await admin.from("staff").select("id, full_name").eq("full_name", "Wilson Harkhono");
  const wilsonId = staff?.[0]?.id;
  if (!wilsonId) throw new Error("Wilson staff row not found — run seed-pilot.ts first");

  for (const card of SEED) {
    const { data: proj } = await admin.from("projects").select("id").eq("project_code", card.projectCode).single();
    if (!proj) { console.warn(`skip ${card.projectCode}/${card.slug}: project not found`); continue; }

    const { data: topic } = await admin.from("topics").select("id")
      .eq("project_id", proj.id).eq("code", card.topicCode).single();
    if (!topic) { console.warn(`skip ${card.projectCode}/${card.slug}: topic ${card.topicCode} not found`); continue; }

    const { data: existing } = await admin.from("cards").select("id")
      .eq("project_id", proj.id).eq("slug", card.slug).maybeSingle();

    let cardId = existing?.id;
    if (!cardId) {
      const { data: ins, error } = await admin.from("cards").insert({
        project_id: proj.id,
        topic_id:   topic.id,
        title:      card.title,
        slug:       card.slug,
        current_summary: card.currentSummary ?? null,
        created_by_staff_id: wilsonId,
      }).select("id").single();
      if (error) throw error;
      cardId = ins.id;
    }

    // Idempotent: replace events for this card on each run.
    await admin.from("card_events").delete().eq("card_id", cardId);

    for (const ev of card.events) {
      const { error } = await admin.from("card_events").insert({
        card_id:    cardId,
        project_id: proj.id,
        event_kind: ev.kind,
        payload:    ev.payload as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
        occurred_at: ev.occurredAt,
        logged_by_staff_id: wilsonId,
        source_kind: "manual",
        cost_visible: ev.costVisible ?? false,
      });
      if (error) throw error;
    }
    console.log(`seeded ${card.projectCode}/${card.slug} with ${card.events.length} events`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
