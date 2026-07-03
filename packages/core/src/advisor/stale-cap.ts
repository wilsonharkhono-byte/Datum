/**
 * Stale-noise demotion for the brief's "Hari ini — prioritas" feed.
 *
 * Live finding: 20-month-old Trello imports ("Tanpa aktivitas …") drown the
 * feed once nothing urgent exists — stale_card scores a flat 30, so with few
 * higher-scoring signals the whole list becomes stale noise.
 *
 * This caps stale_card rows AT THE RENDER LEVEL, on purpose NOT inside
 * `getAdvisorData`/`rankAdvisorItems`: the engine has other consumers (the
 * project-board advisor strip, the assistant's retrieval context, the mobile
 * brief) whose contract must stay unchanged. Callers that want the cap apply
 * it to the ranked list they were given.
 */

import type { AdvisorItem } from "./types";

export type StaleCapResult = {
  /** The input list with stale_card rows beyond `max` removed (order preserved). */
  items: AdvisorItem[];
  /** How many stale_card rows were hidden — drives the "lihat semua" affordance. */
  hiddenStaleCount: number;
};

/** Pure: keep at most `max` stale_card items (the highest-ranked ones), all other items untouched. */
export function capStaleCards(items: AdvisorItem[], max = 3): StaleCapResult {
  let kept = 0;
  let hidden = 0;
  const out = items.filter((it) => {
    if (it.type !== "stale_card") return true;
    if (kept < max) {
      kept += 1;
      return true;
    }
    hidden += 1;
    return false;
  });
  return { items: out, hiddenStaleCount: hidden };
}
