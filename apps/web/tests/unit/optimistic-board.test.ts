import { describe, expect, it } from "vitest";
import { optimisticReducer } from "@/lib/cards/optimisticBoard";
import type { Board } from "@/lib/cards/queries";

function board(): Board {
  return {
    project: { id: "p1", project_code: "PRJ" } as Board["project"],
    columns: [
      { topic: { id: "t1", name: "Design" } as any, cards: [
        { id: "c1", topic_id: "t1", title: "Existing", slug: "existing", status: "active", labels: [], deadline: null } as any,
      ] },
      { topic: { id: "t2", name: "Build" } as any, cards: [] },
    ],
  };
}

describe("optimisticReducer add-card", () => {
  it("appends an optimistic card to the matching column", () => {
    const next = optimisticReducer(board(), { type: "add-card", topicId: "t2", title: "New room" });
    const col = next.columns.find((c) => c.topic.id === "t2")!;
    expect(col.cards).toHaveLength(1);
    const ghost = col.cards[0]!;
    expect(ghost.title).toBe("New room");
    expect(ghost.status).toBe("active");
    expect(ghost.labels).toEqual([]);
    expect((ghost as any).__optimistic).toBe(true);
  });

  it("preserves existing cards in the target column", () => {
    const next = optimisticReducer(board(), { type: "add-card", topicId: "t1", title: "Second" });
    const col = next.columns.find((c) => c.topic.id === "t1")!;
    expect(col.cards.map((c) => c.title)).toEqual(["Existing", "Second"]);
  });

  it("is a no-op for an unknown topicId", () => {
    const input = board();
    const next = optimisticReducer(input, { type: "add-card", topicId: "nope", title: "X" });
    expect(next.columns.flatMap((c) => c.cards)).toHaveLength(1);
  });

  it("does not mutate the input board", () => {
    const input = board();
    optimisticReducer(input, { type: "add-card", topicId: "t2", title: "New room" });
    expect(input.columns.find((c) => c.topic.id === "t2")!.cards).toHaveLength(0);
  });
});
