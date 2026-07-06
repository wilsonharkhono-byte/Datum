import { describe, expect, it } from "vitest";
import { addDays, daysBetween, backScheduleSteps } from "@/lib/steps/back-schedule";
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

describe("daysBetween", () => {
  it("returns whole-day difference (later − earlier)", () => {
    expect(daysBetween("2026-07-01", "2026-09-30")).toBe(91);
    expect(daysBetween("2026-07-01", "2026-07-01")).toBe(0);
    expect(daysBetween("2026-07-05", "2026-07-01")).toBe(-4);
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
  // Window 91 days, physical chain B4→B5→B6 = 10 days → dilation factor 9.1:
  // the chain is stretched to fill the gate window instead of bunching in the
  // first 10 days (offsets ×9.1, rounded).
  const window = { start: "2026-07-01", end: "2026-09-30" };
  const plan = backScheduleSteps(steps, deps, window);

  it("dilates site steps across the gate window along site deps", () => {
    expect(plan.get("B4")).toEqual({ planned_start: "2026-07-01", planned_end: "2026-07-28" });
    expect(plan.get("B5")).toEqual({ planned_start: "2026-07-28", planned_end: "2026-08-16" });
    expect(plan.get("B6")).toEqual({ planned_start: "2026-08-16", planned_end: "2026-09-30" });
  });

  it("ends the last physical step exactly on window.end", () => {
    expect(plan.get("B6")!.planned_end).toBe(window.end);
  });

  it("back-schedules procurement from its earliest dependent minus lead+duration", () => {
    // B3 gates B6 (start 08-16): end = 08-16 - 1 = 08-15; start = 08-15 - (21+1) = 07-24
    expect(plan.get("B3")).toEqual({ planned_start: "2026-07-24", planned_end: "2026-08-15" });
  });

  it("back-schedules a decision from its dependent procurement", () => {
    // B1 gates B3 (start 07-24): end = 07-23; start = 07-23 - (7+1) = 07-15
    expect(plan.get("B1")).toEqual({ planned_start: "2026-07-15", planned_end: "2026-07-23" });
  });

  it("never compresses: a window shorter than the chain keeps typical durations", () => {
    // Chain = 10 days, window = 7 days → factor stays 1 and the chain honestly
    // overruns window.end (2026-07-08) instead of squeezing durations.
    const p = backScheduleSteps(
      [step("B4", "site_work", 3), step("B5", "site_work", 2), step("B6", "site_work", 5)],
      [
        { step_code: "B5", predecessor_code: "B4" },
        { step_code: "B6", predecessor_code: "B5" },
      ],
      { start: "2026-07-01", end: "2026-07-08" },
    );
    expect(p.get("B4")).toEqual({ planned_start: "2026-07-01", planned_end: "2026-07-04" });
    expect(p.get("B5")).toEqual({ planned_start: "2026-07-04", planned_end: "2026-07-06" });
    expect(p.get("B6")).toEqual({ planned_start: "2026-07-06", planned_end: "2026-07-11" });
  });

  it("leaves an upstream step that gates nothing without a window (no empty-reduce throw)", () => {
    const p = backScheduleSteps(
      [step("X1", "decision", 1, 5), step("X2", "site_work", 2)],
      [], // X1 has no dependents — must not throw
      { start: "2026-07-01", end: "2026-07-31" },
    );
    // Single 2-day step dilated onto the 30-day window.
    expect(p.get("X2")).toEqual({ planned_start: "2026-07-01", planned_end: "2026-07-31" });
    expect(p.has("X1")).toBe(false);
  });
});
