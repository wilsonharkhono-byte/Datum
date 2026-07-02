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

  // B5 live bug: "Aman" (on_track) alongside "+34 hari dari target" is a
  // vocabulary contradiction — signals were silent (no step-signal rows) but
  // the forecast already shows a large projected slip. Level must incorporate
  // forecast slip so "Aman" + a big slip line can never render together.
  describe("forecast slip matrix (B5)", () => {
    it("silent signals + slip 0 → on_track", () => {
      expect(summarizeProjectRisk([], 0).level).toBe("on_track");
    });
    it("silent signals + slip +1 → at_risk", () => {
      expect(summarizeProjectRisk([], 1).level).toBe("at_risk");
    });
    it("silent signals + slip +14 → at_risk (boundary, not yet behind)", () => {
      expect(summarizeProjectRisk([], 14).level).toBe("at_risk");
    });
    it("silent signals + slip +15 → behind", () => {
      expect(summarizeProjectRisk([], 15).level).toBe("behind");
    });
    it("silent signals + slip +34 (the exact live bug) → behind, never on_track", () => {
      expect(summarizeProjectRisk([], 34).level).toBe("behind");
    });
    it("null slip (no forecast) does not change the signal-only verdict", () => {
      expect(summarizeProjectRisk([], null).level).toBe("on_track");
      expect(summarizeProjectRisk([row("lead_time_risk", "warning")], null).level).toBe("at_risk");
    });
    it("negative slip (ahead of target) never downgrades to at_risk/behind on its own", () => {
      expect(summarizeProjectRisk([], -5).level).toBe("on_track");
    });
    it("slip escalates a signal-only at_risk verdict to behind past 14 days", () => {
      expect(summarizeProjectRisk([row("silent", "info")], 15).level).toBe("behind");
    });
    it("slip never downgrades an already-behind signal verdict", () => {
      expect(summarizeProjectRisk([row("behind_plan", "high")], 0).level).toBe("behind");
    });
    it("small slip (+1..+14) does not downgrade an at_risk verdict from signals", () => {
      expect(summarizeProjectRisk([row("lead_time_risk", "warning")], 5).level).toBe("at_risk");
    });
  });
});
