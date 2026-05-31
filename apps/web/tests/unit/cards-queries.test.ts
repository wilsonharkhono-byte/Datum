import { describe, expect, it, vi } from "vitest";
import { getBoardForProject, getCardWithTimeline } from "@/lib/cards/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

function fakeClient(map: Record<string, unknown>) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ then: (cb: any) => cb({ data: map[table], error: null }) }),
            single: () => ({ then: (cb: any) => cb({ data: (map[table] as any)?.[0], error: null }) }),
            maybeSingle: () => ({ then: (cb: any) => cb({ data: (map[table] as any)?.[0] ?? null, error: null }) }),
          }),
          order: () => ({ then: (cb: any) => cb({ data: map[table], error: null }) }),
        }),
      };
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getBoardForProject", () => {
  it("returns topics in sort_order with their cards", async () => {
    const supa = fakeClient({
      projects: [{ id: "p1", project_code: "BDG-H1", project_name: "BDG H1", slug: "bdg-h1" }],
      topics: [
        { id: "t1", project_id: "p1", code: "A05", name: "A05 — Kusen", sort_order: 3 },
        { id: "t2", project_id: "p1", code: "A09", name: "A09 — Detail Kamar Mandi", sort_order: 6 },
      ],
      cards: [
        { id: "c1", project_id: "p1", topic_id: "t1", title: "Pintu utama", slug: "pintu", status: "active", last_event_at: "2024-11-05" },
        { id: "c2", project_id: "p1", topic_id: "t2", title: "Master bathroom", slug: "master", status: "active", last_event_at: "2026-05-20" },
      ],
    });
    const board = await getBoardForProject(supa, "bdg-h1");
    expect(board.project.project_code).toBe("BDG-H1");
    expect(board.columns).toHaveLength(2);
    expect(board.columns[0].topic.code).toBe("A05");
    expect(board.columns[0].cards.map((c) => c.slug)).toEqual(["pintu"]);
  });
});

describe("getCardWithTimeline", () => {
  it("returns card + events ordered by occurred_at desc", async () => {
    const supa = fakeClient({
      cards: [{ id: "c1", project_id: "p1", topic_id: "t1", title: "Master bath", slug: "master", status: "active" }],
      card_events: [
        { id: "e1", card_id: "c1", project_id: "p1", event_kind: "decision",
          payload: { topic: "marmer" }, occurred_at: "2026-05-20T14:30:00Z", logged_by_staff_id: "s1" },
      ],
    });
    const detail = await getCardWithTimeline(supa, "p1", "master");
    expect(detail.card.title).toBe("Master bath");
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0].event_kind).toBe("decision");
  });
});
