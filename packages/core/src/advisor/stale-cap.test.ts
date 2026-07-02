import { describe, expect, it } from "vitest";
import { capStaleCards } from "./stale-cap";
import type { AdvisorItem } from "./types";

function item(overrides: Partial<AdvisorItem> = {}): AdvisorItem {
  return {
    type: "blocker",
    score: 80,
    title: "Terblokir: Pekerjaan Lantai",
    href: "/project/ARIN-1/cards/arin-1-flooring",
    projectCode: "ARIN-1",
    ...overrides,
  };
}

function stale(n: number): AdvisorItem {
  return item({ type: "stale_card", score: 30, title: `Tanpa aktivitas: kartu ${n}`, href: `/x/${n}` });
}

describe("capStaleCards", () => {
  it("passes a list with no stale cards through unchanged", () => {
    const items = [item(), item({ type: "decision_needed" })];
    const r = capStaleCards(items, 3);
    expect(r.items).toEqual(items);
    expect(r.hiddenStaleCount).toBe(0);
  });

  it("keeps the first `max` stale cards and reports the hidden count", () => {
    const items = [item(), stale(1), stale(2), stale(3), stale(4), stale(5)];
    const r = capStaleCards(items, 3);
    expect(r.items.filter((i) => i.type === "stale_card")).toHaveLength(3);
    expect(r.hiddenStaleCount).toBe(2);
    // First-ranked stale items survive (rank order = input order).
    expect(r.items.map((i) => i.href)).toEqual([items[0]!.href, "/x/1", "/x/2", "/x/3"]);
  });

  it("never drops non-stale items, even interleaved", () => {
    const blocker = item({ title: "b" });
    const decision = item({ type: "decision_needed", title: "d" });
    const r = capStaleCards([stale(1), blocker, stale(2), stale(3), decision, stale(4)], 2);
    expect(r.items.map((i) => i.title)).toEqual(["Tanpa aktivitas: kartu 1", "b", "Tanpa aktivitas: kartu 2", "d"]);
    expect(r.hiddenStaleCount).toBe(2);
  });

  it("defaults max to 3", () => {
    const r = capStaleCards([stale(1), stale(2), stale(3), stale(4)]);
    expect(r.items).toHaveLength(3);
    expect(r.hiddenStaleCount).toBe(1);
  });

  it("handles empty input and max=0", () => {
    expect(capStaleCards([], 3)).toEqual({ items: [], hiddenStaleCount: 0 });
    const r = capStaleCards([stale(1)], 0);
    expect(r.items).toEqual([]);
    expect(r.hiddenStaleCount).toBe(1);
  });
});
