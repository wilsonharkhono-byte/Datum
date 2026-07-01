import type { ProjectStepSignalRow } from "@/lib/steps/queries";

export type RiskLevel = "behind" | "at_risk" | "on_track";
export type ProjectRisk = {
  level: RiskLevel;
  behindCount: number;   // behind_plan + blocking_timeline
  atRiskCount: number;   // lead_time_risk + silent + stale_decision
  bottleneck: { areaName: string; stepName: string; message: string; severity: string } | null;
};

const BEHIND_KINDS = new Set(["behind_plan", "blocking_timeline"]);

/** Roll a project's step-signals into a slip-risk verdict + its worst signal. */
export function summarizeProjectRisk(signals: ProjectStepSignalRow[]): ProjectRisk {
  let behindCount = 0;
  let atRiskCount = 0;
  for (const s of signals) {
    if (BEHIND_KINDS.has(s.signal.kind)) behindCount++;
    else atRiskCount++;
  }
  const level: RiskLevel = behindCount > 0 ? "behind" : atRiskCount > 0 ? "at_risk" : "on_track";
  const worst = signals[0]; // getProjectStepSignals is already severity-sorted
  const bottleneck = worst
    ? { areaName: worst.areaName, stepName: worst.stepName, message: worst.signal.message, severity: worst.signal.severity }
    : null;
  return { level, behindCount, atRiskCount, bottleneck };
}
