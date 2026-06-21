import { describe, expect, it } from "vitest";
import { addDays, backScheduleSteps } from "@/lib/steps/back-schedule";
import type { TradeStepTemplate, TradeStepDep } from "@/lib/steps/types";

function step(
  code: string,
  step_type: TradeStepTemplate["step_type"],
  dur: number,
  lead = 0,
): TradeStepTemplate {
  return {
    code, gate_code: "B", name: code, step_type, trade_role: null,
    typical_duration_days: dur, lead_time_days: lead, sort_order: 0, applicability: {},
  };
}

describe("addDays", () => {
  it("adds calendar days to an ISO date", () => {
    expect(addDays("2026-07-01", 3)).toBe("2026-07-04");
    expect(addDays("2026-07-05", -22)).toBe("2026-06-13");
  });
});

describe("backScheduleSteps", () => {
  const steps = [
    step("B1", "decision", 1, 7),
    step("B3", "procurement", 1, 21),
    step("B4", "site_work", 3),
    step("B5", "site_work", 2),
    step("B6", "site_work", 5),
  ];
  const deps: TradeStepDep[] = [
    { step_code: "B3", predecessor_code: "B1" },
    { step_code: "B5", predecessor_code: "B4" },
    { step_code: "B6", predecessor_code: "B5" },
    { step_code: "B6", predecessor_code: "B3" },
  ];
  const window = { start: "2026-07-01", end: "2026-09-30" };
  const plan = backScheduleSteps(steps, deps, window);

  it("forward-schedules site steps from the gate window start along site deps", () => {
    expect(plan.get("B4")).toEqual({ planned_start: "2026-07-01", planned_end: "2026-07-04" });
    expect(plan.get("B5")).toEqual({ planned_start: "2026-07-04", planned_end: "2026-07-06" });
    expect(plan.get("B6")).toEqual({ planned_start: "2026-07-06", planned_end: "2026-07-11" });
  });

  it("back-schedules procurement from its earliest dependent minus lead+duration", () => {
    // B3 gates B6 (start 07-06): end = 07-06 - 1 = 07-05; start = 07-05 - (21+1) = 06-13
    expect(plan.get("B3")).toEqual({ planned_start: "2026-06-13", planned_end: "2026-07-05" });
  });

  it("back-schedules a decision from its dependent procurement", () => {
    // B1 gates B3 (start 06-13): end = 06-12; start = 06-12 - (7+1) = 06-04
    expect(plan.get("B1")).toEqual({ planned_start: "2026-06-04", planned_end: "2026-06-12" });
  });

  it("leaves an upstream step that gates nothing without a window (no empty-reduce throw)", () => {
    const p = backScheduleSteps(
      [step("X1", "decision", 1, 5), step("X2", "site_work", 2)],
      [], // X1 has no dependents — must not throw
      { start: "2026-07-01", end: "2026-07-31" },
    );
    expect(p.get("X2")).toEqual({ planned_start: "2026-07-01", planned_end: "2026-07-03" });
    expect(p.has("X1")).toBe(false);
  });
});
