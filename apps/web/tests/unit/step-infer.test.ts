// apps/web/tests/unit/step-infer.test.ts
import { describe, it, expect } from "vitest";
import {
  summarizeWorkEvent,
  buildInferencePrompt,
  parseStepVerdict,
  selectApplicableMatches,
  type CandidateStep,
} from "@/lib/steps/infer";

const candidates: CandidateStep[] = [
  { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
  { area_step_id: "as-2", step_code: "D6", name: "Pasang lantai marmer", gate_code: "D", status: "not_started" },
];

describe("summarizeWorkEvent", () => {
  it("flattens the relevant text fields", () => {
    const s = summarizeWorkEvent({ status: "done", description: "Waterproofing selesai", notes: "flood test ok" });
    expect(s).toContain("done");
    expect(s).toContain("Waterproofing selesai");
    expect(s).toContain("flood test ok");
  });
  it("tolerates a non-object payload", () => {
    expect(summarizeWorkEvent(null)).toBe("");
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
});

describe("parseStepVerdict", () => {
  it("parses a valid verdict", () => {
    const v = parseStepVerdict(JSON.stringify({ matches: [{ step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 }] }));
    expect(v.matches).toHaveLength(1);
    expect(v.matches[0]!.step_code).toBe("BW1");
  });
  it("returns empty matches on malformed JSON", () => {
    expect(parseStepVerdict("not json").matches).toEqual([]);
  });
  it("drops entries with the wrong shape", () => {
    const v = parseStepVerdict(JSON.stringify({ matches: [{ step_code: "BW1" }, { foo: 1 }] }));
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
