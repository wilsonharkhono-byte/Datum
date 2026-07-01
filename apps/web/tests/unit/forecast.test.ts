import { describe, expect, it } from "vitest";
import { forecastArea, daysBetween, type ForecastStep } from "@/lib/steps/forecast";
import type { TradeStepDep } from "@/lib/steps/types";

const TODAY = "2026-07-01";
const step = (o: Partial<ForecastStep> & { step_code: string }): ForecastStep => ({
  step_type: "site_work", status: "not_started", typical_duration_days: 1, lead_time_days: 0,
  planned_start: null, actual_start: null, actual_end: null, ...o,
});
const dep = (step_code: string, predecessor_code: string): TradeStepDep => ({ step_code, predecessor_code });

describe("daysBetween", () => {
  it("whole calendar days, signed", () => {
    expect(daysBetween("2026-06-30", "2026-07-07")).toBe(7);
    expect(daysBetween("2026-07-07", "2026-06-30")).toBe(-7);
    expect(daysBetween("2026-07-01T09:00:00Z", "2026-07-03T20:00:00Z")).toBe(2);
  });
});

describe("forecastArea", () => {
  it("late in-progress procurement pushes downstream site work → slip", () => {
    const steps = [
      step({ step_code: "P", step_type: "procurement", typical_duration_days: 1, lead_time_days: 14, status: "in_progress", actual_start: "2026-06-01", planned_start: "2026-06-01" }),
      step({ step_code: "W", step_type: "site_work", typical_duration_days: 5, status: "not_started", planned_start: "2026-06-20" }),
    ];
    const r = forecastArea(steps, [dep("W", "P")], TODAY, "2026-06-30");
    // P: span15, elapsed30 ⇒ remaining1 ⇒ end 07-02. W: pred 07-02, span5 ⇒ end 07-07.
    expect(r.projectedFinish).toBe("2026-07-07");
    expect(r.slipDays).toBe(7);
    expect(r.complete).toBe(false);
  });

  it("on-schedule bathroom → slip 0", () => {
    const steps = [
      step({ step_code: "A", typical_duration_days: 3, planned_start: "2026-07-10" }),
      step({ step_code: "B", typical_duration_days: 2, planned_start: "2026-07-13" }),
    ];
    const r = forecastArea(steps, [dep("B", "A")], TODAY, "2026-07-15");
    // A: start 07-10 +3 ⇒ 07-13. B: pred 07-13, start max(07-13,today) +2 ⇒ 07-15.
    expect(r.projectedFinish).toBe("2026-07-15");
    expect(r.slipDays).toBe(0);
    expect(r.hasPlan).toBe(true);
  });

  it("timestamp-suffixed date fields normalize to YYYY-MM-DD (no Invalid Date crash)", () => {
    // area_steps.planned_start/actual_* are PG `date` today, but a timestamp suffix from a
    // future column change (or a hand-built row) must not blow up addDays. daysBetween already
    // slices its inputs; resolve() must too.
    const planned = forecastArea(
      [step({ step_code: "A", typical_duration_days: 2, planned_start: "2026-07-10T09:30:00Z" })],
      [], TODAY, null,
    );
    // planned_start sliced to 2026-07-10; not_started site_work +2 ⇒ 2026-07-12.
    expect(planned.projectedFinish).toBe("2026-07-12");
    // DONE branch returns actual_end directly — it must be sliced too, not leaked with a suffix.
    const done = forecastArea(
      [step({ step_code: "A", status: "accepted", actual_end: "2026-07-02T14:00:00Z" })],
      [], TODAY, "2026-06-30",
    );
    expect(done.projectedFinish).toBe("2026-07-02");
    expect(done.slipDays).toBe(2);
  });

  it("all done → complete, projected = max actual_end, slip = actual vs target", () => {
    const steps = [
      step({ step_code: "A", status: "accepted", actual_end: "2026-06-28" }),
      step({ step_code: "B", status: "done_with_defects", actual_end: "2026-07-02" }),
    ];
    const r = forecastArea(steps, [], TODAY, "2026-06-30");
    expect(r.complete).toBe(true);
    expect(r.projectedFinish).toBe("2026-07-02");
    expect(r.slipDays).toBe(2);
  });

  it("ASAP degradation (no planned_start) — conservative, hasPlan false, ahead of a far target", () => {
    const steps = [
      step({ step_code: "A", typical_duration_days: 4 }),
      step({ step_code: "B", typical_duration_days: 3 }),
    ];
    const r = forecastArea(steps, [dep("B", "A")], TODAY, "2026-08-01");
    // A: today+4 ⇒ 07-05. B: pred 07-05 +3 ⇒ 07-08. target 08-01 ⇒ negative slip.
    expect(r.projectedFinish).toBe("2026-07-08");
    expect(r.slipDays! < 0).toBe(true);
    expect(r.hasPlan).toBe(false);
  });

  it("span: non-physical (procurement AND decision) include lead; physical steps do not", () => {
    const proc = forecastArea([step({ step_code: "P", step_type: "procurement", typical_duration_days: 2, lead_time_days: 10 })], [], TODAY, null);
    expect(proc.projectedFinish).toBe("2026-07-13"); // today + 12 (dur 2 + lead 10)
    // A decision step reserves lead+duration too — matches back-schedule's back-pass for all !isPhysical.
    const dec = forecastArea([step({ step_code: "D", step_type: "decision", typical_duration_days: 1, lead_time_days: 7 })], [], TODAY, null);
    expect(dec.projectedFinish).toBe("2026-07-09"); // today + 8 (dur 1 + lead 7)
    const site = forecastArea([step({ step_code: "S", step_type: "site_work", typical_duration_days: 2, lead_time_days: 10 })], [], TODAY, null);
    expect(site.projectedFinish).toBe("2026-07-03"); // today + 2 (physical: lead ignored)
    const insp = forecastArea([step({ step_code: "I", step_type: "inspection", typical_duration_days: 1, lead_time_days: 5 })], [], TODAY, null);
    expect(insp.projectedFinish).toBe("2026-07-02"); // today + 1 (physical: lead ignored)
  });

  it("edges: empty / all not_applicable / null target / cycle-safe", () => {
    expect(forecastArea([], [], TODAY, "2026-07-10")).toEqual({ target: "2026-07-10", projectedFinish: null, slipDays: null, complete: false, hasPlan: false });
    expect(forecastArea([step({ step_code: "X", status: "not_applicable" })], [], TODAY, "2026-07-10").projectedFinish).toBeNull();
    expect(forecastArea([step({ step_code: "A", typical_duration_days: 2 })], [], TODAY, null).slipDays).toBeNull();
    // cycle A→B→A must not hang and must resolve both
    const cyc = forecastArea([step({ step_code: "A", typical_duration_days: 1 }), step({ step_code: "B", typical_duration_days: 1 })], [dep("A", "B"), dep("B", "A")], TODAY, null);
    expect(cyc.projectedFinish).not.toBeNull();
  });
});
