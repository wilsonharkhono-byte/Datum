import { describe, expect, it } from "vitest";
import { selectUnlinkedActiveCards, BACKFILL_CARD_CAP } from "@/lib/areas/backfill-selection";

describe("selectUnlinkedActiveCards", () => {
  it("keeps only active card ids not present in the linked set", () => {
    const activeCardIds = ["a", "b", "c", "d"];
    const linkedCardIds = new Set(["b", "d"]);
    const out = selectUnlinkedActiveCards(activeCardIds, linkedCardIds);
    expect(out).toEqual({
      selectedIds: ["a", "c"],
      totalUnlinked: 2,
      capped: false,
    });
  });

  it("returns an empty selection when every active card is already linked", () => {
    const out = selectUnlinkedActiveCards(["a", "b"], new Set(["a", "b"]));
    expect(out).toEqual({ selectedIds: [], totalUnlinked: 0, capped: false });
  });

  it("returns an empty selection when there are no active cards", () => {
    const out = selectUnlinkedActiveCards([], new Set());
    expect(out).toEqual({ selectedIds: [], totalUnlinked: 0, capped: false });
  });

  it("preserves input order (assumed most-recently-active first)", () => {
    const out = selectUnlinkedActiveCards(["z", "y", "x"], new Set());
    expect(out.selectedIds).toEqual(["z", "y", "x"]);
  });

  it("caps the selection at BACKFILL_CARD_CAP and reports totalUnlinked uncapped", () => {
    const activeCardIds = Array.from({ length: 150 }, (_, i) => `card-${i}`);
    const out = selectUnlinkedActiveCards(activeCardIds, new Set());
    expect(out.selectedIds).toHaveLength(BACKFILL_CARD_CAP);
    expect(out.selectedIds).toEqual(activeCardIds.slice(0, BACKFILL_CARD_CAP));
    expect(out.totalUnlinked).toBe(150);
    expect(out.capped).toBe(true);
  });

  it("does not cap when unlinked count equals the cap exactly", () => {
    const activeCardIds = Array.from({ length: BACKFILL_CARD_CAP }, (_, i) => `card-${i}`);
    const out = selectUnlinkedActiveCards(activeCardIds, new Set());
    expect(out.selectedIds).toHaveLength(BACKFILL_CARD_CAP);
    expect(out.capped).toBe(false);
  });

  it("ignores linked ids that are not in the active list", () => {
    const out = selectUnlinkedActiveCards(["a", "b"], new Set(["ghost", "b"]));
    expect(out.selectedIds).toEqual(["a"]);
    expect(out.totalUnlinked).toBe(1);
  });
});
