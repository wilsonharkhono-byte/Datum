/**
 * "Hari Ini" advisor — pure ranking functions. No Supabase, no Date.now():
 * `now` is always passed in so the rules are unit-testable.
 *
 * Scoring table (higher = more urgent):
 *   gate_overdue     100 + min(2 × daysOverdue, 50)
 *   blocker           80 + min(ageDays, 20)
 *   cascade_risk      75
 *   decision_needed   70 (+20 if deadline ≤ 3 days away)
 *   awaiting_client   60 + min(ageDays / 2, 15)
 *   quote_expiring    50 + (7 − daysLeft) × 5      (daysLeft clamped to 0..7)
 *   schedule_rot      55  (one per project — gates >120d overdue mean the
 *                          baseline is fiction; re-baseline, don't firefight)
 *   gate_ready        52  (opportunity, not emergency: the rule engine says an
 *                          area's gate is done — one tap to confirm & advance)
 *   gate_soon (≤7d)   45 + (7 − daysLeft) × 4      (daysLeft clamped to 0..7)
 *   stale_card        30
 */

import type { AdvisorItem, AdvisorSignal } from "./types";

const DAY_MS = 86_400_000;

/** Whole days from `iso` to `now` (positive = past). Defensive on bad input. */
function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

/** Whole days from `now` to `iso` (positive = future). */
function daysUntil(iso: string | null | undefined, now: Date): number {
  return -daysSince(iso, now);
}

export function scoreItem(signal: AdvisorSignal, now: Date): number {
  switch (signal.type) {
    case "gate_overdue": {
      const overdue = Math.max(0, daysSince(signal.dueDate, now));
      return 100 + Math.min(2 * overdue, 50);
    }
    case "blocker": {
      const age = Math.max(0, daysSince(signal.occurredAt, now));
      return 80 + Math.min(age, 20);
    }
    case "cascade_risk":
      return 75;
    case "decision_needed": {
      const nearDeadline =
        signal.dueDate != null && daysUntil(signal.dueDate, now) <= 3;
      return 70 + (nearDeadline ? 20 : 0);
    }
    case "awaiting_client": {
      const age = Math.max(0, daysSince(signal.occurredAt, now));
      return 60 + Math.min(age / 2, 15);
    }
    case "quote_expiring": {
      const left = clamp07(daysUntil(signal.dueDate, now));
      return 50 + (7 - left) * 5;
    }
    case "gate_soon": {
      const left = clamp07(daysUntil(signal.dueDate, now));
      return 45 + (7 - left) * 4;
    }
    case "schedule_rot":
      return 55;
    case "gate_ready":
      return 52;
    case "stale_card":
      return 30;
  }
}

function clamp07(n: number): number {
  return Math.max(0, Math.min(7, n));
}

/**
 * Score every signal, sort by score descending (stable: input order breaks
 * ties), and keep the top `limit`.
 */
export function rankAdvisorItems(
  signals: AdvisorSignal[],
  now: Date,
  limit = 10,
): AdvisorItem[] {
  return signals
    .map(({ occurredAt: _o, dueDate: _d, ...item }) => ({
      ...item,
      score: scoreItem({ ...item, occurredAt: _o, dueDate: _d }, now),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

// ─── Label helpers (Bahasa) — pure so titles are testable too ────────────────

/** "lewat 5 hari" / "hari ini" / "3 hari lagi" */
export function dueLabelFor(dueDateIso: string, now: Date): string {
  const left = daysUntil(dueDateIso, now);
  if (left < 0) return `lewat ${-left} hari`;
  if (left === 0) return "hari ini";
  return `${left} hari lagi`;
}

/** "hari ini" / "1 hari" / "12 hari" / "2 bulan" — age of a timestamp. */
export function ageLabelFor(occurredAtIso: string, now: Date): string {
  const d = Math.max(0, daysSince(occurredAtIso, now));
  if (d <= 0) return "hari ini";
  if (d < 30) return `${d} hari`;
  return `${Math.floor(d / 30)} bulan`;
}
