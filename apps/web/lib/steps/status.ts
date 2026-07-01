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

/** Human events outrank AI: if any human event exists, AI events are ignored. */
function applyPrecedence<T extends { source?: "human" | "ai" }>(events: T[]): T[] {
  const hasHuman = events.some((e) => (e.source ?? "human") === "human");
  return hasHuman ? events.filter((e) => (e.source ?? "human") === "human") : events;
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
