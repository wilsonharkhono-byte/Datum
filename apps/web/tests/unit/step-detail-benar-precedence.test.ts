/**
 * Tests for two pure helpers in StepDetail.tsx: `hasNewerAiEvent` (the override
 * hint) and `benarNote` (the note sent when a human confirms an AI history row).
 *
 * Mirrored here rather than imported directly — StepDetail.tsx is a "use client"
 * .tsx file and vitest's node-env transform for this suite can't parse JSX (see
 * the same note in step-detail-history.test.ts). Keep these mirrors byte-for-byte
 * in sync with the real implementations in components/schedule/StepDetail.tsx.
 */

import { describe, expect, it } from "vitest";
import type { AreaStepEventRow } from "@/lib/steps/queries";

// --- Mirror of StepDetail.tsx's hasNewerAiEvent ---
function hasNewerAiEvent(events: Pick<AreaStepEventRow, "source" | "occurred_at">[], nowIso: string): boolean {
  return events.some((e) => e.source === "ai" && e.occurred_at > nowIso);
}

// --- Mirror of StepDetail.tsx's benarNote ---
function benarNote(
  ev: Pick<AreaStepEventRow, "status" | "note">,
  currentBlockingReason: string | null,
): string {
  if (ev.status === "blocked") return ev.note ?? currentBlockingReason ?? "Dikonfirmasi";
  return "Dikonfirmasi";
}

function makeEvent(overrides: Partial<AreaStepEventRow> = {}): AreaStepEventRow {
  return {
    id: "ev1",
    area_step_id: "step1",
    status: "in_progress",
    note: "tukang datang besok",
    percent_complete: null,
    occurred_at: "2026-06-20T10:00:00Z",
    author_name: "Budi Santoso",
    source: "human",
    confidence: null,
    card_event_id: null,
    card_link: null,
    ...overrides,
  };
}

describe("hasNewerAiEvent", () => {
  const NOW = "2026-06-20T12:00:00Z";

  it("returns true when a newer AI event exists", () => {
    const events = [makeEvent({ source: "ai", occurred_at: "2026-06-20T13:00:00Z" })];
    expect(hasNewerAiEvent(events, NOW)).toBe(true);
  });

  it("returns false when only an older AI event exists", () => {
    const events = [makeEvent({ source: "ai", occurred_at: "2026-06-20T11:00:00Z" })];
    expect(hasNewerAiEvent(events, NOW)).toBe(false);
  });

  it("returns false when there is no AI event at all", () => {
    const events = [
      makeEvent({ source: "human", occurred_at: "2026-06-20T13:00:00Z" }),
      makeEvent({ source: "human", occurred_at: "2026-06-20T14:00:00Z" }),
    ];
    expect(hasNewerAiEvent(events, NOW)).toBe(false);
  });

  it("returns false on an exact tie (AI event occurred_at equals nowIso — strictly newer required)", () => {
    const events = [makeEvent({ source: "ai", occurred_at: NOW })];
    expect(hasNewerAiEvent(events, NOW)).toBe(false);
  });

  it("returns true when a mix of older and newer AI events exists (at least one qualifies)", () => {
    const events = [
      makeEvent({ id: "e1", source: "ai", occurred_at: "2026-06-20T09:00:00Z" }),
      makeEvent({ id: "e2", source: "ai", occurred_at: "2026-06-20T13:30:00Z" }),
    ];
    expect(hasNewerAiEvent(events, NOW)).toBe(true);
  });

  it("returns false for an empty events list", () => {
    expect(hasNewerAiEvent([], NOW)).toBe(false);
  });
});

describe("benarNote", () => {
  it("blocked row with its own note: carries that note forward", () => {
    const ev = makeEvent({ status: "blocked", note: "menunggu material keramik" });
    expect(benarNote(ev, "alasan lama di step")).toBe("menunggu material keramik");
  });

  it("blocked row with a null note: falls back to the step's current blocking_reason", () => {
    const ev = makeEvent({ status: "blocked", note: null });
    expect(benarNote(ev, "menunggu tukang listrik")).toBe("menunggu tukang listrik");
  });

  it("blocked row with a null note and no current blocking_reason: falls back to 'Dikonfirmasi'", () => {
    const ev = makeEvent({ status: "blocked", note: null });
    expect(benarNote(ev, null)).toBe("Dikonfirmasi");
  });

  it("non-blocked row: always 'Dikonfirmasi', regardless of the event's own note", () => {
    const ev = makeEvent({ status: "in_progress", note: "some progress note" });
    expect(benarNote(ev, "irrelevant blocking reason")).toBe("Dikonfirmasi");
  });

  it("non-blocked row with a null note: still 'Dikonfirmasi'", () => {
    const ev = makeEvent({ status: "done", note: null });
    expect(benarNote(ev, null)).toBe("Dikonfirmasi");
  });
});
