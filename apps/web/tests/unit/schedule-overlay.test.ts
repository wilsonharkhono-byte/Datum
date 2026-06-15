import { describe, expect, it } from "vitest";
import {
  overlayAreaTargetDates,
  shiftIsoDate,
  type ScheduledCell,
} from "@/lib/gates/schedule-overlay";

// Helper: minimal cell with just the date fields the overlay touches.
function cell(
  area_id: string,
  gate_code: string,
  start: string | null,
  end: string | null,
): ScheduledCell {
  return {
    area_id,
    gate_code,
    status: "not_started",
    target_start_date: start,
    target_end_date: end,
    actual_start_date: null,
    actual_end_date: null,
  };
}

// A small kickoff-derived schedule for one area: gates A → H with the seed's
// relative spacing (week starts 1, 12, 24, 68 → days 0, 77, 161, 469).
const KICKOFF = "2026-01-01";
function seededArea(areaId: string): ScheduledCell[] {
  return [
    cell(areaId, "A", "2026-01-01", "2026-04-22"), // [1,16]
    cell(areaId, "B", "2026-03-26", "2026-08-13"), // [12,32]
    cell(areaId, "D", "2026-06-18", "2026-11-05"), // [24,44]
    cell(areaId, "H", "2026-04-22", "2026-09-09"), // [68,88] end is the anchor
  ];
}

describe("shiftIsoDate", () => {
  it("adds and subtracts whole days without DST drift", () => {
    expect(shiftIsoDate("2026-03-08", 1)).toBe("2026-03-09"); // US DST boundary
    expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIsoDate("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("overlayAreaTargetDates", () => {
  it("anchors gate H's end exactly on the area target date", () => {
    const cells = seededArea("a1");
    const out = overlayAreaTargetDates(
      cells,
      new Map([["a1", "2026-12-31"]]),
    );
    const h = out.find((c) => c.gate_code === "H")!;
    expect(h.target_end_date).toBe("2026-12-31");
  });

  it("preserves relative spacing between gates (pure shift, no scale)", () => {
    const cells = seededArea("a1");
    const target = "2026-12-31";
    const out = overlayAreaTargetDates(cells, new Map([["a1", target]]));

    // The original H-end → target delta, applied uniformly.
    const origH = cells.find((c) => c.gate_code === "H")!;
    const delta = Math.round(
      (Date.parse(`${target}T00:00:00Z`) -
        Date.parse(`${origH.target_end_date}T00:00:00Z`)) /
        86_400_000,
    );

    for (const orig of cells) {
      const shifted = out.find(
        (c) => c.gate_code === orig.gate_code && c.area_id === orig.area_id,
      )!;
      expect(shifted.target_start_date).toBe(
        shiftIsoDate(orig.target_start_date!, delta),
      );
      expect(shifted.target_end_date).toBe(
        shiftIsoDate(orig.target_end_date!, delta),
      );
    }

    // Spacing invariant: gap between consecutive gate starts is unchanged.
    const gap = (set: ScheduledCell[], g1: string, g2: string) =>
      Date.parse(`${set.find((c) => c.gate_code === g2)!.target_start_date}T00:00:00Z`) -
      Date.parse(`${set.find((c) => c.gate_code === g1)!.target_start_date}T00:00:00Z`);
    expect(gap(out, "A", "B")).toBe(gap(cells, "A", "B"));
    expect(gap(out, "B", "D")).toBe(gap(cells, "B", "D"));
  });

  it("leaves areas without a target byte-for-byte unchanged", () => {
    const cells = seededArea("a1");
    const out = overlayAreaTargetDates(cells, new Map([["a1", null]]));
    expect(out).toEqual(cells);
  });

  it("only shifts the targeted area in a mixed project", () => {
    const cells = [...seededArea("a1"), ...seededArea("a2")];
    const out = overlayAreaTargetDates(cells, new Map([["a1", "2027-03-01"]]));

    // a2 untouched
    for (const orig of cells.filter((c) => c.area_id === "a2")) {
      const same = out.find(
        (c) => c.area_id === "a2" && c.gate_code === orig.gate_code,
      )!;
      expect(same).toEqual(orig);
    }
    // a1's H lands on target
    const h1 = out.find((c) => c.area_id === "a1" && c.gate_code === "H")!;
    expect(h1.target_end_date).toBe("2027-03-01");
  });

  it("returns the original array reference when no area is overlaid", () => {
    const cells = seededArea("a1");
    expect(overlayAreaTargetDates(cells, new Map())).toBe(cells);
  });

  it("passes through an area whose anchor gate has no stored end date", () => {
    // Area has a target but its H cell lacks a target_end_date → cannot anchor
    // honestly, so leave it unchanged rather than invent a baseline.
    const cells = [
      cell("a1", "A", "2026-01-01", "2026-04-22"),
      cell("a1", "H", null, null),
    ];
    const out = overlayAreaTargetDates(cells, new Map([["a1", "2026-12-31"]]));
    expect(out).toEqual(cells);
  });

  it("honours an explicit anchorGate override", () => {
    const cells = [
      cell("a1", "A", "2026-01-01", "2026-04-22"),
      cell("a1", "D", "2026-06-18", "2026-11-05"),
    ];
    // No H present; pin D as the anchor so D's end lands on target.
    const out = overlayAreaTargetDates(
      cells,
      new Map([["a1", "2026-12-25"]]),
      "D",
    );
    const d = out.find((c) => c.gate_code === "D")!;
    expect(d.target_end_date).toBe("2026-12-25");
  });

  it("shifts earlier when the target is before the kickoff-derived end", () => {
    const cells = seededArea("a1");
    // Target earlier than stored H-end → negative delta, dates move back.
    const out = overlayAreaTargetDates(cells, new Map([["a1", "2026-06-01"]]));
    const h = out.find((c) => c.gate_code === "H")!;
    const a = out.find((c) => c.gate_code === "A")!;
    expect(h.target_end_date).toBe("2026-06-01");
    expect(a.target_start_date! < KICKOFF).toBe(true);
  });
});
