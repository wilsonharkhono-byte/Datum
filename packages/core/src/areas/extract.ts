// packages/core/src/areas/extract.ts
//
// AI area extraction — PURE helpers only.
//
// The normalisation + validation logic lives here so it can be shared between
// web and mobile and unit-tested without hitting the Anthropic API.
//
// The Anthropic network call (extractAreaProposal with defaultRunModel) stays
// in apps/web/app/api/areas/suggest/route.ts — that is server-only code and
// MUST NOT move to core.

import { z } from "zod";

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

/** Strip an accidental ```json fence and parse to a plain object. */
export function parseModelJson(rawText: string): unknown {
  const cleaned = rawText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}
