import { describe, expect, it } from "vitest";
import { suggestAreaForCard, type HintArea } from "@/lib/areas/match-hint";

// Fixture shapes mirror seed data (see area-extract.test.ts): area_code like
// "L1-KM1" / "L1-KITCHEN" / "L2-MBR", area_name like "KM-1 Lt.1" /
// "Kitchen Lt.1" / "Master Bedroom Lt.2".
const AREAS: HintArea[] = [
  { id: "a-km1", area_name: "KM-1 Lt.1", area_code: "L1-KM1", floor: "Lt.1", area_type: "bathroom" },
  { id: "a-km2", area_name: "KM-2 Lt.1", area_code: "L1-KM2", floor: "Lt.1", area_type: "bathroom" },
  { id: "a-km3", area_name: "KM-3 Lt.2", area_code: "L2-KM3", floor: "Lt.2", area_type: "bathroom" },
  { id: "a-mbr", area_name: "Master Bedroom Lt.2", area_code: "L2-MBR", floor: "Lt.2", area_type: "bedroom" },
  { id: "a-kitchen", area_name: "Kitchen Lt.1", area_code: "L1-KITCHEN", floor: "Lt.1", area_type: "kitchen" },
  { id: "a-living", area_name: "Living Lt.1", area_code: "L1-LIVING", floor: "Lt.1", area_type: "living" },
];

describe("suggestAreaForCard — topic match (priority 1)", () => {
  it("matches a topic name like 'LANTAI 1 KITCHEN' to Kitchen Lt.1 by token overlap", () => {
    const result = suggestAreaForCard({
      cardTitle: "ganti keran",
      topicName: "LANTAI 1 KITCHEN",
      areas: AREAS,
    });
    expect(result).not.toBeNull();
    expect(result?.reason).toBe("topic");
    expect(result?.area.id).toBe("a-kitchen");
  });

  it("matches topic 'Kitchen Lt.1' (already-canonical form) directly", () => {
    const result = suggestAreaForCard({
      cardTitle: "random title",
      topicName: "Kitchen Lt.1",
      areas: AREAS,
    });
    expect(result?.reason).toBe("topic");
    expect(result?.area.id).toBe("a-kitchen");
  });

  it("topic exact match wins even when the card title alone would be ambiguous", () => {
    const result = suggestAreaForCard({
      cardTitle: "kamar mandi renovasi",
      topicName: "Master Bedroom Lt.2",
      areas: AREAS,
    });
    expect(result?.reason).toBe("topic");
    expect(result?.area.id).toBe("a-mbr");
  });
});

describe("suggestAreaForCard — card title tokens (priority 2)", () => {
  it("matches a single-candidate room keyword (kitchen) with no topic", () => {
    const result = suggestAreaForCard({
      cardTitle: "ganti keran dapur",
      topicName: null,
      areas: AREAS,
    });
    expect(result?.reason).toBe("title");
    expect(result?.area.id).toBe("a-kitchen");
  });

  it("matches 'living' / 'ruang tamu' keyword to the living area", () => {
    const result = suggestAreaForCard({
      cardTitle: "pola lantai ruang tamu",
      topicName: null,
      areas: AREAS,
    });
    expect(result?.reason).toBe("title");
    expect(result?.area.id).toBe("a-living");
  });

  it("disambiguates two bathrooms on different floors using a floor token in the title", () => {
    const result = suggestAreaForCard({
      cardTitle: "kusen pintu km lt 2",
      topicName: null,
      areas: AREAS,
    });
    expect(result?.reason).toBe("title");
    expect(result?.area.id).toBe("a-km3");
  });

  it("returns null when a room keyword matches multiple candidates and no floor token disambiguates", () => {
    const result = suggestAreaForCard({
      cardTitle: "kamar mandi bocor",
      topicName: null,
      areas: AREAS,
    });
    expect(result).toBeNull();
  });

  it("returns null when a floor token still leaves 2+ candidates (KM-1 and KM-2, both Lt.1)", () => {
    const result = suggestAreaForCard({
      cardTitle: "kamar mandi lt 1 bocor",
      topicName: null,
      areas: AREAS,
    });
    expect(result).toBeNull();
  });

  it("matches bedroom keyword 'mbr' to Master Bedroom", () => {
    const result = suggestAreaForCard({
      cardTitle: "kusen pintu master bedroom",
      topicName: null,
      areas: AREAS,
    });
    expect(result?.reason).toBe("title");
    expect(result?.area.id).toBe("a-mbr");
  });
});

describe("suggestAreaForCard — no match", () => {
  it("returns null when a topic's floor token still leaves 2+ candidates ambiguous", () => {
    const result = suggestAreaForCard({
      cardTitle: "cek keramik",
      topicName: "LANTAI 1 KAMAR MANDI",
      areas: AREAS,
    });
    expect(result).toBeNull();
  });

  it("returns null when nothing in the title or topic maps to a room keyword", () => {
    const result = suggestAreaForCard({
      cardTitle: "rapat koordinasi vendor",
      topicName: "MEP",
      areas: AREAS,
    });
    expect(result).toBeNull();
  });

  it("returns null when areas list is empty", () => {
    const result = suggestAreaForCard({
      cardTitle: "ganti keran dapur",
      topicName: null,
      areas: [],
    });
    expect(result).toBeNull();
  });

  it("returns null when topicName is null and title has no room keyword", () => {
    const result = suggestAreaForCard({
      cardTitle: "review kontrak",
      topicName: null,
      areas: AREAS,
    });
    expect(result).toBeNull();
  });
});
