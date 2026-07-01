import { describe, expect, it } from "vitest";
import { durationDays, summarizeDurations, learnedDurationRows, type DurationInstance, type StandardStepRow } from "@/lib/learning/durations";

const gn = (g: string) => `${g}-name`;

describe("durationDays", () => {
  it("same-day = 1", () => expect(durationDays("2026-06-01T08:00:00Z", "2026-06-01T17:00:00Z")).toBe(1));
  it("counts whole days between dates, ignoring time-of-day", () =>
    expect(durationDays("2026-06-01T23:00:00Z", "2026-06-04T01:00:00Z")).toBe(3));
  it("clamps to >= 1 even if end <= start", () =>
    expect(durationDays("2026-06-02T00:00:00Z", "2026-06-01T00:00:00Z")).toBe(1));
});

describe("summarizeDurations", () => {
  it("odd n → middle value", () => expect(summarizeDurations([3, 1, 2]).median).toBe(2));
  it("even n → rounded mean of middles", () => expect(summarizeDurations([1, 2, 3, 6]).median).toBe(3)); // (2+3)/2=2.5→3
  it("reports min/max/n", () => expect(summarizeDurations([4, 1, 9])).toEqual({ median: 4, min: 1, max: 9, n: 3 }));
});

describe("learnedDurationRows", () => {
  const steps: StandardStepRow[] = [{ code: "D6", gate_code: "D", name: "Lantai", typical_duration_days: 6, lead_time_days: 0, step_type: "site_work" }];
  const inst = (s: string, e: string): DurationInstance => ({ step_code: "D6", actual_start: s, actual_end: e });
  it("n=0 → stats null, suggest null", () => {
    const [r] = learnedDurationRows([], steps, gn);
    expect(r!.stats).toBeNull(); expect(r!.suggest).toBeNull(); expect(r!.gateName).toBe("D-name");
  });
  it("n=4 → stats shown, suggest null (below threshold)", () => {
    const rows = learnedDurationRows([inst("2026-06-01","2026-06-09"),inst("2026-06-01","2026-06-09"),inst("2026-06-01","2026-06-09"),inst("2026-06-01","2026-06-09")], steps, gn);
    expect(rows[0]!.stats!.n).toBe(4); expect(rows[0]!.suggest).toBeNull();
  });
  it("n>=5 & median != estimate → suggest = median", () => {
    const five = Array.from({ length: 5 }, () => inst("2026-06-01", "2026-06-09")); // 8 days each
    expect(learnedDurationRows(five, steps, gn)[0]!.suggest).toBe(8);
  });
  it("n>=5 & median == estimate → no suggest", () => {
    const five = Array.from({ length: 5 }, () => inst("2026-06-01", "2026-06-07")); // 6 days = estimate
    expect(learnedDurationRows(five, steps, gn)[0]!.suggest).toBeNull();
  });
  it("excludes instances missing actual_start/end", () => {
    const bad = [{ step_code: "D6", actual_start: "", actual_end: "2026-06-09" } as DurationInstance];
    expect(learnedDurationRows(bad, steps, gn)[0]!.stats).toBeNull();
  });
});

describe("learnedDurationRows metric routing", () => {
  const inst = (code: string, s: string, e: string) => ({ step_code: code, actual_start: s, actual_end: e });
  const gn = (g: string) => g;
  it("procurement → lead_time metric, estimate = lead_time_days, suggests vs lead time", () => {
    const steps = [{ code: "P", gate_code: "D", name: "Order", typical_duration_days: 1, lead_time_days: 14, step_type: "procurement" }];
    const five = Array.from({ length: 5 }, () => inst("P", "2026-06-01", "2026-06-21")); // 20 days
    const [r] = learnedDurationRows(five as never, steps as never, gn);
    expect(r!.metric).toBe("lead_time");
    expect(r!.estimate).toBe(14);
    expect(r!.suggest).toBe(20);
  });
  it("site_work → duration metric, estimate = typical_duration_days (unchanged #27 behavior)", () => {
    const steps = [{ code: "W", gate_code: "D", name: "Pasang", typical_duration_days: 6, lead_time_days: 0, step_type: "site_work" }];
    const five = Array.from({ length: 5 }, () => inst("W", "2026-06-01", "2026-06-09")); // 8 days
    const [r] = learnedDurationRows(five as never, steps as never, gn);
    expect(r!.metric).toBe("duration");
    expect(r!.estimate).toBe(6);
    expect(r!.suggest).toBe(8);
  });
  it("n<5 → no suggest (both metrics)", () => {
    const steps = [{ code: "P", gate_code: "D", name: "Order", typical_duration_days: 1, lead_time_days: 14, step_type: "procurement" }];
    expect(learnedDurationRows([inst("P","2026-06-01","2026-06-21")] as never, steps as never, gn)[0]!.suggest).toBeNull();
  });
});
