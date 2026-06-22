// apps/web/lib/areas/extract.ts
//
// Pure helpers are in @datum/core — re-exported here for backward compat.
// The Anthropic network call (extractAreaProposal + defaultRunModel) stays
// here because it requires server-only deps (getAnthropicClient, etc.).

import {
  getAnthropicClient,
  getModel,
  cachedSystemBlock,
  textOf,
} from "@/lib/assistant/anthropic";

import {
  normalizeProposal,
  parseModelJson,
  type ExtractCard,
  type ExistingArea,
  type AreaProposal,
} from "@datum/core";

// ─── Re-export pure helpers from core ────────────────────────────────────────
export {
  AREA_TYPES,
  type AreaType,
  type ExtractCard,
  type ExistingArea,
  type ProposedArea,
  type ProposedAssignment,
  type AreaProposal,
  type RawAreaProposal,
  normalizeAreaCode,
  normalizeProposal,
  parseModelJson,
} from "@datum/core";

// ─── Prompt + network seam ───────────────────────────────────────────────────

const EXTRACT_SYSTEM = `Anda adalah asisten internal DATUM untuk WHAstudio (studio arsitektur interior).

TUGAS: Dari daftar KARTU sebuah proyek, identifikasi RUANGAN/ZONA FISIK (area) yang disebut, lalu petakan tiap kartu ke area-nya.

PENTING — APA ITU AREA:
- Area = ruangan atau zona fisik nyata: "Kamar Mandi Anak", "Living Lt.1", "Kitchen Lt.1", "Kamar Tidur Utama", "Carport".
- Area BUKAN topik/disiplin (mis. "MEP", "Furniture", "Finishing") — itu bukan ruangan.
- Judul/aktivitas kartu sering menyebut ruangan dalam Bahasa Indonesia ("kamar mandi anak", "pola lantai living", "kusen kamar lt 3").

ATURAN KODE AREA (area_code):
- Slug pendek HURUF BESAR, mis. "L1-KITCHEN", "KM-ANAK", "LIVING-LT1".
- Jika sebuah kartu cocok dengan AREA YANG SUDAH ADA (lihat daftar di bawah), GUNAKAN KEMBALI kode itu — jangan buat duplikat.
- Hanya usulkan area BARU jika benar-benar ada ruangan yang belum terdaftar.

ATURAN PENUGASAN (assignments):
- Tugaskan kartu HANYA jika jelas merujuk ke satu ruangan. Jika ambigu / lintas-ruangan / umum, JANGAN ditugaskan (lewati).
- card_id WAJIB diambil persis dari daftar KARTU. Jangan menebak UUID.
- confidence 0..1: seberapa yakin kartu ini milik area tsb.

area_type (opsional, pilih yang paling cocok): bathroom, kitchen, bedroom, living, dining, garden, circulation, utility, general.

FORMAT OUTPUT — WAJIB JSON murni, TANPA markdown fence, TANPA teks di luar JSON:
{
  "areas": [
    { "area_code": "L1-KITCHEN", "area_name": "Kitchen Lt.1", "floor": "Lt. 1", "area_type": "kitchen" }
  ],
  "assignments": [
    { "card_id": "<id dari daftar KARTU>", "area_code": "L1-KITCHEN", "confidence": 0.9 }
  ]
}`;

function buildUserContent(ctx: {
  cards: ExtractCard[];
  existingAreas: ExistingArea[];
}): string {
  const existing =
    ctx.existingAreas.length > 0
      ? ctx.existingAreas
          .map(
            (a) =>
              `- ${a.areaCode} | ${a.areaName}${a.floor ? ` | ${a.floor}` : ""} | ${a.areaType}`,
          )
          .join("\n")
      : "(belum ada area)";

  const cards = ctx.cards
    .map(
      (c) =>
        `- card_id=${c.id} | topic="${c.topicName ?? ""}" | title="${c.title}"${
          c.currentSummary ? ` | summary="${c.currentSummary}"` : ""
        }`,
    )
    .join("\n");

  return `AREA YANG SUDAH ADA:\n${existing}\n\nKARTU:\n${cards}`;
}

/** Injectable model runner — returns the raw text the model produced. */
export type ModelRunner = (args: {
  system: string;
  userContent: string;
}) => Promise<string>;

const defaultRunModel: ModelRunner = async ({ system, userContent }) => {
  const res = await getAnthropicClient().messages.create({
    model: getModel(),
    max_tokens: 2048,
    system: cachedSystemBlock(system),
    messages: [{ role: "user", content: userContent }],
  });
  return textOf(res.content).trim();
};

/**
 * Full extraction: build prompt → run model → parse → normalize.
 * `runModel` is injectable for tests; defaults to the Anthropic call.
 */
export async function extractAreaProposal(
  ctx: { cards: ExtractCard[]; existingAreas: ExistingArea[] },
  runModel: ModelRunner = defaultRunModel,
): Promise<AreaProposal> {
  // No cards → nothing to extract; return existing areas untouched.
  if (ctx.cards.length === 0) {
    return normalizeProposal({}, ctx);
  }

  const rawText = await runModel({
    system: EXTRACT_SYSTEM,
    userContent: buildUserContent(ctx),
  });
  const rawJson = parseModelJson(rawText);
  return normalizeProposal(rawJson, ctx);
}
