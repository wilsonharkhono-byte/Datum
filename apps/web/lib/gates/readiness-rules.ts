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

export const RULE_VERSION = 2;

/**
 * Stable comparator for work events. Compares occurred_at first, then
 * created_at (to break same-day ties from manual date-only inputs), then
 * id as a final tiebreaker to ensure a deterministic order across recomputes.
 */
function compareWorkEvents(a: CardEvent, b: CardEvent): number {
  const byOccurred = (a.occurred_at ?? "").localeCompare(b.occurred_at ?? "");
  if (byOccurred !== 0) return byOccurred;
  const byCreated = (a.created_at ?? "").localeCompare(b.created_at ?? "");
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

export function evaluateGate(gate: GateCode, input: GateInput): GateResult {
  const relevant = RELEVANT_KINDS[gate];
  const events = input.events.filter((e) => relevant.has(e.event_kind));

  if (events.length === 0) {
    return { status: "not_started", readinessScore: 0, blockingReason: null };
  }

  // Work-stream state is evaluated per card. The log is append-only, so within
  // each card a newer entry supersedes an older blocker or completion. Across
  // cards the semantics are:
  //   - blocked    if ANY card's latest work event has status "blocked"
  //   - ready_for_handoff only when EVERY card that has work events is done/100%
  //   - otherwise  in_progress
  const workEvents = events.filter((e) => e.event_kind === "work");

  if (workEvents.length > 0) {
    // Group by card_id and pick the latest work event per card.
    const byCard = new Map<string, CardEvent>();
    for (const e of workEvents) {
      const current = byCard.get(e.card_id);
      if (!current || compareWorkEvents(current, e) < 0) {
        byCard.set(e.card_id, e);
      }
    }

    const latestPerCard = Array.from(byCard.values());

    // Check for any blocker first — use the most-recent blocker for the reason.
    const blockers = latestPerCard.filter((e) => {
      const wp = e.payload as { status?: string } | undefined;
      return wp?.status === "blocked";
    });

    if (blockers.length > 0) {
      const mostRecentBlocker = blockers.sort(compareWorkEvents).at(-1)!;
      const wp = mostRecentBlocker.payload as {
        blocked_on?: string;
        description?: string;
        notes?: string;
      } | undefined;
      return {
        status: "blocked",
        readinessScore: 0.25,
        blockingReason: wp?.blocked_on ?? wp?.description ?? wp?.notes ?? "Ada pekerjaan terblokir",
      };
    }

    // ready_for_handoff only when every card's latest work event is done/100%.
    const allDone = latestPerCard.every((e) => {
      const wp = e.payload as { status?: string; percent_complete?: number } | undefined;
      return wp?.status === "done" || (typeof wp?.percent_complete === "number" && wp.percent_complete >= 100);
    });

    if (allDone) {
      return { status: "ready_for_handoff", readinessScore: 1.0, blockingReason: null };
    }
  }

  const score = Math.min(0.9, 0.3 + events.length * 0.05);
  return { status: "in_progress", readinessScore: Number(score.toFixed(2)), blockingReason: null };
}
