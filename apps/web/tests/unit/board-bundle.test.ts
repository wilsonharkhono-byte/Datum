import { describe, expect, it } from "vitest";
import { mapBoardBundle, type BoardBundle } from "@/lib/cards/queries";

const bundle: BoardBundle = {
  project: { id: "p1", project_code: "BDG-H1", project_name: "BDG H1" } as BoardBundle["project"],
  topics: [
    { id: "t1", code: "A05", name: "A05 — Kusen", sort_order: 3 },
    { id: "t2", code: "A09", name: "A09 — Detail Kamar Mandi", sort_order: 6 },
  ],
  cards: [
    { id: "c1", slug: "pintu", title: "Pintu utama", topic_id: "t1", status: "active",
      last_event_at: "2024-11-05", current_summary: null, properties: null },
    { id: "c2", slug: "master", title: "Master bathroom", topic_id: "t2", status: "active",
      last_event_at: "2026-05-20", current_summary: null, properties: null },
  ],
  loop_events: [
    { id: "e1", card_id: "c2", event_kind: "decision",
      payload: { topic: "marmer", status: "needs_decision", awaiting: "client" },
      occurred_at: "2026-06-01T00:00:00Z", created_at: "2026-06-01T00:00:00Z" },
  ],
  card_areas: [],
  gate_status: [],
};

describe("mapBoardBundle", () => {
  it("groups cards under topics in sort_order", () => {
    const board = mapBoardBundle(bundle, "2026-06-14");
    expect(board.project.project_code).toBe("BDG-H1");
    expect(board.columns.map((c) => c.topic.code)).toEqual(["A05", "A09"]);
    expect(board.columns[0]!.cards.map((c) => c.slug)).toEqual(["pintu"]);
  });

  it("derives open-loop labels and null deadline without area links", () => {
    const board = mapBoardBundle(bundle, "2026-06-14");
    const card = board.columns[1]!.cards[0]!;
    expect(card.labels.map((l) => l.kind)).toEqual(["needs_decision", "awaiting"]);
    expect(card.deadline).toBeNull();
  });
});
