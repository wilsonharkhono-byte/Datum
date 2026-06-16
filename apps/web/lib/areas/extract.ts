// apps/web/lib/areas/extract.ts
//
// AI area extraction. Pure-ish: takes the project's cards (id/title/summary/
// topic only — NEVER cost data) plus the project's existing areas, asks the
// model for a canonical area list + card→area assignments, then validates and
// normalizes the model output into a trustworthy proposal.
//
// The network call lives behind a small injectable seam (`runModel`) so the
// parse/validate/dedupe/idempotence logic can be unit-tested without hitting
// the Anthropic API. The model output is DATA we validate, never executed.

import { z } from "zod";
import {
  getAnthropicClient,
  getModel,
  cachedSystemBlock,
  textOf,
} from "@/lib/assistant/anthropic";

// area_type enum mirrors packages/db/src/types.generated.ts ("area_type").
// Kept inline (not imported) because it's a closed string union we validate
// the model against — drift here is caught by the type-check on AreaTypeEnum.
export const AREA_TYPES = [
  "bathroom",
  "kitchen",
  "bedroom",
  "living",
  "dining",
  "garden",
  "circulation",
  "utility",
  "general",
] as const;
export type AreaType = (typeof AREA_TYPES)[number];

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** A card as fed to the extractor. Deliberately cost-free: no amounts, no
 *  payloads, no vendor data — only the room-naming text fields. */
export type ExtractCard = {
  id: string;
  title: string;
  currentSummary: string | null;
  topicName: string | null;
};

/** An existing area, so re-runs reuse codes and stay idempotent. */
export type ExistingArea = {
  areaCode: string;
  areaName: string;
  floor: string | null;
  areaType: AreaType;
};

// ─── Output proposal shape ───────────────────────────────────────────────────

export type ProposedArea = {
  areaCode: string;
  areaName: string;
  floor: string | null;
  areaType: AreaType;
  /** True when this code already exists in the project (will be reused, not
   *  inserted). The review UI shows existing areas differently. */
  isExisting: boolean;
};

export type ProposedAssignment = {
  cardId: string;
  areaCode: string;
  confidence: number; // 0..1
};

export type AreaProposal = {
  areas: ProposedArea[];
  assignments: ProposedAssignment[];
};

// ─── Model output validation (defensive: the model can return junk) ──────────

const RawArea = z.object({
  area_code: z.string().min(1).max(40),
  area_name: z.string().min(1).max(120),
  floor: z.string().max(40).nullish(),
  // Be lenient on area_type: anything off-enum is coerced to "general" in
  // normalization rather than rejecting the whole area.
  area_type: z.string().max(40).optional(),
});

const RawAssignment = z.object({
  card_id: z.string().min(1).max(80),
  area_code: z.string().min(1).max(40),
  confidence: z.number().nullish(),
});

const RawProposal = z.object({
  areas: z.array(RawArea).max(200).optional(),
  assignments: z.array(RawAssignment).max(2000).optional(),
});

export type RawAreaProposal = z.infer<typeof RawProposal>;

// ─── Normalization helpers ───────────────────────────────────────────────────

/** Uppercase, trim, collapse whitespace/odd chars into a stable slug so two
 *  spellings of the same code ("l1 kitchen" vs "L1-KITCHEN") dedupe to one. */
export function normalizeAreaCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function coerceAreaType(raw: string | undefined | null): AreaType {
  if (!raw) return "general";
  const lower = raw.trim().toLowerCase();
  return (AREA_TYPES as readonly string[]).includes(lower)
    ? (lower as AreaType)
    : "general";
}

function clampConfidence(raw: number | null | undefined): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0.5;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * Validate + normalize raw model output into a trustworthy proposal.
 *
 * Guarantees:
 * - area_codes are normalized + deduped (existing-area codes win their slot).
 * - every existing area is included (so re-runs are idempotent and the UI can
 *   reuse codes), tagged isExisting.
 * - assignments only reference cards that exist in the project AND an area_code
 *   that exists in the final area set (model-invented codes are dropped).
 * - one assignment per card (highest confidence wins on duplicates).
 * - off-enum area_type → "general"; out-of-range confidence clamped to [0,1].
 *
 * This is pure — no I/O — and is the unit-tested core.
 */
export function normalizeProposal(
  raw: unknown,
  ctx: { cards: ExtractCard[]; existingAreas: ExistingArea[] },
): AreaProposal {
  const parsed = RawProposal.safeParse(raw);
  if (!parsed.success) {
    // Unparseable shape: fall back to existing areas only, no new assignments.
    return {
      areas: ctx.existingAreas.map((a) => ({
        areaCode: a.areaCode,
        areaName: a.areaName,
        floor: a.floor,
        areaType: a.areaType,
        isExisting: true,
      })),
      assignments: [],
    };
  }

  const validCardIds = new Set(ctx.cards.map((c) => c.id));

  // 1. Seed area map with existing areas (normalized codes). These are
  //    authoritative — the model can't rename or retype an existing area.
  const areaByCode = new Map<string, ProposedArea>();
  for (const a of ctx.existingAreas) {
    const code = normalizeAreaCode(a.areaCode);
    if (!code) continue;
    areaByCode.set(code, {
      areaCode: code,
      areaName: a.areaName,
      floor: a.floor,
      areaType: a.areaType,
      isExisting: true,
    });
  }

  // 2. Merge model-proposed NEW areas; skip codes that already exist.
  for (const a of parsed.data.areas ?? []) {
    const code = normalizeAreaCode(a.area_code);
    if (!code) continue;
    if (areaByCode.has(code)) continue; // existing wins, don't overwrite
    areaByCode.set(code, {
      areaCode: code,
      areaName: a.area_name.trim().slice(0, 120),
      floor: a.floor?.trim() ? a.floor.trim().slice(0, 40) : null,
      areaType: coerceAreaType(a.area_type),
      isExisting: false,
    });
  }

  // 3. Assignments: one per card, must reference a known card + known area.
  const bestByCard = new Map<string, ProposedAssignment>();
  for (const asg of parsed.data.assignments ?? []) {
    const cardId = asg.card_id.trim();
    if (!validCardIds.has(cardId)) continue;
    const code = normalizeAreaCode(asg.area_code);
    if (!areaByCode.has(code)) continue; // model invented an unknown area code
    const confidence = clampConfidence(asg.confidence);
    const existing = bestByCard.get(cardId);
    if (!existing || confidence > existing.confidence) {
      bestByCard.set(cardId, { cardId, areaCode: code, confidence });
    }
  }

  return {
    areas: [...areaByCode.values()],
    assignments: [...bestByCard.values()],
  };
}

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

/** Strip an accidental ```json fence and parse to a plain object. */
export function parseModelJson(rawText: string): unknown {
  const cleaned = rawText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

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
