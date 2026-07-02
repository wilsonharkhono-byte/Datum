// apps/web/tests/unit/step-infer.test.ts
import { describe, it, expect } from "vitest";
import {
  summarizeEventText,
  buildInferencePrompt,
  parseStepVerdict,
  selectApplicableMatches,
  INFERABLE_KINDS,
  type CandidateStep,
} from "@/lib/steps/infer";

const candidates: CandidateStep[] = [
  { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
  { area_step_id: "as-2", step_code: "D6", name: "Pasang lantai marmer", gate_code: "D", status: "not_started" },
];

describe("summarizeEventText", () => {
  it("flattens the relevant text fields for a work event", () => {
    const s = summarizeEventText("work", { status: "done", description: "Waterproofing selesai", notes: "flood test ok" });
    expect(s).toContain("done");
    expect(s).toContain("Waterproofing selesai");
    expect(s).toContain("flood test ok");
  });
  it("includes percent_complete for work events", () => {
    const s = summarizeEventText("work", { status: "in_progress", percent_complete: 40 });
    expect(s).toContain("40%");
  });
  it("includes blocked_on for work events", () => {
    const s = summarizeEventText("work", { status: "blocked", blocked_on: "menunggu tukang" });
    expect(s).toContain("menunggu tukang");
  });
  it("tolerates a non-object payload", () => {
    expect(summarizeEventText("work", null)).toBe("");
  });

  it("reads body for a note event", () => {
    const s = summarizeEventText("note", { body: "Waterproofing lantai KM selesai, flood test ok" });
    expect(s).toContain("Waterproofing lantai KM selesai");
  });
  it("returns empty string for a note event with no body", () => {
    expect(summarizeEventText("note", {})).toBe("");
  });

  it("reads title/doc_type/notes for a document event", () => {
    const s = summarizeEventText("document", { title: "Foto progres waterproofing", doc_type: "photo_log", notes: "area basah, sudah dites" });
    expect(s).toContain("Foto progres waterproofing");
    expect(s).toContain("area basah, sudah dites");
  });
  it("returns empty string for a document event with no text fields", () => {
    expect(summarizeEventText("document", { title: "" }).length === 0 || summarizeEventText("document", {}) === "").toBe(true);
  });

  it("reads caption for a photo event", () => {
    const s = summarizeEventText("photo", { caption: "Waterproofing selesai, siap flood test" });
    expect(s).toContain("Waterproofing selesai");
  });
  it("returns empty string for a photo event with no caption", () => {
    expect(summarizeEventText("photo", {})).toBe("");
  });

  it("reads request_text for a client_request event", () => {
    const s = summarizeEventText("client_request", { request_text: "Klien minta update progres waterproofing" });
    expect(s).toContain("Klien minta update progres waterproofing");
  });
  it("returns empty string for a client_request event with no request_text", () => {
    expect(summarizeEventText("client_request", {})).toBe("");
  });

  it("returns empty string for non-inferable kinds", () => {
    expect(summarizeEventText("decision", { topic: "warna cat" })).toBe("");
    expect(summarizeEventText("vendor", { vendor_name: "PT Foo" })).toBe("");
    expect(summarizeEventText("material", { item: "keramik" })).toBe("");
  });
});

describe("INFERABLE_KINDS", () => {
  it("contains exactly the five kinds that can drive step inference", () => {
    expect(INFERABLE_KINDS).toEqual(new Set(["work", "note", "document", "photo", "client_request"]));
  });
  it("excludes non-progress kinds", () => {
    expect(INFERABLE_KINDS.has("decision")).toBe(false);
    expect(INFERABLE_KINDS.has("drawing")).toBe(false);
    expect(INFERABLE_KINDS.has("vendor")).toBe(false);
    expect(INFERABLE_KINDS.has("material")).toBe(false);
  });
});

describe("buildInferencePrompt", () => {
  it("lists every candidate step_code in the system text", () => {
    const { systemText, userText } = buildInferencePrompt({
      cardTitle: "KM Utama",
      eventText: "Waterproofing selesai",
      candidates,
    });
    expect(systemText).toContain("BW1");
    expect(systemText).toContain("D6");
    expect(userText).toContain("Waterproofing selesai");
  });

  it("instructs the model to exclude future intentions from progress matches", () => {
    const { systemText } = buildInferencePrompt({
      cardTitle: "KM Utama",
      eventText: "siap flood test besok",
      candidates,
    });
    expect(systemText).toContain("akan");
    expect(systemText).toContain("besok");
    expect(systemText).toContain("siap mulai");
    expect(systemText).toContain("BUKAN progres");
    expect(systemText).toContain("tinggal finishing cat besok");
    expect(systemText).toContain("jangan tandai step cat");
  });

  it("instructs the model to first decide is_progress and short-circuit non-progress text", () => {
    const { systemText } = buildInferencePrompt({
      cardTitle: "KM Utama",
      eventText: "diskusi warna cat dengan klien",
      candidates,
    });
    expect(systemText).toContain("is_progress");
    expect(systemText).toContain("matches: []");
  });
});

describe("parseStepVerdict", () => {
  it("parses a valid progress verdict and propagates is_progress: true", () => {
    const v = parseStepVerdict(JSON.stringify({
      is_progress: true,
      matches: [{ step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 }],
    }));
    expect(v.is_progress).toBe(true);
    expect(v.matches).toHaveLength(1);
    expect(v.matches[0]!.step_code).toBe("BW1");
  });

  it("parses a non-progress verdict with empty matches", () => {
    const v = parseStepVerdict(JSON.stringify({ is_progress: false, matches: [] }));
    expect(v.is_progress).toBe(false);
    expect(v.matches).toEqual([]);
  });

  it("returns a safe non-progress default on malformed JSON", () => {
    const v = parseStepVerdict("not json");
    expect(v).toEqual({ is_progress: false, matches: [] });
  });

  it("returns a safe non-progress default when is_progress is missing", () => {
    const v = parseStepVerdict(JSON.stringify({ matches: [{ step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 }] }));
    expect(v).toEqual({ is_progress: false, matches: [] });
  });

  it("returns a safe non-progress default when is_progress is the wrong type", () => {
    const v = parseStepVerdict(JSON.stringify({ is_progress: "yes", matches: [] }));
    expect(v).toEqual({ is_progress: false, matches: [] });
  });

  it("drops entries with the wrong shape while keeping is_progress", () => {
    const v = parseStepVerdict(JSON.stringify({
      is_progress: true,
      matches: [{ step_code: "BW1" }, { foo: 1 }],
    }));
    expect(v.is_progress).toBe(true);
    expect(v.matches).toEqual([]);
  });
});

describe("selectApplicableMatches", () => {
  it("keeps only candidate codes at/above the confidence floor and attaches area_step_id", () => {
    const verdict: { matches: any[] } = {
      matches: [
        { step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 },
        { step_code: "D6", status: "in_progress", blocked_on: null, confidence: 0.4 }, // below floor
        { step_code: "ZZ9", status: "done", blocked_on: null, confidence: 0.99 }, // not a candidate
      ],
    };
    const sel = selectApplicableMatches(verdict as any, candidates, 0.6);
    expect(sel).toHaveLength(1);
    expect(sel[0]!.area_step_id).toBe("as-1");
  });
});
