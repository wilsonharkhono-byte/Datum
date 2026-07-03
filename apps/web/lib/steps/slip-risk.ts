import type { ProjectStepSignalRow } from "@/lib/steps/queries";

export type RiskLevel = "behind" | "at_risk" | "on_track";
export type ProjectRisk = {
  level: RiskLevel;
  behindCount: number;   // behind_plan + blocking_timeline
  atRiskCount: number;   // lead_time_risk + silent + stale_decision
  bottleneck: { areaName: string; stepName: string; message: string; severity: string } | null;
};

const BEHIND_KINDS = new Set(["behind_plan", "blocking_timeline"]);

const LEVEL_RANK: Record<RiskLevel, number> = { behind: 0, at_risk: 1, on_track: 2 };

/** Days past target handover at which forecast slip alone escalates to "behind". */
const BEHIND_SLIP_DAYS = 14;

/**
 * Roll a project's step-signals AND its forecast slip into a slip-risk
 * verdict + its worst signal.
 *
 * B5 fix: signals alone go silent when nothing has fired a step-signal rule
 * yet, but the forecast (projected handover vs target) can already show a
 * real slip — that combination used to render "Aman" next to "+34 hari dari
 * target" on /risiko, a vocabulary contradiction. `slipDays` (from
 * getProjectForecast; null/undefined when no forecast/target) is now folded
 * into the level: any positive slip is at least at_risk, and slip > 14
 * calendar days is at least behind — matching the signal-only thresholds, so
 * forecast can only ever escalate the level, never downgrade a worse
 * signal-derived one.
 */
export function summarizeProjectRisk(signals: ProjectStepSignalRow[], slipDays?: number | null): ProjectRisk {
  let behindCount = 0;
  let atRiskCount = 0;
  for (const s of signals) {
    if (BEHIND_KINDS.has(s.signal.kind)) behindCount++;
    else atRiskCount++;
  }
  const signalLevel: RiskLevel = behindCount > 0 ? "behind" : atRiskCount > 0 ? "at_risk" : "on_track";
  const forecastLevel: RiskLevel =
    slipDays != null && slipDays > BEHIND_SLIP_DAYS ? "behind" : slipDays != null && slipDays > 0 ? "at_risk" : "on_track";
  const level: RiskLevel = LEVEL_RANK[forecastLevel] < LEVEL_RANK[signalLevel] ? forecastLevel : signalLevel;
  const worst = signals[0]; // getProjectStepSignals is already severity-sorted
  const bottleneck = worst
    ? { areaName: worst.areaName, stepName: worst.stepName, message: worst.signal.message, severity: worst.signal.severity }
    : null;
  return { level, behindCount, atRiskCount, bottleneck };
}
