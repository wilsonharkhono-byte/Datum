import type { PunchSeverity, StepStatus } from "@/lib/steps/types";

export type StepStatusInput = {
  workEvents: Array<{
    occurred_at: string;
    created_at: string;
    source?: "human" | "ai";
    payload: { status?: string; percent_complete?: number; blocked_on?: string; description?: string } | null;
  }>;
  checkpoints: Array<{ required: boolean; result: "pending" | "pass" | "fail" }>;
  punchItems: Array<{ severity: PunchSeverity; status: "open" | "fixing" | "closed" }>;
};

export type StepStatusResult = {
  status: StepStatus;
  lastProgressAt: string | null;
  blockingReason: string | null;
  actualStart: string | null;
  actualEnd: string | null;
};

/**
 * Newest-information-wins precedence: an AI event is ignored iff a human event
 * with occurred_at >= that AI event's occurred_at exists on the step (human
 * wins ties). This lets AI updates count again once they're newer than the
 * last human statement, instead of being silenced forever by one old human tap.
 * Back-compat: an event with no `source` is treated as human.
 */
function applyPrecedence<T extends { source?: "human" | "ai"; occurred_at: string }>(events: T[]): T[] {
  const humanTimes = events
    .filter((e) => (e.source ?? "human") === "human")
    .map((e) => e.occurred_at)
    .sort((a, b) => b.localeCompare(a)); // descending
  const newestHuman = humanTimes[0] ?? null;
  if (newestHuman === null) return events;

  return events.filter((e) => {
    if ((e.source ?? "human") === "human") return true;
    return e.occurred_at > newestHuman; // AI counts only if strictly newer than newest human
  });
}

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

function earliestStart(events: StepStatusInput["workEvents"]): string | null {
  const started = events
    .filter((e) => e.payload?.status === "in_progress" || isDone(e.payload))
    .map((e) => e.occurred_at)
    .sort((a, b) => a.localeCompare(b));
  return started[0] ?? null;
}

export function projectStepStatus(input: StepStatusInput): StepStatusResult {
  const workEvents = applyPrecedence(input.workEvents);
  const last = latest(workEvents);
  if (!last) {
    return { status: "not_started", lastProgressAt: null, blockingReason: null, actualStart: null, actualEnd: null };
  }

  const lastProgressAt = last.occurred_at;
  const actualStart = earliestStart(workEvents);

  if (last.payload?.status === "blocked") {
    return {
      status: "blocked",
      lastProgressAt,
      blockingReason: last.payload.blocked_on ?? last.payload.description ?? "Terblokir",
      actualStart,
      actualEnd: null,
    };
  }

  if (isDone(last.payload)) {
    const hasOpenSeriousPunch = input.punchItems.some(
      (p) => p.status !== "closed" && (p.severity === "kritis" || p.severity === "mayor"),
    );
    const allRequiredPassed = input.checkpoints
      .filter((c) => c.required)
      .every((c) => c.result === "pass");
    const status = !hasOpenSeriousPunch && allRequiredPassed ? "accepted" : "done_with_defects";
    return { status, lastProgressAt, blockingReason: null, actualStart, actualEnd: lastProgressAt };
  }

  return { status: "in_progress", lastProgressAt, blockingReason: null, actualStart, actualEnd: null };
}
