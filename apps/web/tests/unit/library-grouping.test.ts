import { describe, expect, it } from "vitest";
import { groupStandardLibrary, type StandardStep } from "@/lib/library/queries";

const mk = (code: string, gate: string, sort: number, active = true): StandardStep => ({
  code, gate_code: gate, name: code, step_type: "site_work", trade_role: null,
  typical_duration_days: 1, lead_time_days: 0, sort_order: sort,
  applies_to_area_types: null, applicability: {}, active,
});

describe("groupStandardLibrary", () => {
  it("groups by gate (A→H), splits active/inactive, sorts by sort_order", () => {
    const out = groupStandardLibrary([
      mk("A2", "A", 2), mk("A1", "A", 1), mk("Ax", "A", 3, false), mk("D1", "D", 1),
    ]);
    expect(out.map((g) => g.gate)).toEqual(["A", "D"]);
    expect(out[0]!.active.map((s) => s.code)).toEqual(["A1", "A2"]);
    expect(out[0]!.inactive.map((s) => s.code)).toEqual(["Ax"]);
    expect(out[0]!.gateName).toBeTruthy();
  });
});
