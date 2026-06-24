import { describe, expect, it } from "vitest";
import { formatReadinessSignals } from "@/lib/assistant/retrieval";
import type { ProjectStepSignalRow } from "@/lib/steps/queries";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(
  overrides: Partial<ProjectStepSignalRow> & { signal: ProjectStepSignalRow["signal"] },
): ProjectStepSignalRow {
  return {
    areaId: "area-1",
    areaName: "Master Bathroom",
    stepCode: "WP",
    stepName: "Waterproofing",
    tradeRole: "waterproofer",
    ...overrides,
  };
}

// ─── Empty → returns empty string ─────────────────────────────────────────────

describe("formatReadinessSignals — empty input", () => {
  it("returns empty string when there are no signals", () => {
    expect(formatReadinessSignals([])).toBe("");
  });
});

// ─── Line format ──────────────────────────────────────────────────────────────

describe("formatReadinessSignals — line format", () => {
  it("includes section header", () => {
    const rows = [
      makeRow({
        signal: {
          stepCode: "WP",
          kind: "silent",
          severity: "high",
          message: "Waterproofing belum ada update 6 hari",
        },
      }),
    ];
    const result = formatReadinessSignals(rows);
    expect(result).toContain("PENGINGAT KESIAPAN / READINESS SIGNALS:");
  });

  it("formats a critical row with KRITIS label", () => {
    const rows = [
      makeRow({
        areaName: "Guest Bathroom",
        stepName: "Screed",
        signal: {
          stepCode: "SC",
          kind: "blocking_timeline",
          severity: "critical",
          message: "Screed terblokir dan Keramik akan mulai dalam 2 hari",
        },
      }),
    ];
    const result = formatReadinessSignals(rows);
    expect(result).toContain("[KRITIS]");
    expect(result).toContain("Guest Bathroom · Screed:");
    expect(result).toContain("Screed terblokir dan Keramik akan mulai dalam 2 hari");
  });

  it("formats a high-severity row with TINGGI label", () => {
    const rows = [
      makeRow({
        signal: {
          stepCode: "WP",
          kind: "silent",
          severity: "high",
          message: "Waterproofing belum ada update 6 hari",
        },
      }),
    ];
    const result = formatReadinessSignals(rows);
    expect(result).toContain("[TINGGI]");
  });

  it("formats a warning row with PERHATIAN label", () => {
    const rows = [
      makeRow({
        signal: {
          stepCode: "WP",
          kind: "behind_plan",
          severity: "warning",
          message: "Waterproofing harusnya mulai 3 hari lalu tapi belum dimulai",
        },
      }),
    ];
    const result = formatReadinessSignals(rows);
    expect(result).toContain("[PERHATIAN]");
  });

  it("formats an info row with INFO label", () => {
    const rows = [
      makeRow({
        signal: {
          stepCode: "WP",
          kind: "silent",
          severity: "info",
          message: "Waterproofing dalam window rencana",
        },
      }),
    ];
    const result = formatReadinessSignals(rows);
    expect(result).toContain("[INFO]");
  });
});

// ─── Severity ordering (caller pre-sorts; formatter preserves order) ──────────

describe("formatReadinessSignals — order preservation", () => {
  it("renders rows in the order they are provided (severity sort is caller's responsibility)", () => {
    const rows = [
      makeRow({
        areaName: "Master Bathroom",
        stepName: "Waterproofing",
        signal: { stepCode: "WP", kind: "blocking_timeline", severity: "critical", message: "A" },
      }),
      makeRow({
        areaName: "Guest Bathroom",
        stepName: "Screed",
        signal: { stepCode: "SC", kind: "silent", severity: "high", message: "B" },
      }),
      makeRow({
        areaName: "Powder Room",
        stepName: "Tiling",
        signal: { stepCode: "TL", kind: "behind_plan", severity: "warning", message: "C" },
      }),
    ];
    const result = formatReadinessSignals(rows);
    const kritisIdx = result.indexOf("[KRITIS]");
    const tinggiIdx = result.indexOf("[TINGGI]");
    const perhatianIdx = result.indexOf("[PERHATIAN]");
    expect(kritisIdx).toBeLessThan(tinggiIdx);
    expect(tinggiIdx).toBeLessThan(perhatianIdx);
  });
});

// ─── Cap at 15 rows ───────────────────────────────────────────────────────────

describe("formatReadinessSignals — cap", () => {
  it("caps output to 15 rows regardless of input size", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeRow({
        areaName: `Area ${i}`,
        stepName: `Step ${i}`,
        signal: {
          stepCode: `S${i}`,
          kind: "silent",
          severity: "warning",
          message: `Update terlambat ${i} hari`,
        },
      }),
    );
    const result = formatReadinessSignals(rows);
    // 1 header line + 15 signal lines = 16 lines total
    const lines = result.split("\n").filter(Boolean);
    expect(lines).toHaveLength(16); // header + 15 capped rows
    expect(result).toContain("Area 0");
    expect(result).toContain("Area 14");
    expect(result).not.toContain("Area 15");
  });

  it("includes all rows when count is within cap", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({
        areaName: `Area ${i}`,
        stepName: `Step ${i}`,
        signal: {
          stepCode: `S${i}`,
          kind: "behind_plan",
          severity: "high",
          message: `Terlambat ${i}`,
        },
      }),
    );
    const result = formatReadinessSignals(rows);
    const lines = result.split("\n").filter(Boolean);
    expect(lines).toHaveLength(6); // header + 5 rows
  });
});

// ─── Area + step + message all appear in output ───────────────────────────────

describe("formatReadinessSignals — field coverage", () => {
  it("includes areaName, stepName, and message for each row", () => {
    const rows = [
      makeRow({
        areaName: "Master Bathroom",
        stepName: "Waterproofing",
        signal: {
          stepCode: "WP",
          kind: "silent",
          severity: "high",
          message: "belum ada update 6 hari",
        },
      }),
    ];
    const result = formatReadinessSignals(rows);
    expect(result).toContain("Master Bathroom");
    expect(result).toContain("Waterproofing");
    expect(result).toContain("belum ada update 6 hari");
  });
});
