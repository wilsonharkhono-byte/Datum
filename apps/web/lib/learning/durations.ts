export type DurationInstance = { step_code: string; actual_start: string; actual_end: string };
export type StandardStepRow = { code: string; gate_code: string; name: string; typical_duration_days: number; lead_time_days: number; step_type: string };
export type DurationStats = { median: number; min: number; max: number; n: number };
export type LearnedRow = {
  code: string;
  gate_code: string;
  gateName: string;
  name: string;
  metric: "duration" | "lead_time";
  estimate: number;
  stats: DurationStats | null;
  suggest: number | null;
};

const MIN_SAMPLE = 5;
const DAY_MS = 86_400_000;

/** Whole calendar days between the date portions (UTC), clamped to >= 1. Matches back-schedule's calendar-day model. */
export function durationDays(start: string, end: string): number {
  const s = Date.parse(start.slice(0, 10) + "T00:00:00Z");
  const e = Date.parse(end.slice(0, 10) + "T00:00:00Z");
  if (Number.isNaN(s) || Number.isNaN(e)) return 1;
  return Math.max(1, Math.round((e - s) / DAY_MS));
}

export function summarizeDurations(samples: number[]): DurationStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { median: 0, min: 0, max: 0, n: 0 };
  const mid = Math.floor((n - 1) / 2);
  const median = n % 2 ? sorted[mid]! : Math.round((sorted[mid]! + sorted[mid + 1]!) / 2);
  return { median, min: sorted[0]!, max: sorted[n - 1]!, n };
}

/** Per firm-standard step: summarize its completed instances' durations; suggest the median when n >= 5 and it differs from the estimate. */
export function learnedDurationRows(
  instances: DurationInstance[],
  steps: StandardStepRow[],
  gateName: (g: string) => string,
): LearnedRow[] {
  const byCode = new Map<string, number[]>();
  for (const i of instances) {
    if (!i.actual_start || !i.actual_end) continue;
    const arr = byCode.get(i.step_code) ?? [];
    arr.push(durationDays(i.actual_start, i.actual_end));
    byCode.set(i.step_code, arr);
  }
  return steps.map((s) => {
    const metric: "duration" | "lead_time" = s.step_type === "procurement" ? "lead_time" : "duration";
    const estimate = metric === "lead_time" ? s.lead_time_days : s.typical_duration_days;
    const samples = byCode.get(s.code) ?? [];
    const stats = samples.length ? summarizeDurations(samples) : null;
    const suggest = stats && stats.n >= MIN_SAMPLE && stats.median !== estimate ? stats.median : null;
    return { code: s.code, gate_code: s.gate_code, gateName: gateName(s.gate_code), name: s.name, metric, estimate, stats, suggest };
  });
}
