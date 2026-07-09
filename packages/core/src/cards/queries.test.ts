import { describe, expect, it } from "vitest";
import { getCardComments, getCardWithTimeline } from "./queries";

// ─── getCardComments — author join ───────────────────────────────────────────

/** A mock supabase client whose `card_comments` select resolves to `rows`,
 *  mirroring the chained-builder mock pattern used in members.test.ts. */
function makeCommentsMock(rows: unknown[]) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_c: string, _v: unknown) => ({
          is: (_c2: string, _v2: unknown) => ({
            order: (_c3: string, _opts: unknown) =>
              Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  } as unknown;
}

describe("getCardComments", () => {
  it("returns comments with the joined author", async () => {
    const supabase = makeCommentsMock([
      {
        id: "cm1", card_id: "c1", project_id: "p1", body: "Halo",
        created_by_staff_id: "s1", created_at: "2026-07-01T00:00:00Z",
        edited_at: null, deleted_at: null, mentions: [],
        author: { id: "s1", full_name: "Wilson Harkhono", role: "principal" },
      },
    ]);
    const comments = await getCardComments(
      supabase as Parameters<typeof getCardComments>[0],
      "c1",
    );
    expect(comments).toHaveLength(1);
    expect(comments[0]!.author).toEqual({ id: "s1", full_name: "Wilson Harkhono", role: "principal" });
  });

  it("returns null author when the authoring staff row is gone (FK on delete set null)", async () => {
    const supabase = makeCommentsMock([
      {
        id: "cm1", card_id: "c1", project_id: "p1", body: "Halo",
        created_by_staff_id: null, created_at: "2026-07-01T00:00:00Z",
        edited_at: null, deleted_at: null, mentions: [],
        author: null,
      },
    ]);
    const comments = await getCardComments(
      supabase as Parameters<typeof getCardComments>[0],
      "c1",
    );
    expect(comments[0]!.author).toBeNull();
  });

  it("returns an empty array when there are no comments", async () => {
    const supabase = makeCommentsMock([]);
    const comments = await getCardComments(
      supabase as Parameters<typeof getCardComments>[0],
      "c1",
    );
    expect(comments).toEqual([]);
  });
});

// ─── getCardWithTimeline — logger join ───────────────────────────────────────

function makeTimelineMock(cardRow: unknown, eventRows: unknown[]) {
  return {
    from: (table: string) => {
      if (table === "cards") {
        return {
          select: (_cols: string) => ({
            eq: (_c1: string, _v1: unknown) => ({
              eq: (_c2: string, _v2: unknown) => ({
                maybeSingle: () => Promise.resolve({ data: cardRow, error: null }),
              }),
            }),
          }),
        };
      }
      return {
        select: (_cols: string) => ({
          eq: (_c: string, _v: unknown) => ({
            order: (_c2: string, _opts: unknown) =>
              Promise.resolve({ data: eventRows, error: null }),
          }),
        }),
      };
    },
  } as unknown;
}

describe("getCardWithTimeline", () => {
  it("returns events with the joined logger", async () => {
    const supabase = makeTimelineMock(
      { id: "c1", project_id: "p1", topic_id: "t1", title: "Master bath", slug: "master", status: "active" },
      [
        {
          id: "e1", card_id: "c1", project_id: "p1", event_kind: "decision",
          payload: { topic: "marmer" }, occurred_at: "2026-05-20T14:30:00Z",
          logged_by_staff_id: "s1",
          logger: { id: "s1", full_name: "Tanya Wijaya" },
        },
      ],
    );
    const detail = await getCardWithTimeline(
      supabase as Parameters<typeof getCardWithTimeline>[0],
      "p1",
      "master",
    );
    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]!.logger).toEqual({ id: "s1", full_name: "Tanya Wijaya" });
  });

  it("returns null logger when the logging staff row is gone", async () => {
    const supabase = makeTimelineMock(
      { id: "c1", project_id: "p1", topic_id: "t1", title: "Master bath", slug: "master", status: "active" },
      [
        {
          id: "e1", card_id: "c1", project_id: "p1", event_kind: "note",
          payload: {}, occurred_at: "2026-05-20T14:30:00Z",
          logged_by_staff_id: null,
          logger: null,
        },
      ],
    );
    const detail = await getCardWithTimeline(
      supabase as Parameters<typeof getCardWithTimeline>[0],
      "p1",
      "master",
    );
    expect(detail.events[0]!.logger).toBeNull();
  });
});
