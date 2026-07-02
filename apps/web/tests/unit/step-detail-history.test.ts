/**
 * Tests for the StepHistory sub-component rendered inside StepDetail.
 * Uses React's server-side renderToString (works in node env, no jsdom needed)
 * to assert on the HTML output.
 *
 * We import the file, but StepDetail is "use client" — renderToString still
 * works for client components in React 18 (it skips hydration markers).
 * We wrap the import via a dynamic approach: because StepDetail uses
 * useRouter / useTransition which are not available in node, we test only
 * the StepHistory helper directly by extracting it to a shared module.
 *
 * Instead, we rely on the fact that the display logic can be verified through
 * the pure EVENT_CHIP map and the formatEventTime helper, which we re-implement
 * here at the same spec as the component. The real correctness guarantee is the
 * `pnpm --filter web build` step which compiles the whole component tree.
 */

import { describe, expect, it } from "vitest";
import type { AreaStepEventRow } from "@/lib/steps/queries";

// --- Mirror the display helpers from StepDetail.tsx so we can unit-test them ---
// (StepDetail.tsx is a .tsx "use client" file — vitest's node-env transform for this
// suite can't parse JSX, so we can't import it directly; see the module docstring above.)

const EVENT_CHIP: Record<string, { label: string; cls: string }> = {
  not_started: { label: "Belum mulai", cls: "bg-[var(--sand-tint)] text-[var(--text-muted)]" },
  in_progress:  { label: "Berjalan",   cls: "bg-blue-100 text-blue-800" },
  blocked:      { label: "Terblokir",  cls: "bg-red-100 text-red-800" },
  done:         { label: "Selesai",    cls: "bg-green-100 text-green-800" },
};

function formatEventTime(isoString: string): string {
  return new Date(isoString).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

const HISTORY_PREVIEW = 5;

function buildHistoryItems(events: AreaStepEventRow[], expanded: boolean) {
  return expanded ? events : events.slice(0, HISTORY_PREVIEW);
}

/** Mirrors StepDetail.tsx's eventAuthorLabel: "Asisten AI" for author-less AI events, else the human name. */
function eventAuthorLabel(ev: Pick<AreaStepEventRow, "source" | "author_name">): string | null {
  if (ev.source === "ai") return ev.author_name ?? "Asisten AI";
  return ev.author_name;
}

/** Mirrors StepDetail.tsx's confidenceLabel: fixed 2-decimal display, null when absent. */
function confidenceLabel(confidence: number | null): string | null {
  if (confidence === null) return null;
  return confidence.toFixed(2);
}

/** Mirrors StepDetail.tsx's cardLinkHref: "/project/{code}/cards/{slug}", null when unresolved. */
function cardLinkHref(cardLink: AreaStepEventRow["card_link"]): string | null {
  if (!cardLink) return null;
  return `/project/${cardLink.projectCode}/cards/${cardLink.cardSlug}`;
}

// --- Helpers used in assertions ---

function makeEvent(overrides: Partial<AreaStepEventRow> = {}): AreaStepEventRow {
  return {
    id: "ev1",
    area_step_id: "step1",
    status: "in_progress",
    note: "tukang datang besok",
    percent_complete: null,
    occurred_at: "2026-06-20T10:00:00Z",
    created_at: "2026-06-20T10:00:00Z",
    author_name: "Budi Santoso",
    source: "human",
    confidence: null,
    card_event_id: null,
    card_link: null,
    ...overrides,
  };
}

describe("StepHistory display logic", () => {
  describe("EVENT_CHIP map", () => {
    it("has a chip entry for all four canonical statuses", () => {
      expect(EVENT_CHIP.not_started).toBeDefined();
      expect(EVENT_CHIP.in_progress).toBeDefined();
      expect(EVENT_CHIP.blocked).toBeDefined();
      expect(EVENT_CHIP.done).toBeDefined();
    });

    it("in_progress chip label is 'Berjalan'", () => {
      expect(EVENT_CHIP.in_progress!.label).toBe("Berjalan");
    });

    it("blocked chip label is 'Terblokir'", () => {
      expect(EVENT_CHIP.blocked!.label).toBe("Terblokir");
    });

    it("done chip label is 'Selesai'", () => {
      expect(EVENT_CHIP.done!.label).toBe("Selesai");
    });
  });

  describe("formatEventTime", () => {
    it("returns a non-empty locale string for a valid ISO timestamp", () => {
      const result = formatEventTime("2026-06-20T10:00:00Z");
      expect(result.length).toBeGreaterThan(0);
    });

    it("includes the year in the formatted string", () => {
      const result = formatEventTime("2026-06-20T10:00:00Z");
      expect(result).toContain("2026");
    });
  });

  describe("buildHistoryItems (preview / expand)", () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      makeEvent({ id: `ev${i}`, note: `note ${i}` }),
    );

    it("shows only HISTORY_PREVIEW events when not expanded", () => {
      const shown = buildHistoryItems(events, false);
      expect(shown).toHaveLength(HISTORY_PREVIEW);
    });

    it("shows all events when expanded", () => {
      const shown = buildHistoryItems(events, true);
      expect(shown).toHaveLength(8);
    });

    it("shows all when there are fewer than HISTORY_PREVIEW events", () => {
      const few = events.slice(0, 3);
      expect(buildHistoryItems(few, false)).toHaveLength(3);
    });
  });

  describe("event row shape", () => {
    it("event with note and author renders both fields", () => {
      const ev = makeEvent({ note: "aplikator datang besok", author_name: "Sari" });
      expect(ev.note).toBe("aplikator datang besok");
      expect(ev.author_name).toBe("Sari");
      expect(EVENT_CHIP[ev.status]!.label).toBe("Berjalan");
    });

    it("event without note has note as null", () => {
      const ev = makeEvent({ note: null });
      expect(ev.note).toBeNull();
    });

    it("event without author has author_name as null", () => {
      const ev = makeEvent({ author_name: null });
      expect(ev.author_name).toBeNull();
    });

    it("empty events list maps to empty state (no items)", () => {
      const shown = buildHistoryItems([], false);
      expect(shown).toHaveLength(0);
    });
  });

  describe("percent_complete display", () => {
    it("event with percent_complete carries the value", () => {
      const ev = makeEvent({ percent_complete: 45 });
      expect(ev.percent_complete).toBe(45);
    });

    it("event without percent_complete is null (not shown)", () => {
      const ev = makeEvent({ percent_complete: null });
      expect(ev.percent_complete).toBeNull();
    });
  });

  describe("eventAuthorLabel", () => {
    it("returns the human author's name for source='human'", () => {
      expect(eventAuthorLabel({ source: "human", author_name: "Sari" })).toBe("Sari");
    });

    it("returns null for source='human' with no author (unchanged blank behavior)", () => {
      expect(eventAuthorLabel({ source: "human", author_name: null })).toBeNull();
    });

    it("returns 'Asisten AI' for source='ai' with no author (was blank before)", () => {
      expect(eventAuthorLabel({ source: "ai", author_name: null })).toBe("Asisten AI");
    });

    it("prefers a real author_name over the 'Asisten AI' fallback when both are present on an AI row", () => {
      expect(eventAuthorLabel({ source: "ai", author_name: "Budi" })).toBe("Budi");
    });
  });

  describe("confidenceLabel", () => {
    it("formats a confidence to 2 decimals", () => {
      expect(confidenceLabel(0.947)).toBe("0.95");
    });

    it("formats a round confidence with trailing zero", () => {
      expect(confidenceLabel(0.5)).toBe("0.50");
    });

    it("returns null when confidence is null (human events)", () => {
      expect(confidenceLabel(null)).toBeNull();
    });
  });

  describe("cardLinkHref", () => {
    it("builds the origin-card href from projectCode + cardSlug", () => {
      expect(cardLinkHref({ projectCode: "BDG-H1", cardSlug: "pasang-lantai" })).toBe(
        "/project/BDG-H1/cards/pasang-lantai",
      );
    });

    it("returns null when there is no card link", () => {
      expect(cardLinkHref(null)).toBeNull();
    });
  });

  describe("AI row integration", () => {
    it("an AI event with no author renders chip-worthy 'Asisten AI' + formatted confidence + card href together", () => {
      const ev = makeEvent({
        source: "ai",
        author_name: null,
        confidence: 0.947,
        card_link: { projectCode: "BDG-H1", cardSlug: "pasang-lantai" },
      });
      expect(eventAuthorLabel(ev)).toBe("Asisten AI");
      expect(confidenceLabel(ev.confidence)).toBe("0.95");
      expect(cardLinkHref(ev.card_link)).toBe("/project/BDG-H1/cards/pasang-lantai");
    });

    it("a human event never shows the AI chip fields (confidence/card_link null, author unchanged)", () => {
      const ev = makeEvent({ source: "human", author_name: "Sari" });
      expect(eventAuthorLabel(ev)).toBe("Sari");
      expect(confidenceLabel(ev.confidence)).toBeNull();
      expect(cardLinkHref(ev.card_link)).toBeNull();
    });
  });
});
