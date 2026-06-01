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
 * Per-gate "relevant" event kinds. Used both to filter inputs and to give
 * the gate its own taxonomy of what counts as progress evidence.
 */
const RELEVANT_KINDS: Record<GateCode, ReadonlySet<CardEventKind>> = {
  A: new Set(["worker_assigned", "progress", "defect", "drawing", "pending"]),
  B: new Set(["material", "decision", "vendor_pick", "vendor_quote", "progress", "pending"]),
  C: new Set(["material", "progress", "defect", "pending"]),
  D: new Set(["material", "decision", "vendor_pick", "drawing", "progress", "pending"]),
  E: new Set(["material", "progress", "defect", "pending"]),
  F: new Set(["vendor_pick", "material", "progress", "drawing", "pending"]),
  G: new Set(["worker_assigned", "progress", "defect", "pending"]),
  H: new Set(["client_request", "decision", "document", "progress", "pending"]),
};

const RULE_VERSION = 1;

export function evaluateGate(gate: GateCode, input: GateInput): GateResult {
  const relevant = RELEVANT_KINDS[gate];
  const events = input.events.filter((e) => relevant.has(e.event_kind as CardEventKind));

  if (events.length === 0) {
    return { status: "not_started", readinessScore: 0, blockingReason: null };
  }

  // Has any pending event → blocked
  const pendings = events.filter((e) => e.event_kind === "pending");
  if (pendings.length > 0) {
    // Use most recent pending's `what` as the blocking reason
    const latest = pendings.sort((a, b) =>
      (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""))[0];
    const what = (latest?.payload as { what?: string })?.what;
    return {
      status: "blocked",
      readinessScore: 0.25,
      blockingReason: what ?? "Ada item pending",
    };
  }

  // Has a 100% progress event → ready_for_handoff (passed once handed off in a later slice)
  const has100 = events.some((e) => {
    if (e.event_kind !== "progress") return false;
    const p = e.payload as { percent_complete?: number };
    return typeof p.percent_complete === "number" && p.percent_complete >= 100;
  });
  if (has100) {
    return { status: "ready_for_handoff", readinessScore: 1.0, blockingReason: null };
  }

  // Otherwise: in_progress, score proportional to evidence count (capped)
  const score = Math.min(0.9, 0.3 + events.length * 0.05);
  return { status: "in_progress", readinessScore: Number(score.toFixed(2)), blockingReason: null };
}

export { RULE_VERSION };
