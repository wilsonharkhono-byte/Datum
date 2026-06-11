import { describe, expect, it } from "vitest";
import { findCascadeRisks, findExpiringQuotes, type ScheduleCell, type QuoteEvent } from "@/lib/brief/bottlenecks";

function cell(areaId: string, gate: string, status: string, start: string | null, end: string | null): ScheduleCell {
  return {
    project_code: "BDG-H1", project_name: "BDG H1",
    area_id: areaId, area_name: `Area ${areaId}`,
    gate_code: gate, status,
    target_start_date: start, target_end_date: end,
  };
}

describe("findCascadeRisks", () => {
  it("flags a started gate whose predecessor is not ready", () => {
    const risks = findCascadeRisks([
      cell("a1", "B", "in_progress", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "not_started", "2026-06-05", "2026-06-20"),
    ], "2026-06-11");
    expect(risks).toHaveLength(1);
    expect(risks[0]!.gateCode).toBe("C");
    expect(risks[0]!.reason).toContain("Gate B");
  });

  it("does not flag when the predecessor is ready or passed or n/a", () => {
    for (const ok of ["ready_for_handoff", "passed", "not_applicable"]) {
      const risks = findCascadeRisks([
        cell("a1", "B", ok, "2026-05-01", "2026-06-01"),
        cell("a1", "C", "in_progress", "2026-06-05", "2026-06-20"),
      ], "2026-06-11");
      expect(risks).toHaveLength(0);
    }
  });

  it("does not flag windows that have not started, or n/a gates", () => {
    expect(findCascadeRisks([
      cell("a1", "B", "in_progress", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "not_started", "2026-07-01", "2026-07-20"),
    ], "2026-06-11")).toHaveLength(0);

    expect(findCascadeRisks([
      cell("a1", "B", "in_progress", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "not_applicable", "2026-06-05", "2026-06-20"),
    ], "2026-06-11")).toHaveLength(0);
  });

  it("evaluates areas independently", () => {
    const risks = findCascadeRisks([
      cell("a1", "B", "ready_for_handoff", "2026-05-01", "2026-06-01"),
      cell("a1", "C", "in_progress", "2026-06-05", "2026-06-20"),
      cell("a2", "B", "blocked", "2026-05-01", "2026-06-01"),
      cell("a2", "C", "in_progress", "2026-06-05", "2026-06-20"),
    ], "2026-06-11");
    expect(risks).toHaveLength(1);
    expect(risks[0]!.areaName).toBe("Area a2");
  });
});

function quote(id: string, cardId: string, interaction: string, expiresAt?: string): QuoteEvent {
  return {
    id, card_id: cardId, occurred_at: "2026-06-01T00:00:00Z",
    payload: { vendor_name: "PT Galleria", interaction, expires_at: expiresAt },
  };
}

describe("findExpiringQuotes", () => {
  it("returns quotes expiring within the window (incl. already expired)", () => {
    const out = findExpiringQuotes([
      quote("q1", "c1", "quote", "2026-06-15"),
      quote("q2", "c2", "quote", "2026-06-09"),
      quote("q3", "c3", "quote", "2026-08-01"),
      quote("q4", "c4", "quote"), // no expiry → ignore
    ], "2026-06-11", 7);
    expect(out.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
  });

  it("ignores quotes on cards that already picked/contracted a vendor", () => {
    const out = findExpiringQuotes([
      quote("q1", "c1", "quote", "2026-06-15"),
      quote("p1", "c1", "pick"),
    ], "2026-06-11", 7);
    expect(out).toHaveLength(0);
  });
});
