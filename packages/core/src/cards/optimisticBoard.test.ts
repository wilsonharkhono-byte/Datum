import { describe, expect, it } from "vitest";
import { applyMoveCard, applyAddCard, type BoardCardView } from "./optimisticBoard";
import type { Board } from "./optimisticBoard";

const board: Board = {
  project: { id: "p1", project_code: "BDG-H1", project_name: "BDG H1" } as Board["project"],
  columns: [
    { topic: { id: "t1", code: "A", name: "A", sort_order: 1 } as Board["columns"][number]["topic"],
      cards: [{ id: "c1", slug: "x", title: "X", topic_id: "t1", status: "active", labels: [], deadline: null } as unknown as Board["columns"][number]["cards"][number]] },
    { topic: { id: "t2", code: "B", name: "B", sort_order: 2 } as Board["columns"][number]["topic"], cards: [] },
  ],
};

describe("applyMoveCard", () => {
  it("moves a card to the target column", () => {
    const next = applyMoveCard(board, "c1", "t2");
    expect(next.columns[0]!.cards).toHaveLength(0);
    expect(next.columns[1]!.cards.map((c) => c.id)).toEqual(["c1"]);
  });
  it("returns the board unchanged for an unknown card", () => {
    expect(applyMoveCard(board, "nope", "t2")).toBe(board);
  });
});

describe("applyAddCard", () => {
  it("appends a ghost card to the matching column", () => {
    const next = applyAddCard(board, "t2", "New one");
    const ghost = next.columns[1]!.cards.at(-1)! as BoardCardView;
    expect(ghost.title).toBe("New one");
    expect(ghost.__optimistic).toBe(true);
  });
});
