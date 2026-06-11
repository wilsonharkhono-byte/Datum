import type { GateCode } from "@datum/types";
import type { CardEvent, CardEventKind } from "@datum/db";

export type ReadinessState =
  | "not_started"
  | "in_progress"
  | "ready_for_handoff"
  | "blocked"
  | "passed"
  | "not_applicable";

export type GateInput = {
  /** All card_events on cards linked to this area (any project). */
  events: CardEvent[];
};

export type GateResult = {
  status: ReadinessState;
  readinessScore: number; // 0..1
  blockingReason: string | null;
};

/**
 * Per-gate "relevant" event kinds — rule version 2, aligned with the
 * consolidated 9-kind taxonomy (slice 1.9). `work` carries all process
 * state (assigned/in_progress/blocked/done) and is relevant to every gate.
 */
const RELEVANT_KINDS: Record<GateCode, ReadonlySet<CardEventKind>> = {
  A: new Set(["work", "drawing"]),
  B: new Set(["material", "decision", "vendor", "work"]),
  C: new Set(["material", "work"]),
  D: new Set(["material", "decision", "vendor", "drawing", "work"]),
  E: new Set(["material", "work"]),
  F: new Set(["vendor", "material", "drawing", "work"]),
  G: new Set(["work"]),
  H: new Set(["client_request", "decision", "document", "work"]),
};

const RULE_VERSION = 2;

export function evaluateGate(gate: GateCode, input: GateInput): GateResult {
  const relevant = RELEVANT_KINDS[gate];
  const events = input.events.filter((e) => relevant.has(e.event_kind as CardEventKind));

  if (events.length === 0) {
    return { status: "not_started", readinessScore: 0, blockingReason: null };
  }

  // The latest work event determines the work-stream state. The log is
  // append-only, so a newer entry supersedes an older blocker or completion.
  const latestWork = events
    .filter((e) => e.event_kind === "work")
    .sort((a, b) => (a.occurred_at ?? "").localeCompare(b.occurred_at ?? ""))
    .at(-1);
  const wp = latestWork?.payload as {
    status?: string;
    percent_complete?: number;
    blocked_on?: string;
    description?: string;
    notes?: string;
  } | undefined;

  if (wp?.status === "blocked") {
    return {
      status: "blocked",
      readinessScore: 0.25,
      blockingReason: wp.blocked_on ?? wp.description ?? wp.notes ?? "Ada pekerjaan terblokir",
    };
  }

  if (wp && (wp.status === "done" || (typeof wp.percent_complete === "number" && wp.percent_complete >= 100))) {
    return { status: "ready_for_handoff", readinessScore: 1.0, blockingReason: null };
  }

  const score = Math.min(0.9, 0.3 + events.length * 0.05);
  return { status: "in_progress", readinessScore: Number(score.toFixed(2)), blockingReason: null };
}

export { RULE_VERSION };
