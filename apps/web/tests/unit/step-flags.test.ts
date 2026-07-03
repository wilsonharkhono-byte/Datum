import { describe, expect, it } from "vitest";
import { computeAreaFlags, truncateNames } from "@/lib/steps/flags";
import type { TradeStepDep } from "@/lib/steps/types";

type S = { step_code: string; step_type: string; status: string };
const deps: TradeStepDep[] = [
  { step_code: "B3", predecessor_code: "B1" },
  { step_code: "B6", predecessor_code: "B3" },
];

describe("computeAreaFlags", () => {
  it("readyToStart = first not_started step whose predecessors are accepted", () => {
    const steps: S[] = [
      { step_code: "B1", step_type: "decision", status: "accepted" },
      { step_code: "B3", step_type: "procurement", status: "not_started" },
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe("B3");
  });

  it("does not offer a step whose predecessor is unfinished", () => {
    const steps: S[] = [
      { step_code: "B1", step_type: "decision", status: "in_progress" },
      { step_code: "B3", step_type: "procurement", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe(null);
  });

  it("needsDecision = open decision/procurement that gates a not_started step", () => {
    const steps: S[] = [
      { step_code: "B1", step_type: "decision", status: "in_progress" },
      { step_code: "B3", step_type: "procurement", status: "not_started" },
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    // B1 (decision, in_progress) gates not_started B3; B3 (procurement, not_started)
    // gates not_started B6 — both are open decision/procurement gates per the spec.
    expect(computeAreaFlags(steps, deps).needsDecision).toEqual(["B1", "B3"]);
  });

  it("needsDecision surfaces a not_started decision/procurement that gates another not_started step", () => {
    const steps: S[] = [
      { step_code: "B1", step_type: "decision", status: "not_started" },
      { step_code: "B3", step_type: "procurement", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).needsDecision).toEqual(["B1"]);
  });

  it("blocked lists blocked and stalled steps", () => {
    const steps: S[] = [
      { step_code: "B3", step_type: "procurement", status: "blocked" },
      { step_code: "B6", step_type: "site_work", status: "stalled" },
    ];
    expect(computeAreaFlags(steps, deps).blocked.sort()).toEqual(["B3", "B6"]);
  });

  it("treats an absent predecessor as satisfied (removed/excluded prerequisite does not block)", () => {
    // B6 depends on B3, but B3 is absent from the area's active steps.
    const steps: S[] = [
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe("B6");
  });

  it("a present-but-unfinished predecessor still blocks (regression)", () => {
    const steps: S[] = [
      { step_code: "B3", step_type: "procurement", status: "in_progress" },
      { step_code: "B6", step_type: "site_work", status: "not_started" },
    ];
    expect(computeAreaFlags(steps, deps).readyToStart).toBe(null);
  });
});

// Mobile-blob fix: "Perlu keputusan: <21 names>" used to join every name with
// no cap, producing an unreadable wall of text on narrow screens. The flags
// line must truncate to 3 named steps + "+N lainnya".
describe("truncateNames", () => {
  it("passes short lists through unchanged, joined with comma", () => {
    expect(truncateNames(["Keramik", "Cat", "Lampu"])).toBe("Keramik, Cat, Lampu");
    expect(truncateNames(["Keramik"])).toBe("Keramik");
    expect(truncateNames([])).toBe("");
  });

  it("caps at 3 names + a '+N lainnya' suffix beyond that", () => {
    const names = ["A", "B", "C", "D"];
    expect(truncateNames(names)).toBe("A, B, C, +1 lainnya");
  });

  it("the exact live-bug shape: 21 names truncate to 3 + '+18 lainnya'", () => {
    const names = Array.from({ length: 21 }, (_, i) => `Langkah ${i + 1}`);
    expect(truncateNames(names)).toBe("Langkah 1, Langkah 2, Langkah 3, +18 lainnya");
  });

  it("exactly at the cap (3) shows no suffix", () => {
    expect(truncateNames(["A", "B", "C"])).toBe("A, B, C");
  });

  it("respects a custom limit", () => {
    expect(truncateNames(["A", "B", "C", "D", "E"], 2)).toBe("A, B, +3 lainnya");
  });
});
