import { describe, expect, it } from "vitest";
import { aiResultLine, isUnlinkedCardHint } from "@/lib/cards/ai-result-line";

describe("aiResultLine", () => {
  it("done + step names -> attribution line listing the names", () => {
    expect(aiResultLine("done", null, ["Waterproofing"])).toBe("AI: memperbarui langkah Waterproofing");
  });

  it("done + multiple step names -> comma-joined", () => {
    expect(aiResultLine("done", null, ["Waterproofing", "Pasang lantai"])).toBe(
      "AI: memperbarui langkah Waterproofing, Pasang lantai",
    );
  });

  it("done but no step names resolved -> null (nothing to attribute)", () => {
    expect(aiResultLine("done", null, [])).toBeNull();
  });

  it("skipped/no_candidate_steps -> unlinked-card hint", () => {
    expect(aiResultLine("skipped", "no_candidate_steps", [])).toBe(
      "AI: kartu belum tertaut ke ruangan — tautkan agar progres terbaca",
    );
  });

  it("skipped/not_progress -> null (silent)", () => {
    expect(aiResultLine("skipped", "not_progress", [])).toBeNull();
  });

  it("skipped/no_text -> null (silent)", () => {
    expect(aiResultLine("skipped", "no_text", [])).toBeNull();
  });

  it("skipped with an unrecognized error -> null (silent, not a crash)", () => {
    expect(aiResultLine("skipped", "some_future_reason", [])).toBeNull();
  });

  it("failed -> retry hint regardless of error message", () => {
    expect(aiResultLine("failed", "Anthropic API timeout", [])).toBe("AI: gagal membaca — akan dicoba lagi");
  });

  it("pending -> null", () => {
    expect(aiResultLine("pending", null, [])).toBeNull();
  });

  it("processing -> null", () => {
    expect(aiResultLine("processing", null, [])).toBeNull();
  });

  it("null/undefined status (pre-migration or non-work event) -> null", () => {
    expect(aiResultLine(null, null, [])).toBeNull();
    expect(aiResultLine(undefined, undefined, [])).toBeNull();
  });
});

describe("isUnlinkedCardHint", () => {
  it("true for skipped/no_candidate_steps — the exact case aiResultLine links to Areas Terkait", () => {
    expect(isUnlinkedCardHint("skipped", "no_candidate_steps")).toBe(true);
  });

  it("false for other skip reasons", () => {
    expect(isUnlinkedCardHint("skipped", "not_progress")).toBe(false);
    expect(isUnlinkedCardHint("skipped", "no_text")).toBe(false);
  });

  it("false for non-skipped statuses", () => {
    expect(isUnlinkedCardHint("done", "no_candidate_steps")).toBe(false);
    expect(isUnlinkedCardHint("failed", "no_candidate_steps")).toBe(false);
    expect(isUnlinkedCardHint(null, null)).toBe(false);
  });
});
