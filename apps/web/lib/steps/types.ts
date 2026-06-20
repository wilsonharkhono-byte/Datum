/**
 * Trade-step model — hand-written domain types. These intentionally do not
 * depend on the generated DB types so the pure functions below are testable
 * before the migration is applied.
 */

export type StepType = "decision" | "procurement" | "site_work" | "inspection";

export type StepStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "stalled"
  | "done_with_defects"
  | "accepted"
  | "not_applicable";

export type PunchSeverity = "kritis" | "mayor" | "minor";

/** Area profile that applicability is matched against. */
export type FinishProfile = {
  area_type: string; // 'bathroom', etc.
  [finishKey: string]: string | undefined; // lantai, dinding, kusen, plafon...
};

/** One template step (a row of trade_steps). */
export type TradeStepTemplate = {
  code: string;
  gate_code: string;
  name: string;
  step_type: StepType;
  trade_role: string | null;
  typical_duration_days: number;
  lead_time_days: number;
  sort_order: number;
  /** e.g. { lantai: ["marmer","batu"] }; empty object = always applies. */
  applicability: Record<string, string[]>;
};

export type TradeStepDep = { step_code: string; predecessor_code: string };

/** Inclusive date window, YYYY-MM-DD. */
export type DateWindow = { start: string; end: string };

/** A planned window assigned by back-scheduling. */
export type PlannedWindow = { planned_start: string; planned_end: string };
