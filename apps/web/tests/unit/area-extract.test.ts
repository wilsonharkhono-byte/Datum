import { describe, expect, it } from "vitest";
import {
  normalizeAreaCode,
  normalizeProposal,
  parseModelJson,
  extractAreaProposal,
  type ExtractCard,
  type ExistingArea,
} from "@/lib/areas/extract";

const CARDS: ExtractCard[] = [
  { id: "c1", title: "Kamar mandi anak", currentSummary: null, topicName: "Finishing" },
  { id: "c2", title: "Pola lantai living", currentSummary: "marmer", topicName: "Material" },
  { id: "c3", title: "Kusen kamar lt 3", currentSummary: null, topicName: "Carpentry" },
];

const EXISTING: ExistingArea[] = [
  { areaCode: "KM-ANAK", areaName: "Kamar Mandi Anak", floor: "Lt. 2", areaType: "bathroom" },
];

describe("normalizeAreaCode", () => {
  it("uppercases, slugs whitespace, strips junk", () => {
    expect(normalizeAreaCode("l1 kitchen")).toBe("L1-KITCHEN");
    expect(normalizeAreaCode("  km/anak  ")).toBe("KMANAK");
    expect(normalizeAreaCode("Living—Lt1!")).toBe("LIVINGLT1");
  });

  it("collapses repeated and trailing dashes", () => {
    expect(normalizeAreaCode("a--b-")).toBe("A-B");
    expect(normalizeAreaCode("-x-")).toBe("X");
  });

  it("caps length at 40 chars", () => {
    expect(normalizeAreaCode("A".repeat(60)).length).toBe(40);
  });
});

describe("parseModelJson", () => {
  it("parses plain JSON", () => {
    expect(parseModelJson('{"areas":[]}')).toEqual({ areas: [] });
  });

  it("strips a ```json fence", () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("returns {} on garbage rather than throwing", () => {
    expect(parseModelJson("not json at all")).toEqual({});
  });
});

describe("normalizeProposal — validation", () => {
  it("returns existing-areas-only when the shape is unparseable", () => {
    const out = normalizeProposal("💥 not an object", { cards: CARDS, existingAreas: EXISTING });
    expect(out.assignments).toEqual([]);
    expect(out.areas).toHaveLength(1);
    expect(out.areas[0]).toMatchObject({ areaCode: "KM-ANAK", isExisting: true });
  });

  it("drops assignments referencing unknown cards", () => {
    const raw = {
      areas: [{ area_code: "L1-LIVING", area_name: "Living Lt.1", area_type: "living" }],
      assignments: [
        { card_id: "c2", area_code: "L1-LIVING", confidence: 0.9 },
        { card_id: "ghost", area_code: "L1-LIVING", confidence: 0.9 },
      ],
    };
    const out = normalizeProposal(raw, { cards: CARDS, existingAreas: [] });
    expect(out.assignments).toHaveLength(1);
    expect(out.assignments[0]).toMatchObject({ cardId: "c2", areaCode: "L1-LIVING" });
  });

  it("drops assignments whose area_code was never proposed", () => {
    const raw = {
      areas: [{ area_code: "L1-LIVING", area_name: "Living", area_type: "living" }],
      assignments: [{ card_id: "c2", area_code: "MADE-UP", confidence: 0.9 }],
    };
    const out = normalizeProposal(raw, { cards: CARDS, existingAreas: [] });
    expect(out.assignments).toEqual([]);
  });

  it("coerces off-enum area_type to general", () => {
    const raw = { areas: [{ area_code: "X", area_name: "X", area_type: "spaceship" }] };
    const out = normalizeProposal(raw, { cards: CARDS, existingAreas: [] });
    expect(out.areas.find((a) => a.areaCode === "X")?.areaType).toBe("general");
  });

  it("clamps confidence into [0,1] and defaults missing to 0.5", () => {
    const raw = {
      areas: [{ area_code: "A", area_name: "A", area_type: "general" }],
      assignments: [
        { card_id: "c1", area_code: "A", confidence: 5 },
        { card_id: "c2", area_code: "A", confidence: -3 },
        { card_id: "c3", area_code: "A" },
      ],
    };
    const out = normalizeProposal(raw, { cards: CARDS, existingAreas: [] });
    const byCard = Object.fromEntries(out.assignments.map((a) => [a.cardId, a.confidence]));
    expect(byCard.c1).toBe(1);
    expect(byCard.c2).toBe(0);
    expect(byCard.c3).toBe(0.5);
  });
});

describe("normalizeProposal — dedupe + idempotence", () => {
  it("dedupes area_codes by normalized slug, existing area wins", () => {
    const raw = {
      // model re-proposes the existing KM-ANAK with a different name/casing
      areas: [
        { area_code: "km anak", area_name: "Bathroom Kid (model)", area_type: "general" },
        { area_code: "L1-LIVING", area_name: "Living Lt.1", area_type: "living" },
        { area_code: "L1 LIVING", area_name: "Living dup", area_type: "living" },
      ],
    };
    const out = normalizeProposal(raw, { cards: CARDS, existingAreas: EXISTING });
    // KM-ANAK kept once with the EXISTING name + type, marked isExisting.
    const kmAnak = out.areas.filter((a) => a.areaCode === "KM-ANAK");
    expect(kmAnak).toHaveLength(1);
    expect(kmAnak[0]).toMatchObject({
      areaName: "Kamar Mandi Anak",
      areaType: "bathroom",
      isExisting: true,
    });
    // L1-LIVING deduped to one despite two spellings, marked new.
    const living = out.areas.filter((a) => a.areaCode === "L1-LIVING");
    expect(living).toHaveLength(1);
    expect(living[0]).toMatchObject({ isExisting: false, areaName: "Living Lt.1" }); // first spelling wins
  });

  it("keeps one assignment per card (highest confidence wins)", () => {
    const raw = {
      areas: [
        { area_code: "A", area_name: "A", area_type: "general" },
        { area_code: "B", area_name: "B", area_type: "general" },
      ],
      assignments: [
        { card_id: "c1", area_code: "A", confidence: 0.4 },
        { card_id: "c1", area_code: "B", confidence: 0.8 },
      ],
    };
    const out = normalizeProposal(raw, { cards: CARDS, existingAreas: [] });
    const c1 = out.assignments.filter((a) => a.cardId === "c1");
    expect(c1).toHaveLength(1);
    expect(c1[0]).toMatchObject({ areaCode: "B", confidence: 0.8 });
  });

  it("always includes every existing area even with empty model output", () => {
    const out = normalizeProposal({}, { cards: CARDS, existingAreas: EXISTING });
    expect(out.areas.map((a) => a.areaCode)).toContain("KM-ANAK");
    expect(out.areas.every((a) => a.isExisting)).toBe(true);
  });

  it("is idempotent: feeding existing areas back yields the same area set", () => {
    // Simulate a re-run where the model echoes the existing area as a "new"
    // proposal. The output must not duplicate it.
    const raw = {
      areas: [{ area_code: "KM-ANAK", area_name: "echo", area_type: "general" }],
      assignments: [{ card_id: "c1", area_code: "KM-ANAK", confidence: 0.95 }],
    };
    const out = normalizeProposal(raw, { cards: CARDS, existingAreas: EXISTING });
    expect(out.areas).toHaveLength(1);
    expect(out.areas[0]).toMatchObject({ isExisting: true });
    expect(out.assignments).toEqual([
      { cardId: "c1", areaCode: "KM-ANAK", confidence: 0.95 },
    ]);
  });
});

describe("extractAreaProposal — with mocked model", () => {
  it("threads the model output through parse + normalize", async () => {
    const fakeModel = async () =>
      JSON.stringify({
        areas: [{ area_code: "L1-LIVING", area_name: "Living Lt.1", area_type: "living" }],
        assignments: [{ card_id: "c2", area_code: "l1 living", confidence: 0.9 }],
      });
    const out = await extractAreaProposal({ cards: CARDS, existingAreas: [] }, fakeModel);
    expect(out.areas).toHaveLength(1);
    expect(out.assignments).toEqual([
      { cardId: "c2", areaCode: "L1-LIVING", confidence: 0.9 },
    ]);
  });

  it("survives a model that returns fenced junk", async () => {
    const fakeModel = async () => "```json\nthis is broken\n```";
    const out = await extractAreaProposal({ cards: CARDS, existingAreas: EXISTING }, fakeModel);
    expect(out.assignments).toEqual([]);
    expect(out.areas.map((a) => a.areaCode)).toEqual(["KM-ANAK"]);
  });

  it("does not call the model when there are no cards", async () => {
    let called = false;
    const fakeModel = async () => {
      called = true;
      return "{}";
    };
    const out = await extractAreaProposal({ cards: [], existingAreas: EXISTING }, fakeModel);
    expect(called).toBe(false);
    expect(out.areas).toHaveLength(1);
  });
});
