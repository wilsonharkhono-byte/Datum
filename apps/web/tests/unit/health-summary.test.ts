import { describe, it, expect } from "vitest";
import { summarizeSchedule } from "@/components/schedule/health-summary";
import type { ProjectStepSignalRow } from "@/lib/steps/queries";
import type { ScheduledCell } from "@/lib/gates/schedule";

function sig(severity: ProjectStepSignalRow["signal"]["severity"]): ProjectStepSignalRow {
  return {
    areaId: "a1",
    areaName: "Area 1",
    stepCode: "s1",
    stepName: "Step 1",
    tradeRole: null,
    signal: { stepCode: "s1", kind: "behind_plan", severity, message: "m", detail: undefined },
  };
}

function cell(over: Partial<ScheduledCell>): ScheduledCell {
  return {
    area_id: "a1",
    gate_code: "A",
    status: "in_progress",
    target_start_date: null,
    target_end_date: null,
    actual_start_date: null,
    actual_end_date: null,
    ...over,
  };
}

describe("summarizeSchedule", () => {
  const today = "2026-07-06";

  it("counts signals by severity and totals", () => {
    const h = summarizeSchedule([sig("critical"), sig("critical"), sig("high"), sig("warning"), sig("info")], [], today);
    expect(h.critical).toBe(2);
    expect(h.high).toBe(1);
    expect(h.warning).toBe(1);
    expect(h.total).toBe(5);
  });

  it("computes gate progress from passed/ready_for_handoff, excluding not_applicable", () => {
    const cells = [
      cell({ status: "passed" }),
      cell({ status: "ready_for_handoff" }),
      cell({ status: "in_progress" }),
      cell({ status: "not_applicable" }),
    ];
    // 2 done of 3 scored (not_applicable excluded) = 67%
    const h = summarizeSchedule([], cells, today);
    expect(h.gateProgressPct).toBe(67);
  });

  it("gate progress is 0 when there are no scorable cells", () => {
    expect(summarizeSchedule([], [], today).gateProgressPct).toBe(0);
    expect(summarizeSchedule([], [cell({ status: "not_applicable" })], today).gateProgressPct).toBe(0);
  });

  it("finds the soonest upcoming deadline among unfinished cells", () => {
    const cells = [
      cell({ area_id: "a1", gate_code: "C", status: "in_progress", target_end_date: "2026-07-10" }),
      cell({ area_id: "a2", gate_code: "B", status: "blocked", target_end_date: "2026-07-08" }),
      cell({ area_id: "a3", gate_code: "A", status: "in_progress", target_end_date: "2026-07-08" }),
      // done cell on an earlier date — must be ignored
      cell({ area_id: "a4", gate_code: "A", status: "passed", target_end_date: "2026-07-01" }),
      // past-due cell — must be ignored (before today)
      cell({ area_id: "a5", gate_code: "A", status: "in_progress", target_end_date: "2026-07-01" }),
    ];
    const h = summarizeSchedule([], cells, today);
    expect(h.nextDeadline).not.toBeNull();
    expect(h.nextDeadline!.date).toBe("2026-07-08");
    expect(h.nextDeadline!.areaCount).toBe(2); // a2 + a3 share the date
    expect(h.nextDeadline!.gateCode).toBe("A"); // earliest gate on that date
  });

  it("returns null deadline when all upcoming cells are done", () => {
    const cells = [
      cell({ status: "passed", target_end_date: "2026-07-20" }),
      cell({ status: "ready_for_handoff", target_end_date: "2026-07-25" }),
    ];
    expect(summarizeSchedule([], cells, today).nextDeadline).toBeNull();
  });

  it("includes a cell whose deadline is exactly today", () => {
    const cells = [cell({ status: "in_progress", target_end_date: today })];
    expect(summarizeSchedule([], cells, today).nextDeadline!.date).toBe(today);
  });
});
