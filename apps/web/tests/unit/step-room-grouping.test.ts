import { describe, expect, it } from "vitest";
import { groupStepsByGate, activeSteps } from "@/lib/steps/queries";

const mk = (id: string, gate: string, code: string, status: string) => ({
  id, step_code: code, name: code, step_type: "site_work", gate_code: gate, status,
  planned_start: null, planned_end: null, assigned_trade: null,
  blocking_reason: null, last_progress_at: null, checkpoints: [],
});

describe("groupStepsByGate", () => {
  it("groups by gate_code, ordered A→H, with done counts; custom cst_ codes group by their gate", () => {
    const steps = [mk("1","A","A1","accepted"), mk("2","A","A2","not_started"),
                   mk("3","D","cst_abc","not_started"), mk("4","D","D1","not_started")];
    const g = groupStepsByGate(steps as never);
    expect(g.map((x) => x.gate)).toEqual(["A", "D"]);
    expect(g[0]!.done).toBe(1);
    expect(g[1]!.steps.map((s) => s.step_code)).toEqual(["cst_abc", "D1"]);
  });
});

describe("activeSteps", () => {
  it("returns in_progress/blocked steps plus the readyToStart step", () => {
    const steps = [mk("1","A","A1","in_progress"), mk("2","A","A2","not_started"), mk("3","A","A3","accepted")];
    const out = activeSteps(steps as never, { readyToStart: "A2", needsDecision: [], blocked: [] });
    expect(out.map((s) => s.step_code).sort()).toEqual(["A1", "A2"]);
  });
});
