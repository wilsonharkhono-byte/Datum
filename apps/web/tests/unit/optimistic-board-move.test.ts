import { describe, expect, it } from "vitest";
import { applyMoveCard, applyAddCard, type BoardCardView } from "@/lib/cards/optimisticBoard";
import type { Board } from "@/lib/cards/queries";

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

// Surgical rollback (removeCardById): failing mutation A must not clobber the
// still-in-flight ghost from mutation B — the audit's "snapshot rollback race".
import { removeCardById } from "@/lib/cards/optimisticBoard";

describe("removeCardById", () => {
  it("removes only the targeted ghost, preserving a sibling ghost", () => {
    const withA = applyAddCard(board, "t2", "From A", "optimistic:a");
    const withBoth = applyAddCard(withA, "t2", "From B", "optimistic:b");
    const rolledBackA = removeCardById(withBoth, "optimistic:a");
    expect(rolledBackA.columns[1]!.cards.map((c) => c.id)).toEqual(["optimistic:b"]);
  });
  it("returns the board unchanged for an unknown id", () => {
    expect(removeCardById(board, "nope")).toBe(board);
  });
  it("composes with move rollback: moving back only affects the moved card", () => {
    const withGhost = applyAddCard(board, "t2", "Ghost", "optimistic:g");
    const moved = applyMoveCard(withGhost, "c1", "t2");
    // c1's move fails → move it back; the ghost in t2 must survive.
    const rolledBack = applyMoveCard(moved, "c1", "t1");
    expect(rolledBack.columns[0]!.cards.map((c) => c.id)).toEqual(["c1"]);
    expect(rolledBack.columns[1]!.cards.map((c) => c.id)).toEqual(["optimistic:g"]);
  });
});
