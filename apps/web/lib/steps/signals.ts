/**
 * Pure step-signal comparator — Part B of the schedule-aware assistant.
 *
 * Compares actual step state (status, timestamps) against the prescribed plan
 * (planned_start / planned_end) and emits typed signals that the advisor /
 * notification / assistant layers can surface.
 *
 * NO Supabase, NO Date.now(), NO React — purely testable.
 * Callers must assemble the input shape (join area_steps + trade_steps template
 * fields) and inject `today` (YYYY-MM-DD) + `now` (ISO string for silence math).
 */

import type { StepStatus, StepType, TradeStepDep } from "@/lib/steps/types";
import { addDays } from "@/lib/steps/back-schedule";

// ─── Thresholds (tune here; keep named) ──────────────────────────────────────

/** Days of silence before a warning fires (step is in_progress / inside window). */
const SILENCE_WARNING_DAYS = 3;

/** Days of silence before silence escalates to high severity. */
const SILENCE_HIGH_DAYS = 6;

/**
 * For `lead_time_risk`: if a step's lead time is non-zero and its successor's
 * planned_start is within `lead_time_days + LEAD_TIME_BUFFER_DAYS` of today,
 * the signal fires. Buffer = 0 means fire exactly at the boundary.
 */
const LEAD_TIME_BUFFER_DAYS = 0;

/**
 * For `blocking_timeline`: a blocked step signals if any successor's
 * planned_start is within this many days of today (inclusive).
 */
const BLOCKING_IMMINENT_DAYS = 7;

// ─── Public types ─────────────────────────────────────────────────────────────

export type StepSignalKind =
  | "silent"
  | "behind_plan"
  | "lead_time_risk"
  | "blocking_timeline"
  | "stale_decision";

export type StepSignalSeverity = "info" | "warning" | "high" | "critical";

export type StepSignal = {
  stepCode: string;
  kind: StepSignalKind;
  severity: StepSignalSeverity;
  /** Short Bahasa-Indonesia message suitable for advisor / notification. */
  message: string;
  detail?: string;
};

// ─── Input types ──────────────────────────────────────────────────────────────

/**
 * A single area step enriched with both its runtime state AND the template
 * fields the comparator needs. Callers must join `area_steps` with `trade_steps`.
 */
export type SignalStep = {
  step_code: string;
  name: string;
  step_type: StepType;
  trade_role: string | null;
  // Template scheduling fields
  lead_time_days: number;
  typical_duration_days: number;
  // Projected state (from projectAreaStep / area_steps row)
  status: StepStatus;
  planned_start: string | null; // YYYY-MM-DD or null if back-schedule not yet run
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  last_progress_at: string | null; // ISO timestamp
  blocking_reason: string | null;
};

export type ComputeSignalsInput = {
  steps: SignalStep[];
  deps: TradeStepDep[];
  /** YYYY-MM-DD, injected — do not call new Date() inside. */
  today: string;
  /**
   * ISO timestamp, injected — used for silence math.
   * If omitted, silence checks fall back to today-based comparison
   * (less precise but safe for daily cron use-cases).
   */
  now?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the positive number of whole days between two YYYY-MM-DD strings,
 * or between an ISO timestamp and a YYYY-MM-DD today.
 * Returns 0 if b >= a.
 */
function daysBefore(laterIso: string, earlierIso: string): number {
  // Truncate to date part for both comparisons
  const a = laterIso.slice(0, 10);
  const b = earlierIso.slice(0, 10);
  if (b >= a) return 0;
  // Count calendar days: a - b in days
  const msA = Date.parse(a + "T00:00:00Z");
  const msB = Date.parse(b + "T00:00:00Z");
  return Math.floor((msA - msB) / 86_400_000);
}

/** "YYYY-MM-DD" comparison: returns true if a > b */
function after(a: string, b: string): boolean {
  return a > b;
}

const DONE_STATUSES: ReadonlySet<StepStatus> = new Set([
  "accepted",
  "done_with_defects",
]);

function isDone(status: StepStatus): boolean {
  return DONE_STATUSES.has(status);
}

// ─── Individual signal rules ──────────────────────────────────────────────────

function behindPlanSignals(step: SignalStep, today: string): StepSignal[] {
  if (!step.planned_start || !step.planned_end) return [];
  if (isDone(step.status) || step.status === "not_applicable") return [];

  const signals: StepSignal[] = [];

  if (after(today, step.planned_end) && !isDone(step.status)) {
    // Past the end date and still not done → high
    const daysLate = daysBefore(today, step.planned_end);
    signals.push({
      stepCode: step.step_code,
      kind: "behind_plan",
      severity: "high",
      message: `${step.name} sudah ${daysLate} hari melewati tenggat rencana`,
      detail: `Direncanakan selesai ${step.planned_end}, status saat ini: ${step.status}`,
    });
  } else if (
    after(today, step.planned_start) &&
    step.status === "not_started"
  ) {
    // Past the start date but hasn't started → warning
    const daysBehind = daysBefore(today, step.planned_start);
    signals.push({
      stepCode: step.step_code,
      kind: "behind_plan",
      severity: "warning",
      message: `${step.name} harusnya mulai ${daysBehind} hari lalu tapi belum dimulai`,
      detail: `Direncanakan mulai ${step.planned_start}`,
    });
  }

  return signals;
}

function silentSignals(
  step: SignalStep,
  today: string,
  now: string,
): StepSignal[] {
  // Only fire for steps that are actively in-progress or inside their planned window
  const isInWindow =
    step.planned_start &&
    step.planned_end &&
    today >= step.planned_start &&
    today <= step.planned_end;
  const isActive = step.status === "in_progress" || isInWindow;

  if (!isActive) return [];
  if (isDone(step.status) || step.status === "not_applicable") return [];
  if (step.status === "blocked") return []; // blocking_timeline handles blocked steps

  if (!step.last_progress_at) {
    // No activity at all — treat as silent since start of planned window or today
    const anchor = step.planned_start ?? today;
    const daysSilent = daysBefore(today, anchor);
    if (daysSilent < SILENCE_WARNING_DAYS) return [];
    return [
      {
        stepCode: step.step_code,
        kind: "silent",
        severity: daysSilent >= SILENCE_HIGH_DAYS ? "high" : "warning",
        message: `${step.name} belum ada update sejak dimulai (${daysSilent} hari)`,
        detail: `Belum ada catatan progres untuk langkah ini`,
      },
    ];
  }

  // Compare `now` to last_progress_at in calendar days
  const lastProgressDate = step.last_progress_at.slice(0, 10);
  const referenceDate = now.slice(0, 10);
  const daysSilent = daysBefore(referenceDate, lastProgressDate);

  if (daysSilent < SILENCE_WARNING_DAYS) return [];

  return [
    {
      stepCode: step.step_code,
      kind: "silent",
      severity: daysSilent >= SILENCE_HIGH_DAYS ? "high" : "warning",
      message: `${step.name} belum ada update ${daysSilent} hari`,
      detail: `Update terakhir: ${lastProgressDate}`,
    },
  ];
}

function leadTimeRiskSignals(
  step: SignalStep,
  deps: TradeStepDep[],
  stepMap: Map<string, SignalStep>,
  today: string,
): StepSignal[] {
  // Only fire for steps with a meaningful lead time that haven't started
  if (step.lead_time_days <= 0) return [];
  if (step.status !== "not_started") return [];

  // Find all direct successors (steps that depend on this step)
  const successorCodes = deps
    .filter((d) => d.predecessor_code === step.step_code)
    .map((d) => d.step_code);

  if (successorCodes.length === 0) return [];

  const signals: StepSignal[] = [];

  for (const sCode of successorCodes) {
    const successor = stepMap.get(sCode);
    if (!successor?.planned_start) continue;

    // Days until the successor's planned_start
    const daysUntilSuccessor = daysBefore(successor.planned_start, today);
    // Lead time threshold: if daysUntilSuccessor <= lead_time_days + buffer, fire
    const threshold = step.lead_time_days + LEAD_TIME_BUFFER_DAYS;

    if (daysUntilSuccessor <= threshold) {
      signals.push({
        stepCode: step.step_code,
        kind: "lead_time_risk",
        severity: "high",
        message: `${step.name} harus dimulai sekarang atau ${successor.name} akan mundur`,
        detail: `Lead time: ${step.lead_time_days} hari; ${successor.name} direncanakan mulai ${successor.planned_start} (${daysUntilSuccessor} hari lagi)`,
      });
    }
  }

  return signals;
}

function blockingTimelineSignals(
  step: SignalStep,
  deps: TradeStepDep[],
  stepMap: Map<string, SignalStep>,
  today: string,
): StepSignal[] {
  if (step.status !== "blocked") return [];

  const successorCodes = deps
    .filter((d) => d.predecessor_code === step.step_code)
    .map((d) => d.step_code);

  if (successorCodes.length === 0) return [];

  const signals: StepSignal[] = [];

  for (const sCode of successorCodes) {
    const successor = stepMap.get(sCode);
    if (!successor?.planned_start) continue;

    const daysUntil = daysBefore(successor.planned_start, today);
    // Also fires if the successor's planned_start is already past (daysUntil = 0)
    if (daysUntil <= BLOCKING_IMMINENT_DAYS) {
      signals.push({
        stepCode: step.step_code,
        kind: "blocking_timeline",
        severity: "critical",
        message: `${step.name} terblokir dan ${successor.name} akan mulai dalam ${daysUntil} hari`,
        detail: step.blocking_reason
          ? `Alasan: ${step.blocking_reason}`
          : undefined,
      });
    }
  }

  return signals;
}

function staleDecisionSignals(step: SignalStep, today: string): StepSignal[] {
  if (step.step_type !== "decision" && step.step_type !== "procurement")
    return [];
  if (isDone(step.status) || step.status === "not_applicable") return [];

  // Stale if today > planned_end OR (no planned_end but today > planned_start)
  const anchor = step.planned_end ?? step.planned_start;
  if (!anchor) return [];

  if (!after(today, anchor)) return [];

  const daysOverdue = daysBefore(today, anchor);
  const label = step.step_type === "decision" ? "Keputusan" : "Pemesanan";

  return [
    {
      stepCode: step.step_code,
      kind: "stale_decision",
      severity: "high",
      message: `${label}: ${step.name} sudah ${daysOverdue} hari melewati tenggat`,
      detail: `Status: ${step.status}; tenggat: ${anchor}`,
    },
  ];
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compute all active signals for an area's steps.
 *
 * Each rule is independent — a single step can emit multiple signals.
 * Results are sorted by severity (critical first) then by step_code for
 * deterministic ordering.
 */
export function computeStepSignals(input: ComputeSignalsInput): StepSignal[] {
  const { steps, deps, today, now = today + "T00:00:00Z" } = input;

  const stepMap = new Map(steps.map((s) => [s.step_code, s]));
  const signals: StepSignal[] = [];

  for (const step of steps) {
    signals.push(...behindPlanSignals(step, today));
    signals.push(...silentSignals(step, today, now));
    signals.push(...leadTimeRiskSignals(step, deps, stepMap, today));
    signals.push(...blockingTimelineSignals(step, deps, stepMap, today));
    signals.push(...staleDecisionSignals(step, today));
  }

  // De-dupe: same step + same kind can't appear twice (take first/highest)
  const seen = new Set<string>();
  const deduped = signals.filter((s) => {
    const key = `${s.stepCode}:${s.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const SEVERITY_ORDER: Record<StepSignalSeverity, number> = {
    critical: 0,
    high: 1,
    warning: 2,
    info: 3,
  };

  return deduped.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.stepCode.localeCompare(b.stepCode),
  );
}
