import { describe, expect, it } from "vitest";
import { summarizeProjectRisk } from "@/lib/steps/slip-risk";
import type { ProjectStepSignalRow } from "@/lib/steps/queries";

const row = (kind: string, severity: string, areaName = "KM", stepName = "Lantai", message = "msg"): ProjectStepSignalRow => ({
  areaId: "a", areaName, stepCode: "S", stepName, tradeRole: null,
  signal: { stepCode: "S", kind: kind as never, severity: severity as never, message },
});

describe("summarizeProjectRisk", () => {
  it("empty → on_track, null bottleneck", () => {
    const r = summarizeProjectRisk([]);
    expect(r.level).toBe("on_track");
    expect(r.bottleneck).toBeNull();
  });
  it("behind_plan or blocking_timeline → behind", () => {
    expect(summarizeProjectRisk([row("behind_plan", "high")]).level).toBe("behind");
    expect(summarizeProjectRisk([row("blocking_timeline", "critical")]).level).toBe("behind");
  });
  it("only lead_time_risk/silent/stale_decision → at_risk", () => {
    expect(summarizeProjectRisk([row("lead_time_risk", "warning"), row("silent", "info")]).level).toBe("at_risk");
  });
  it("counts + bottleneck = first (worst) signal", () => {
    const r = summarizeProjectRisk([row("behind_plan", "high", "Dapur", "Order", "telat 3 hari"), row("silent", "info")]);
    expect(r.behindCount).toBe(1);
    expect(r.atRiskCount).toBe(1);
    expect(r.bottleneck).toEqual({ areaName: "Dapur", stepName: "Order", message: "telat 3 hari", severity: "high" });
  });
});
