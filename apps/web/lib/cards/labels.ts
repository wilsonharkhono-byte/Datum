/**
 * Card labels v2 — derived from OPEN LOOPS in the event stream, not from
 * kind-presence in a time window. Each chip answers a coordination
 * question: is this blocked, does it need a decision, whose ball is it.
 *
 * Labels are derived, not stored — computed from card.status + the card's
 * decision/client_request/work events at read time.
 */

import type { Card } from "@datum/db";
import { isClientRequestOpen, isDecisionOpen } from "@datum/types";
import { compareEventTime } from "@/lib/cards/event-order";
import type { CardDeadline } from "@/lib/gates/board-deadlines";

export type CardLabelKind =
  | "blocked"          // latest work event is blocked — red
  | "needs_decision"   // an open decision exists — warning amber
  | "awaiting"         // waiting on a named actor — info blue
  | "pending"          // card status: dormant — sand
  | "done";            // card status: closed — ok green

export type CardLabel = {
  kind: CardLabelKind;
  label: string;       // short Bahasa label shown on the chip
};

/** Minimal slice of a card_event needed to derive labels. */
export type LabelEvent = {
  event_kind: string;
  payload: Record<string, unknown> | null;
  occurred_at: string | null;
  created_at?: string | null;
  id?: string | null;
};

export type CardWithLabels = Card & {
  labels: CardLabel[];
  deadline: CardDeadline | null;
};

export const ACTOR_LABELS: Record<string, string> = {
  client:     "Klien",
  principal:  "Prinsipal",
  pic:        "PIC",
  contractor: "Kontraktor",
  architect:  "Arsitek",
  vendor:     "Vendor",
};

/** Inline color tokens per label kind (CSS variables from globals). */
export const LABEL_STYLE: Record<CardLabelKind, { bg: string; fg: string }> = {
  blocked:        { bg: "var(--flag-high-bg)",    fg: "var(--flag-high)" },
  needs_decision: { bg: "var(--flag-warning-bg)", fg: "var(--flag-warning)" },
  awaiting:       { bg: "var(--flag-info-bg)",    fg: "var(--flag-info)" },
  pending:        { bg: "var(--sand-tint)",       fg: "var(--sand-dark)" },
  done:           { bg: "var(--flag-ok-bg)",      fg: "var(--flag-ok)" },
};

/**
 * Derive labels from the card's open loops. `events` should be the card's
 * decision / client_request / work events (any age — open loops don't
 * expire). Order: most actionable first. Max 3 chips.
 */
export function computeCardLabels(card: Card, events: LabelEvent[]): CardLabel[] {
  // Status labels are exclusive — closed/dormant cards don't need loop noise.
  if (card.status === "closed")  return [{ kind: "done",    label: "Selesai"  }];
  if (card.status === "dormant") return [{ kind: "pending", label: "Tertunda" }];

  const out: CardLabel[] = [];
  const byTime = [...events].sort(compareEventTime);

  // 1. Blocked: the latest work event is a blocker (append-only log — a
  //    later work entry supersedes an older blocker).
  const lastWork = byTime.filter((e) => e.event_kind === "work").at(-1);
  if ((lastWork?.payload as { status?: string } | null)?.status === "blocked") {
    out.push({ kind: "blocked", label: "Terblokir" });
  }

  // 2. Open decision → needs a decision; if it names an actor, show whose
  //    ball it is.
  const openDecisions = byTime.filter(
    (e) =>
      e.event_kind === "decision" &&
      isDecisionOpen((e.payload ?? {}) as { status?: string; approved_by?: string }),
  );
  if (openDecisions.length > 0) {
    out.push({ kind: "needs_decision", label: "Butuh keputusan" });
    const awaiting = (openDecisions.at(-1)?.payload as { awaiting?: string } | null)?.awaiting;
    if (awaiting && ACTOR_LABELS[awaiting]) {
      out.push({ kind: "awaiting", label: `Menunggu ${ACTOR_LABELS[awaiting]}` });
    }
  }

  // 3. Open client request → waiting on the client (dedupe with #2).
  const hasOpenRequest = byTime.some(
    (e) =>
      e.event_kind === "client_request" &&
      isClientRequestOpen((e.payload ?? {}) as { status?: string }),
  );
  if (hasOpenRequest && !out.some((l) => l.label === "Menunggu Klien")) {
    out.push({ kind: "awaiting", label: "Menunggu Klien" });
  }

  return out.slice(0, 3);
}
