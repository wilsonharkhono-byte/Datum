/**
 * Trello-style card labels. Each card carries 0–3 small colored chips that
 * surface its state at a glance on the board (without opening the card).
 *
 * Labels are derived, not stored — computed from card.status + the recent
 * event stream so the board reflects whatever the team has been doing.
 */

import type { Card } from "@datum/db";

export type CardLabelKind =
  | "high_risk"      // recent high-risk event — red
  | "client"         // recent client_request — info blue
  | "decision"       // recent decision — warning amber
  | "pending"        // status: dormant / waiting — sand
  | "done";          // status: closed — ok green

export type CardLabel = {
  kind: CardLabelKind;
  label: string;     // short Bahasa label shown on the chip
};

export type CardWithLabels = Card & { labels: CardLabel[] };

const LABEL_TEXT: Record<CardLabelKind, string> = {
  high_risk: "Berisiko",
  client:    "Klien",
  decision:  "Keputusan",
  pending:   "Tertunda",
  done:      "Selesai",
};

/** Tailwind/inline color tokens for each label kind. Used inline so we don't
 *  rely on JIT picking up arbitrary classnames. */
export const LABEL_STYLE: Record<CardLabelKind, { bg: string; fg: string }> = {
  high_risk: { bg: "var(--flag-high-bg)",     fg: "var(--flag-high)" },
  client:    { bg: "var(--flag-info-bg)",     fg: "var(--flag-info)" },
  decision:  { bg: "var(--flag-warning-bg)",  fg: "var(--flag-warning)" },
  pending:   { bg: "var(--sand-tint)",        fg: "var(--sand-dark)" },
  done:      { bg: "var(--flag-ok-bg)",       fg: "var(--flag-ok)" },
};

/**
 * Given a card + the set of "recent" (e.g. last 30 days) event kinds present
 * on that card, returns the labels to display. Order matters: most important
 * first. Max 3 labels per card.
 */
export function computeCardLabels(card: Card, recentKinds: Set<string>): CardLabel[] {
  const out: CardLabel[] = [];

  // Status labels are exclusive
  if (card.status === "closed") {
    out.push({ kind: "done", label: LABEL_TEXT.done });
  } else if (card.status === "dormant") {
    out.push({ kind: "pending", label: LABEL_TEXT.pending });
  }

  // Activity labels — only on active cards (closed/dormant cards don't need
  // recent-activity noise)
  if (card.status === "active") {
    if (
      recentKinds.has("decision") ||
      recentKinds.has("vendor") ||
      recentKinds.has("client_request") ||
      recentKinds.has("work")
    ) {
      out.push({ kind: "high_risk", label: LABEL_TEXT.high_risk });
    }
    if (recentKinds.has("client_request")) {
      out.push({ kind: "client", label: LABEL_TEXT.client });
    }
    if (recentKinds.has("decision")) {
      out.push({ kind: "decision", label: LABEL_TEXT.decision });
    }
  }

  return out.slice(0, 3);
}
