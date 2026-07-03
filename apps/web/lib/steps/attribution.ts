import type { StepEventCardLink } from "@/lib/steps/queries";

/**
 * Shared display helpers for rendering step-event attribution (who/what
 * confidence/which card produced an update). Used by both the per-step
 * history list (components/schedule/StepDetail.tsx) and the project-wide
 * activity feed (app/(app)/project/[slug]/activity/page.tsx) — the two
 * previously carried byte-for-byte duplicate copies of this logic.
 */

/** Pure: "Asisten AI" for AI-authored events with no human author; otherwise the human's name (may be null). */
export function eventAuthorLabel(ev: { source: string; author_name: string | null }): string | null {
  if (ev.source === "ai") return ev.author_name ?? "Asisten AI";
  return ev.author_name;
}

/** Pure: confidence 0–1 → fixed 2-decimal display string (e.g. 0.947 -> "0.95"), null when absent. */
export function confidenceLabel(confidence: number | null): string | null {
  if (confidence === null) return null;
  return confidence.toFixed(2);
}

/** Pure: href for "dari kartu →", null when there's no resolvable card link. */
export function cardLinkHref(cardLink: StepEventCardLink | null): string | null {
  if (!cardLink) return null;
  return `/project/${cardLink.projectCode}/cards/${cardLink.cardSlug}`;
}
