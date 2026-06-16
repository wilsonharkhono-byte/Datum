import { describe, expect, it } from "vitest";
import { buildContextBlock, type CardWithEvents } from "@/lib/assistant/retrieval";

describe("buildContextBlock", () => {
  const cards: CardWithEvents[] = [
    {
      card: {
        id: "c1", project_id: "p1", topic_id: "t1", title: "Master bathroom",
        slug: "master-bathroom", status: "active",
        current_summary: "Marmer Statuario disetujui",
        properties: {}, created_by_staff_id: "s1",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-05-20T14:30:00Z",
        last_event_at: "2026-05-22T08:00:00Z",
      },
      topicName: "A09 — Detail Kamar Mandi",
      events: [
        { id: "e1", card_id: "c1", project_id: "p1", event_kind: "decision",
          payload: { topic: "marmer", proposed_spec: "Statuario", approved_by: "client" },
          occurred_at: "2026-05-20T14:30:00Z", logged_by_staff_id: "s1",
          source_kind: "manual", source_id: null, cost_visible: false,
          draft_id: null, created_at: "2026-05-20T14:30:00Z", search_text: null },
      ],
    },
  ];

  it("renders cards with id-prefixed citation tokens", () => {
    const ctx = buildContextBlock(cards);
    expect(ctx).toContain("[card:c1]");
    expect(ctx).toContain("Master bathroom");
    expect(ctx).toContain("[event:e1]");
    expect(ctx).toContain("Statuario");
  });

  it("renders an empty marker when there are no cards", () => {
    expect(buildContextBlock([])).toContain("Tidak ada kartu");
  });
});

describe("buildContextBlock with attachment captions", () => {
  it("renders Lampiran lines for an event's captions", () => {
    const withCaptions: CardWithEvents[] = [
      {
        card: {
          id: "c1", project_id: "p1", topic_id: "t1", title: "Master bath",
          slug: "master-bath", status: "active", current_summary: null,
          properties: {}, created_by_staff_id: "s1",
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          last_event_at: "2026-01-01T00:00:00Z",
        },
        topicName: "A09",
        events: [
          {
            id: "e1", card_id: "c1", project_id: "p1", event_kind: "photo",
            payload: { caption: "sample" }, occurred_at: "2026-01-01T00:00:00Z",
            logged_by_staff_id: "s1", source_kind: "manual", source_id: null,
            cost_visible: false, draft_id: null, created_at: "2026-01-01T00:00:00Z",
            search_text: null,
          },
        ],
        captionsByEventId: { e1: ["Marmer Statuario finish polish"] },
      },
    ];
    const ctx = buildContextBlock(withCaptions);
    expect(ctx).toContain("Lampiran:");
    expect(ctx).toContain("Marmer Statuario");
  });
});
