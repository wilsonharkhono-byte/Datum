import { describe, it, expect } from "vitest";
import { normalizeProposal, normalizeAreaCode, parseModelJson, type ExtractCard, type ExistingArea } from "./extract";

const card = (id: string): ExtractCard => ({
  id,
  title: `Card ${id}`,
  currentSummary: null,
  topicName: null,
});

const existing = (areaCode: string): ExistingArea => ({
  areaCode,
  areaName: `Area ${areaCode}`,
  floor: null,
  areaType: "general",
});

describe("normalizeAreaCode", () => {
  it("uppercases, trims, slugifies", () => {
    expect(normalizeAreaCode("l1 kitchen")).toBe("L1-KITCHEN");
    expect(normalizeAreaCode("  KM-ANAK  ")).toBe("KM-ANAK");
    expect(normalizeAreaCode("L1--KITCHEN--")).toBe("L1-KITCHEN");
  });
  it("strips non-alphanumeric-hyphen characters", () => {
    expect(normalizeAreaCode("L1.Kitchen!")).toBe("L1KITCHEN");
  });
  it("returns empty string for blank input", () => {
    expect(normalizeAreaCode("   ")).toBe("");
  });
});

describe("parseModelJson", () => {
  it("parses clean JSON", () => {
    expect(parseModelJson('{"areas":[]}')).toEqual({ areas: [] });
  });
  it("strips markdown fences", () => {
    expect(parseModelJson("```json\n{\"areas\":[]}\n```")).toEqual({ areas: [] });
    expect(parseModelJson("```\n{\"areas\":[]}\n```")).toEqual({ areas: [] });
  });
  it("returns empty object on invalid JSON", () => {
    expect(parseModelJson("not json at all")).toEqual({});
  });
});

describe("normalizeProposal", () => {
  it("falls back to existing areas on invalid raw input", () => {
    const result = normalizeProposal(null, {
      cards: [card("c1")],
      existingAreas: [existing("LIVING")],
    });
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0]!.areaCode).toBe("LIVING");
    expect(result.areas[0]!.isExisting).toBe(true);
    expect(result.assignments).toHaveLength(0);
  });

  it("includes existing areas and merges new model areas", () => {
    const raw = {
      areas: [
        { area_code: "KM-ANAK", area_name: "Kamar Mandi Anak", floor: "Lt.1", area_type: "bathroom" },
      ],
      assignments: [{ card_id: "c1", area_code: "KM-ANAK", confidence: 0.9 }],
    };
    const result = normalizeProposal(raw, {
      cards: [card("c1")],
      existingAreas: [existing("LIVING")],
    });
    expect(result.areas.find((a) => a.areaCode === "LIVING")!.isExisting).toBe(true);
    expect(result.areas.find((a) => a.areaCode === "KM-ANAK")!.isExisting).toBe(false);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.cardId).toBe("c1");
    expect(result.assignments[0]!.confidence).toBe(0.9);
  });

  it("existing area wins over model-proposed area with same code", () => {
    const raw = {
      areas: [
        { area_code: "LIVING", area_name: "NEW NAME FROM MODEL", area_type: "kitchen" },
      ],
    };
    const result = normalizeProposal(raw, {
      cards: [],
      existingAreas: [existing("LIVING")],
    });
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0]!.areaName).toBe("Area LIVING"); // original name wins
  });

  it("drops assignments for unknown card ids", () => {
    const raw = {
      areas: [{ area_code: "A1", area_name: "A1", area_type: "general" }],
      assignments: [{ card_id: "GHOST-ID", area_code: "A1", confidence: 0.8 }],
    };
    const result = normalizeProposal(raw, { cards: [card("c1")], existingAreas: [] });
    expect(result.assignments).toHaveLength(0);
  });

  it("keeps highest-confidence assignment when card has duplicates", () => {
    const raw = {
      areas: [
        { area_code: "A1", area_name: "A1", area_type: "general" },
        { area_code: "B1", area_name: "B1", area_type: "general" },
      ],
      assignments: [
        { card_id: "c1", area_code: "A1", confidence: 0.6 },
        { card_id: "c1", area_code: "B1", confidence: 0.9 },
      ],
    };
    const result = normalizeProposal(raw, { cards: [card("c1")], existingAreas: [] });
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.areaCode).toBe("B1");
  });
});
