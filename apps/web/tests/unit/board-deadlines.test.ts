import { describe, expect, it } from "vitest";
import { computeCardDeadlines } from "@/lib/gates/board-deadlines";

const links = [{ card_id: "c1", area_id: "a1" }];

describe("computeCardDeadlines", () => {
  it("picks the soonest upcoming gate window", () => {
    const map = computeCardDeadlines(links, [
      { area_id: "a1", gate_code: "C", status: "not_started", target_start_date: "2026-07-01", target_end_date: "2026-07-14" },
      { area_id: "a1", gate_code: "B", status: "in_progress", target_start_date: "2026-06-15", target_end_date: "2026-06-30" },
    ], "2026-06-11");
    expect(map.get("c1")).toEqual({ gateCode: "B", targetEndDate: "2026-06-30" });
  });

  it("falls back to the earliest (overdue) window when none is upcoming", () => {
    const map = computeCardDeadlines(links, [
      { area_id: "a1", gate_code: "B", status: "in_progress", target_start_date: "2026-05-01", target_end_date: "2026-05-20" },
    ], "2026-06-11");
    expect(map.get("c1")).toEqual({ gateCode: "B", targetEndDate: "2026-05-20" });
  });

  it("skips cells without target dates and cards without links", () => {
    const map = computeCardDeadlines(
      [...links, { card_id: "c2", area_id: "a2" }],
      [{ area_id: "a1", gate_code: "B", status: "in_progress", target_start_date: null, target_end_date: null }],
      "2026-06-11",
    );
    expect(map.size).toBe(0);
  });

  it("considers all linked areas of a card", () => {
    const map = computeCardDeadlines(
      [{ card_id: "c1", area_id: "a1" }, { card_id: "c1", area_id: "a2" }],
      [
        { area_id: "a1", gate_code: "D", status: "not_started", target_start_date: "2026-08-01", target_end_date: "2026-08-20" },
        { area_id: "a2", gate_code: "C", status: "not_started", target_start_date: "2026-06-20", target_end_date: "2026-07-05" },
      ],
      "2026-06-11",
    );
    expect(map.get("c1")).toEqual({ gateCode: "C", targetEndDate: "2026-07-05" });
  });
});
