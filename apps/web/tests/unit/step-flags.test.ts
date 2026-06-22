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
    expect(computeAreaFlags(steps, deps).needsDecision).toEqual(["B1"]);
  });

  it("blocked lists blocked and stalled steps", () => {
    const steps: S[] = [
      { step_code: "B3", step_type: "procurement", status: "blocked" },
      { step_code: "B6", step_type: "site_work", status: "stalled" },
    ];
    expect(computeAreaFlags(steps, deps).blocked.sort()).toEqual(["B3", "B6"]);
  });
});
