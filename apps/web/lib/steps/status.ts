import type { PunchSeverity, StepStatus } from "@/lib/steps/types";

export type StepStatusInput = {
  workEvents: Array<{
    occurred_at: string;
    created_at: string;
    payload: { status?: string; percent_complete?: number; blocked_on?: string; description?: string } | null;
  }>;
  checkpoints: Array<{ required: boolean; result: "pending" | "pass" | "fail" }>;
  punchItems: Array<{ severity: PunchSeverity; status: "open" | "fixing" | "closed" }>;
};

export type StepStatusResult = {
  status: StepStatus;
  lastProgressAt: string | null;
  blockingReason: string | null;
};

/** occurred_at, then created_at as the tiebreak (mirrors compareEventTime). */
function latest<T extends { occurred_at: string; created_at: string }>(events: T[]): T | null {
  if (events.length === 0) return null;
  return [...events].sort((a, b) =>
    a.occurred_at === b.occurred_at
      ? a.created_at.localeCompare(b.created_at)
      : a.occurred_at.localeCompare(b.occurred_at),
  ).at(-1)!;
}

function isDone(p: StepStatusInput["workEvents"][number]["payload"]): boolean {
  return p?.status === "done" || (typeof p?.percent_complete === "number" && p.percent_complete >= 100);
}

export function projectStepStatus(input: StepStatusInput): StepStatusResult {
  const last = latest(input.workEvents);
  if (!last) return { status: "not_started", lastProgressAt: null, blockingReason: null };

  const lastProgressAt = last.occurred_at;

  if (last.payload?.status === "blocked") {
    return {
      status: "blocked",
      lastProgressAt,
      blockingReason: last.payload.blocked_on ?? last.payload.description ?? "Terblokir",
    };
  }

  if (isDone(last.payload)) {
    const hasOpenSeriousPunch = input.punchItems.some(
      (p) => p.status !== "closed" && (p.severity === "kritis" || p.severity === "mayor"),
    );
    const allRequiredPassed = input.checkpoints
      .filter((c) => c.required)
      .every((c) => c.result === "pass");
    if (!hasOpenSeriousPunch && allRequiredPassed) {
      return { status: "accepted", lastProgressAt, blockingReason: null };
    }
    return { status: "done_with_defects", lastProgressAt, blockingReason: null };
  }

  return { status: "in_progress", lastProgressAt, blockingReason: null };
}
