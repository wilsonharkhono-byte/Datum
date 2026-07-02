/**
 * Deterministic area hint at capture — zero-latency, no AI.
 *
 * Given a card's title / topic name and the project's areas, suggest a single
 * best-match area so the UI can pre-check a "link to area" chip. Never
 * guesses between ambiguous candidates (e.g. two bathrooms on the same
 * floor) — returns null rather than risk a wrong link.
 *
 * Priority:
 *   1. Topic name — normalized token overlap against area_name/area_code
 *      (room-word tokens + floor tokens). An WHAstudio topic like
 *      "LANTAI 1 KITCHEN" should resolve to area "Kitchen Lt.1" /
 *      code "L1-KITCHEN".
 *   2. Card title — room-type keywords mapped to area_type, optionally
 *      narrowed by a floor token in the title when a keyword hits more than
 *      one area.
 */

export type HintArea = {
  id: string;
  area_name: string;
  area_code: string;
  floor?: string | null;
  area_type?: string | null;
};

export type AreaHint = { area: HintArea; reason: "topic" | "title" };

// ─── Normalization ──────────────────────────────────────────────────────────

/** Uppercase, strip non-alphanumerics to spaces, collapse whitespace. */
function normalize(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(input: string): string[] {
  const n = normalize(input);
  return n.length > 0 ? n.split(" ") : [];
}

/**
 * Canonicalize a floor token. "LANTAI"/"LT"/"L" followed by (or fused with)
 * a digit all collapse to "L<digit>", e.g. "LANTAI 1" / "LT 1" / "L1" → "L1".
 * Returns the set of canonical floor tokens found in a token stream.
 */
function floorTokens(toks: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === undefined) continue;
    // Fused form: "L1", "LT1"
    const fused = t.match(/^(?:LANTAI|LT|L)(\d+)$/);
    if (fused) {
      out.add(`L${fused[1]}`);
      continue;
    }
    // Split form: "LANTAI" / "LT" / "L" followed by a bare digit token.
    const next = toks[i + 1];
    if ((t === "LANTAI" || t === "LT" || t === "L") && next !== undefined && /^\d+$/.test(next)) {
      out.add(`L${next}`);
    }
  }
  return out;
}

// ─── Room-type keyword → area_type ──────────────────────────────────────────

const ROOM_KEYWORDS: Array<{ areaType: string; words: string[] }> = [
  { areaType: "bathroom", words: ["KAMAR MANDI", "KM", "BATHROOM", "WC", "TOILET"] },
  { areaType: "kitchen", words: ["KITCHEN", "DAPUR", "PANTRY"] },
  { areaType: "bedroom", words: ["BEDROOM", "KAMAR TIDUR", "MBR"] },
  { areaType: "living", words: ["LIVING", "RUANG TAMU"] },
];

/** Find area_types whose keyword phrase appears (as a token subsequence) in the normalized text. */
function matchRoomTypes(normalizedText: string): Set<string> {
  const out = new Set<string>();
  for (const { areaType, words } of ROOM_KEYWORDS) {
    for (const word of words) {
      const needle = normalize(word);
      if (containsPhrase(normalizedText, needle)) {
        out.add(areaType);
        break;
      }
    }
  }
  return out;
}

/** Whether `needle` (space-joined tokens) appears as a contiguous token subsequence of `haystack`. */
function containsPhrase(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const h = ` ${haystack} `;
  const n = ` ${needle} `;
  return h.includes(n);
}

// ─── Priority 1: topic match ────────────────────────────────────────────────

function tryTopicMatch(topicName: string | null, areas: HintArea[]): HintArea | null {
  if (!topicName) return null;
  const topicNorm = normalize(topicName);
  if (topicNorm.length === 0) return null;
  const topicToks = tokens(topicName);
  const topicFloors = floorTokens(topicToks);
  const topicRoomTypes = matchRoomTypes(topicNorm);

  const candidates: HintArea[] = [];
  for (const area of areas) {
    const nameNorm = normalize(area.area_name);
    const codeNorm = normalize(area.area_code);

    // Exact-ish match: topic normalizes to the same text as the area name or
    // code — wins immediately regardless of anything else.
    if (topicNorm === nameNorm || topicNorm === codeNorm) {
      return area;
    }

    const nameToks = tokens(area.area_name);
    const codeToks = tokens(area.area_code);
    const areaFloors = new Set<string>([
      ...floorTokens(nameToks),
      ...floorTokens(codeToks),
      ...(area.floor ? floorTokens(tokens(area.floor)) : []),
    ]);

    const areaRoomTypes = matchRoomTypes(`${nameNorm} ${codeNorm}`);
    // Also treat the area's own declared area_type as a room-type token.
    if (area.area_type) areaRoomTypes.add(area.area_type);

    const roomOverlap = [...topicRoomTypes].some((rt) => areaRoomTypes.has(rt));
    const floorOverlap = topicFloors.size === 0 || [...topicFloors].some((f) => areaFloors.has(f));

    if (roomOverlap && floorOverlap && topicRoomTypes.size > 0) {
      // Prefer areas where floor also matched when topic specified a floor.
      candidates.push(area);
    }
  }

  if (candidates.length === 1) return candidates[0] ?? null;
  if (candidates.length > 1 && topicFloors.size > 0) {
    // Narrow further by exact floor match.
    const narrowed = candidates.filter((area) => {
      const areaFloors = new Set<string>([
        ...floorTokens(tokens(area.area_name)),
        ...floorTokens(tokens(area.area_code)),
        ...(area.floor ? floorTokens(tokens(area.floor)) : []),
      ]);
      return [...topicFloors].some((f) => areaFloors.has(f));
    });
    if (narrowed.length === 1) return narrowed[0] ?? null;
  }
  return null;
}

// ─── Priority 2: card title match ───────────────────────────────────────────

function tryTitleMatch(cardTitle: string, areas: HintArea[]): HintArea | null {
  const titleToks = tokens(cardTitle);
  if (titleToks.length === 0) return null;
  const titleNorm = titleToks.join(" ");
  const titleRoomTypes = matchRoomTypes(titleNorm);
  if (titleRoomTypes.size === 0) return null;
  const titleFloors = floorTokens(titleToks);

  const candidates = areas.filter((area) => area.area_type && titleRoomTypes.has(area.area_type));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0] ?? null;

  // Ambiguous by room type alone — try narrowing by a floor token in the title.
  if (titleFloors.size > 0) {
    const narrowed = candidates.filter((area) => {
      const areaFloors = new Set<string>([
        ...floorTokens(tokens(area.area_name)),
        ...floorTokens(tokens(area.area_code)),
        ...(area.floor ? floorTokens(tokens(area.floor)) : []),
      ]);
      return [...titleFloors].some((f) => areaFloors.has(f));
    });
    if (narrowed.length === 1) return narrowed[0] ?? null;
  }

  return null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function suggestAreaForCard(args: {
  cardTitle: string;
  topicName: string | null;
  areas: HintArea[];
}): AreaHint | null {
  const { cardTitle, topicName, areas } = args;
  if (areas.length === 0) return null;

  const topicHit = tryTopicMatch(topicName, areas);
  if (topicHit) return { area: topicHit, reason: "topic" };

  const titleHit = tryTitleMatch(cardTitle, areas);
  if (titleHit) return { area: titleHit, reason: "title" };

  return null;
}
