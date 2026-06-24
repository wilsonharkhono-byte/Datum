import { describe, expect, it } from "vitest";
import { computeAreaFlags } from "@/lib/steps/flags";
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
