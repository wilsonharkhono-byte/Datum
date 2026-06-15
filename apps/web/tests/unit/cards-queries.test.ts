import { describe, expect, it } from "vitest";
import { getCardWithTimeline } from "@/lib/cards/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

function fakeClient(map: Record<string, unknown>) {
  function chain(table: string): any {
    const data = map[table];
    const builder: any = {
      eq: () => builder,
      gte: () => builder,
      in: () => builder,
      not: () => builder,
      contains: () => builder,
      order: () => Promise.resolve({ data, error: null }),
      single: () => Promise.resolve({ data: (data as any)?.[0], error: null }),
      maybeSingle: () => Promise.resolve({ data: (data as any)?.[0] ?? null, error: null }),
      then: (cb: any) => cb({ data, error: null }),
    };
    return builder;
  }
  return {
    from(table: string) {
      return {
        select: () => chain(table),
      };
    },
  } as unknown as SupabaseClient<Database>;
}

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
    expect(detail.events[0]!.event_kind).toBe("decision");
  });
});
