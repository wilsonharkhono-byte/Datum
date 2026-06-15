import { describe, expect, it } from "vitest";
import { isTemplateCardTitle, deriveCardLabel } from "@/lib/cards/template-card";

describe("isTemplateCardTitle", () => {
  it("matches Trello-import placeholders (case-insensitive, trimmed)", () => {
    expect(isTemplateCardTitle("YYYY-MM-DD - Nama Gambar")).toBe(true);
    expect(isTemplateCardTitle("yyyy-mm-dd")).toBe(true);
    expect(isTemplateCardTitle("GUIDE")).toBe(true);
    expect(isTemplateCardTitle("Guide upload gambar kerja")).toBe(true);
    expect(isTemplateCardTitle("   GUIDE")).toBe(true);
  });

  it("does NOT match real cards", () => {
    expect(isTemplateCardTitle("2025 01 20 - master bedroom tambah bathtub")).toBe(false);
    expect(isTemplateCardTitle("Posisi sink di pantry")).toBe(false);
    expect(isTemplateCardTitle("guidelines kitchen")).toBe(false); // no word boundary
    expect(isTemplateCardTitle("")).toBe(false);
    expect(isTemplateCardTitle(null)).toBe(false);
    expect(isTemplateCardTitle(undefined)).toBe(false);
  });
});

describe("deriveCardLabel", () => {
  it("prefers the AI suggested_title when present", () => {
    expect(deriveCardLabel("Detail desain gazebo", { request_text: "x" }, "raw")).toBe(
      "Detail desain gazebo",
    );
  });

  it("falls through payload text fields when suggested is empty/non-string", () => {
    expect(deriveCardLabel(null, { request_text: "Detail design gazebo" }, "raw")).toBe(
      "Detail design gazebo",
    );
    expect(deriveCardLabel("", { description: "Pasang kusen lt 2" }, "raw")).toBe(
      "Pasang kusen lt 2",
    );
    expect(deriveCardLabel(42, { topic: "Granit dapur" }, "raw")).toBe("Granit dapur");
  });

  it("falls back to raw text when nothing else is usable", () => {
    expect(deriveCardLabel(null, {}, "catatan lapangan bebas")).toBe("catatan lapangan bebas");
  });

  it("collapses whitespace and truncates long labels with an ellipsis", () => {
    expect(deriveCardLabel("  a   b\n c ", {}, "raw")).toBe("a b c");
    const long = "x".repeat(120);
    const out = deriveCardLabel(long, {}, "raw");
    expect(out.length).toBe(81); // 80 chars + "…"
    expect(out.endsWith("…")).toBe(true);
  });
});
