import { describe, expect, it } from "vitest";
import {
  groupPulseEvents,
  mapStepEventRow,
  mapCardEventRow,
  summarizePulseCardEvent,
  type PulseEvent,
} from "./pulse";

function stepEvent(overrides: Partial<PulseEvent> = {}): PulseEvent {
  return {
    id: "se_1",
    occurredAt: "2026-07-02T10:00:00Z",
    kind: "step",
    projectCode: "ARIN-1",
    projectName: "Karawang Unit 1",
    roomOrCardLabel: "Kamar Mandi Lt.2",
    detail: "Waterproofing — done (80%)",
    source: "human",
    href: "/project/ARIN-1/rooms",
    ...overrides,
  };
}

function cardEvent(overrides: Partial<PulseEvent> = {}): PulseEvent {
  return {
    id: "ce_1",
    occurredAt: "2026-07-02T09:00:00Z",
    kind: "card",
    projectCode: "ARIN-1",
    projectName: "Karawang Unit 1",
    roomOrCardLabel: "Pekerjaan Lantai",
    detail: "Material belum tiba",
    source: "human",
    href: "/project/ARIN-1/cards/arin-1-flooring",
    ...overrides,
  };
}

describe("groupPulseEvents", () => {
  it("groups events by project then by room/card, newest event first within a group", () => {
    const groups = groupPulseEvents([
      stepEvent({ id: "a", occurredAt: "2026-07-02T08:00:00Z" }),
      stepEvent({ id: "b", occurredAt: "2026-07-02T10:00:00Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.projectCode).toBe("ARIN-1");
    expect(groups[0]!.rooms).toHaveLength(1);
    expect(groups[0]!.rooms[0]!.events.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("separates rooms/cards within the same project", () => {
    const groups = groupPulseEvents([
      stepEvent({ id: "a", roomOrCardLabel: "Kamar Mandi Lt.2" }),
      cardEvent({ id: "b", roomOrCardLabel: "Pekerjaan Lantai" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rooms.map((r) => r.label).sort()).toEqual([
      "Kamar Mandi Lt.2",
      "Pekerjaan Lantai",
    ]);
  });

  it("separates projects into distinct groups, ordered by most-recent activity first", () => {
    const groups = groupPulseEvents([
      stepEvent({ id: "a", projectCode: "ARIN-1", occurredAt: "2026-07-01T08:00:00Z" }),
      stepEvent({ id: "b", projectCode: "BETA-2", occurredAt: "2026-07-02T08:00:00Z" }),
    ]);
    expect(groups.map((g) => g.projectCode)).toEqual(["BETA-2", "ARIN-1"]);
  });

  it("caps total rows across all groups to the given max, keeping the newest overall", () => {
    const events: PulseEvent[] = [];
    for (let i = 0; i < 15; i++) {
      events.push(
        stepEvent({
          id: `e${i}`,
          occurredAt: `2026-07-02T${String(i).padStart(2, "0")}:00:00Z`,
        }),
      );
    }
    const groups = groupPulseEvents(events, 10);
    const total = groups.reduce((n, g) => n + g.rooms.reduce((m, r) => m + r.events.length, 0), 0);
    expect(total).toBe(10);
    // Newest events (highest hour) must be the ones kept.
    const keptIds = groups.flatMap((g) => g.rooms.flatMap((r) => r.events.map((e) => e.id)));
    expect(keptIds).toContain("e14");
    expect(keptIds).not.toContain("e0");
  });

  it("defaults the cap to 10 when not given", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      stepEvent({ id: `e${i}`, occurredAt: `2026-07-02T${String(i % 20).padStart(2, "0")}:00:00Z` }),
    );
    const groups = groupPulseEvents(events);
    const total = groups.reduce((n, g) => n + g.rooms.reduce((m, r) => m + r.events.length, 0), 0);
    expect(total).toBe(10);
  });

  it("marks AI-attributed rows via source === 'ai'", () => {
    const groups = groupPulseEvents([
      stepEvent({ id: "a", source: "ai", confidence: 0.95, cardLink: { projectCode: "ARIN-1", cardSlug: "arin-1-mbr" } }),
    ]);
    const ev = groups[0]!.rooms[0]!.events[0]!;
    expect(ev.source).toBe("ai");
    expect(ev.confidence).toBe(0.95);
    expect(ev.cardLink).toEqual({ projectCode: "ARIN-1", cardSlug: "arin-1-mbr" });
  });

  it("returns an empty array for no events", () => {
    expect(groupPulseEvents([])).toEqual([]);
  });

  it("drops empty rooms/projects entirely rather than rendering blank groups", () => {
    const groups = groupPulseEvents([stepEvent({ id: "a" })], 0);
    expect(groups).toEqual([]);
  });
});

// ─── Mappers ─────────────────────────────────────────────────────────────────

const RAW_STEP = {
  id: "se1",
  status: "in_progress",
  note: null as string | null,
  percent_complete: 80 as number | null,
  occurred_at: "2026-07-02T03:30:00Z" as string | null,
  created_at: "2026-07-02T03:31:00Z",
  source: "human" as string | null | undefined,
  confidence: null as number | null | undefined,
  area_steps: {
    step_code: "BW2",
    areas: { area_name: "Kamar Mandi Lt.2" },
    trade_steps: { name: "Waterproofing" },
  } as { step_code: string; areas: { area_name: string } | null; trade_steps: { name: string } | null } | null,
  projects: { project_code: "ARIN-1", project_name: "Karawang Unit 1" } as {
    project_code: string;
    project_name: string;
  } | null,
  card_events: null as {
    card_id: string;
    cards: { slug: string; projects: { project_code: string } | null } | null;
  } | null,
};

describe("mapStepEventRow", () => {
  it("maps an in-progress step with percent (the live waterproofing-80% case)", () => {
    const ev = mapStepEventRow(RAW_STEP)!;
    expect(ev.kind).toBe("step");
    expect(ev.roomOrCardLabel).toBe("Kamar Mandi Lt.2");
    expect(ev.detail).toBe("Waterproofing — sedang berjalan (80%)");
    expect(ev.href).toBe("/project/ARIN-1/rooms");
    expect(ev.source).toBe("human");
    expect(ev.occurredAt).toBe("2026-07-02T03:30:00Z");
  });

  it("labels done/blocked statuses in Bahasa", () => {
    expect(mapStepEventRow({ ...RAW_STEP, status: "done", percent_complete: null })!.detail)
      .toBe("Waterproofing — selesai");
    expect(mapStepEventRow({ ...RAW_STEP, status: "blocked", percent_complete: null })!.detail)
      .toBe("Waterproofing — terblokir");
  });

  it("marks AI rows with source/confidence/cardLink", () => {
    const ev = mapStepEventRow({
      ...RAW_STEP,
      source: "ai",
      confidence: 0.95,
      card_events: {
        card_id: "c1",
        cards: { slug: "arin-1-mbr", projects: { project_code: "ARIN-1" } },
      },
    })!;
    expect(ev.source).toBe("ai");
    expect(ev.confidence).toBe(0.95);
    expect(ev.cardLink).toEqual({ projectCode: "ARIN-1", cardSlug: "arin-1-mbr" });
  });

  it("treats a missing source column (pre-push degrade select) as human", () => {
    const ev = mapStepEventRow({ ...RAW_STEP, source: undefined, confidence: undefined })!;
    expect(ev.source).toBe("human");
    expect(ev.confidence).toBeNull();
  });

  it("falls back: step name → step_code, area → '—', occurred_at → created_at", () => {
    const ev = mapStepEventRow({
      ...RAW_STEP,
      occurred_at: null,
      area_steps: { step_code: "BW2", areas: null, trade_steps: null },
    })!;
    expect(ev.detail.startsWith("BW2")).toBe(true);
    expect(ev.roomOrCardLabel).toBe("—");
    expect(ev.occurredAt).toBe("2026-07-02T03:31:00Z");
  });

  it("returns null when the project join is missing (unattributable row)", () => {
    expect(mapStepEventRow({ ...RAW_STEP, projects: null })).toBeNull();
  });
});

const RAW_CARD = {
  id: "ce1",
  event_kind: "note",
  payload: { body: "Koordinasi dengan arsitek besok pagi" } as Record<string, unknown> | null,
  occurred_at: "2026-07-02T04:00:00Z" as string | null,
  created_at: "2026-07-02T04:01:00Z",
  cards: {
    slug: "arin-1-kusen",
    title: "Kusen Master Bedroom",
    projects: { project_code: "ARIN-1", project_name: "Karawang Unit 1" },
  } as {
    slug: string;
    title: string;
    projects: { project_code: string; project_name: string } | null;
  } | null,
};

describe("mapCardEventRow", () => {
  it("maps a card event with title as the group label and a card href", () => {
    const ev = mapCardEventRow(RAW_CARD)!;
    expect(ev.kind).toBe("card");
    expect(ev.roomOrCardLabel).toBe("Kusen Master Bedroom");
    expect(ev.detail).toBe("Koordinasi dengan arsitek besok pagi");
    expect(ev.href).toBe("/project/ARIN-1/cards/arin-1-kusen");
    expect(ev.source).toBe("human");
  });

  it("returns null when card/project joins are missing", () => {
    expect(mapCardEventRow({ ...RAW_CARD, cards: null })).toBeNull();
    expect(mapCardEventRow({ ...RAW_CARD, cards: { ...RAW_CARD.cards!, projects: null } })).toBeNull();
  });

  it("survives a null payload", () => {
    const ev = mapCardEventRow({ ...RAW_CARD, payload: null })!;
    expect(typeof ev.detail).toBe("string");
  });
});

describe("summarizePulseCardEvent", () => {
  it("labels blocked work events", () => {
    expect(summarizePulseCardEvent("work", { status: "blocked", blocked_on: "material telat" }))
      .toBe("Terblokir: material telat");
  });

  it("labels decisions and client requests", () => {
    expect(summarizePulseCardEvent("decision", { topic: "Marmer lantai" })).toBe("Keputusan: Marmer lantai");
    expect(summarizePulseCardEvent("client_request", { request_text: "Ganti warna cat" }))
      .toBe("Permintaan klien: Ganti warna cat");
  });

  it("truncates unknown kinds' JSON fallback to 100 chars", () => {
    const out = summarizePulseCardEvent("unknown", { blob: "x".repeat(500) });
    expect(out.length).toBeLessThanOrEqual(100);
  });
});
