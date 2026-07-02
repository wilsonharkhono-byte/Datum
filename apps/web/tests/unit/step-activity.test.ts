import { describe, expect, it } from "vitest";
import { groupByDay, mapStepActivityRow, type StepActivityItem } from "@/lib/activity/step-activity";

const item = (id: string, occurredAt: string): StepActivityItem => ({
  id, occurredAt, areaName: "KM", stepName: "Lantai", status: "in_progress", note: null, percentComplete: null, authorName: "A",
  source: "human", confidence: null, cardLink: null,
});

describe("groupByDay", () => {
  it("groups by Jakarta day, preserves order, same-day together", () => {
    // 2026-06-27T01:00Z = 08:00 WIB 27 Jun; 2026-06-26T20:00Z = 03:00 WIB 27 Jun (same day); 2026-06-25T01:00Z = 25 Jun
    const g = groupByDay([item("1", "2026-06-27T01:00:00Z"), item("2", "2026-06-26T20:00:00Z"), item("3", "2026-06-25T01:00:00Z")]);
    expect(g.length).toBe(2);
    expect(g[0]!.items.map((i) => i.id)).toEqual(["1", "2"]);
    expect(g[1]!.items.map((i) => i.id)).toEqual(["3"]);
  });
  it("empty → []", () => expect(groupByDay([])).toEqual([]));
});

describe("mapStepActivityRow", () => {
  it("maps joins + falls back occurredAt to created_at, names to step_code", () => {
    const row = {
      id: "e1", status: "done", note: "selesai", percent_complete: 100,
      occurred_at: null, created_at: "2026-06-27T02:00:00Z", area_step_id: "as1",
      area_steps: { step_code: "D6", areas: { area_name: "Dapur" }, trade_steps: { name: "Pasang lantai" } },
      staff: { full_name: "Budi" },
    };
    expect(mapStepActivityRow(row as never)).toEqual({
      id: "e1", occurredAt: "2026-06-27T02:00:00Z", areaName: "Dapur", stepName: "Pasang lantai",
      status: "done", note: "selesai", percentComplete: 100, authorName: "Budi",
      source: "human", confidence: null, cardLink: null,
    });
  });
  it("uses step_code when trade_steps name missing, null author", () => {
    const row = {
      id: "e2", status: "in_progress", note: null, percent_complete: null,
      occurred_at: "2026-06-27T05:00:00Z", created_at: "x", area_step_id: "as2",
      area_steps: { step_code: "cst_x", areas: { area_name: "Taman" }, trade_steps: null },
      staff: null,
    };
    const m = mapStepActivityRow(row as never);
    expect(m.stepName).toBe("cst_x"); expect(m.authorName).toBeNull(); expect(m.areaName).toBe("Taman");
  });

  it("maps an AI-authored row: source='ai', confidence carried, cardLink resolved from the join", () => {
    const row = {
      id: "e3", status: "in_progress", note: null, percent_complete: 40,
      occurred_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", area_step_id: "as3",
      area_steps: { step_code: "BW2", areas: { area_name: "KM Utama" }, trade_steps: { name: "Waterproofing" } },
      staff: null,
      source: "ai", confidence: 0.95,
      card_events: { card_id: "c1", cards: { slug: "laporan-tukang", projects: { project_code: "BDG-H1" } } },
    };
    const m = mapStepActivityRow(row as never);
    expect(m.source).toBe("ai");
    expect(m.confidence).toBe(0.95);
    expect(m.cardLink).toEqual({ projectCode: "BDG-H1", cardSlug: "laporan-tukang" });
  });

  it("cardLink is null for an AI row when the card join can't be resolved", () => {
    const row = {
      id: "e4", status: "done", note: null, percent_complete: null,
      occurred_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", area_step_id: "as4",
      area_steps: null, staff: null,
      source: "ai", confidence: 0.6, card_events: null,
    };
    const m = mapStepActivityRow(row as never);
    expect(m.cardLink).toBeNull();
  });

  it("defaults source to 'human' when the row has no attribution columns (degrade path)", () => {
    const row = {
      id: "e5", status: "done", note: null, percent_complete: null,
      occurred_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", area_step_id: "as5",
      area_steps: null, staff: null,
    };
    const m = mapStepActivityRow(row as never);
    expect(m.source).toBe("human");
    expect(m.confidence).toBeNull();
    expect(m.cardLink).toBeNull();
  });
});
