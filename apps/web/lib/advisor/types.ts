/**
 * "Hari Ini" proactive advisor — shared types.
 *
 * An AdvisorItem is one ranked next-action row, computed from existing data
 * only (gates, blockers, decisions, client requests, quotes, stale cards).
 */

export type AdvisorItemType =
  | "gate_overdue"
  | "gate_soon"
  | "blocker"
  | "decision_needed"
  | "awaiting_client"
  | "quote_expiring"
  | "cascade_risk"
  | "stale_card"
  | "schedule_rot";

export type AdvisorItem = {
  type: AdvisorItemType;
  score: number;
  /** Human phrasing in Bahasa, e.g. "Gate D R. Tamu lewat 5 hari". */
  title: string;
  detail?: string;
  href: string;
  projectCode: string;
  /** Short right-aligned label, e.g. "lewat 5 hari" / "3 hari lagi". */
  dueLabel?: string;
};

/**
 * Pre-scoring signal: an AdvisorItem minus the score, plus the time anchors
 * the scorer needs. Dates stay raw so `now` can be injected in tests.
 */
export type AdvisorSignal = Omit<AdvisorItem, "score"> & {
  /** ISO timestamp of when the signal arose (blockers, requests, stale cards). */
  occurredAt?: string | null;
  /** YYYY-MM-DD the signal is due (gate target end, quote expiry, decision deadline). */
  dueDate?: string | null;
};

/** Upcoming gate cell, used for the assistant's deadline context. */
export type AdvisorGateCell = {
  areaName: string;
  gateCode: string;
  status: string;
  targetEndDate: string; // YYYY-MM-DD
};
