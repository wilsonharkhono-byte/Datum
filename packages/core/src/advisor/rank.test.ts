import { describe, expect, it } from "vitest";
import { ageLabelFor, dueLabelFor, rankAdvisorItems, scoreItem } from "./rank";
import type { AdvisorSignal, AdvisorItemType } from "./types";

const NOW = new Date("2026-06-12T08:00:00Z");

function signal(type: AdvisorItemType, extra: Partial<AdvisorSignal> = {}): AdvisorSignal {
  return {
    type,
    title: `item ${type}`,
    href: "/project/BDG-H1/schedule",
    projectCode: "BDG-H1",
    ...extra,
  };
}

describe("scoreItem", () => {
  it("scores gate_overdue at 100 plus 2 per day overdue, capped at +50", () => {
    expect(scoreItem(signal("gate_overdue", { dueDate: "2026-06-12" }), NOW)).toBe(100);
    expect(scoreItem(signal("gate_overdue", { dueDate: "2026-06-07" }), NOW)).toBe(110); // 5 days
    expect(scoreItem(signal("gate_overdue", { dueDate: "2025-01-01" }), NOW)).toBe(150); // capped
  });

  it("scores blockers at 80 plus age in days, capped at +20", () => {
    expect(scoreItem(signal("blocker", { occurredAt: "2026-06-12T07:00:00Z" }), NOW)).toBe(80);
    expect(scoreItem(signal("blocker", { occurredAt: "2026-06-02T08:00:00Z" }), NOW)).toBe(90); // 10 days
    expect(scoreItem(signal("blocker", { occurredAt: "2025-06-12T08:00:00Z" }), NOW)).toBe(100); // capped
  });

  it("scores cascade_risk flat 75 and stale_card flat 30", () => {
    expect(scoreItem(signal("cascade_risk"), NOW)).toBe(75);
    expect(scoreItem(signal("stale_card", { occurredAt: "2026-01-01T00:00:00Z" }), NOW)).toBe(30);
  });

  it("boosts decision_needed by +20 only when its deadline is ≤3 days away", () => {
    expect(scoreItem(signal("decision_needed"), NOW)).toBe(70);
    expect(scoreItem(signal("decision_needed", { dueDate: "2026-06-20" }), NOW)).toBe(70);
    expect(scoreItem(signal("decision_needed", { dueDate: "2026-06-14" }), NOW)).toBe(90);
    expect(scoreItem(signal("decision_needed", { dueDate: "2026-06-10" }), NOW)).toBe(90); // already past
  });

  it("scores awaiting_client at 60 plus age/2, capped at +15", () => {
    expect(scoreItem(signal("awaiting_client", { occurredAt: "2026-06-12T07:00:00Z" }), NOW)).toBe(60);
    expect(scoreItem(signal("awaiting_client", { occurredAt: "2026-06-02T08:00:00Z" }), NOW)).toBe(65); // 10d → +5
    expect(scoreItem(signal("awaiting_client", { occurredAt: "2025-06-12T08:00:00Z" }), NOW)).toBe(75); // capped
  });

  it("scores quote_expiring 50..85 with closer expiry scoring higher (clamped 0..7)", () => {
    expect(scoreItem(signal("quote_expiring", { dueDate: "2026-06-19" }), NOW)).toBe(50); // 7 left
    expect(scoreItem(signal("quote_expiring", { dueDate: "2026-06-14" }), NOW)).toBe(75); // 2 left
    expect(scoreItem(signal("quote_expiring", { dueDate: "2026-06-12" }), NOW)).toBe(85); // today
    expect(scoreItem(signal("quote_expiring", { dueDate: "2026-06-01" }), NOW)).toBe(85); // expired clamps to 0
  });

  it("scores gate_soon 45..73 with closer deadline scoring higher", () => {
    expect(scoreItem(signal("gate_soon", { dueDate: "2026-06-19" }), NOW)).toBe(45); // 7 left
    expect(scoreItem(signal("gate_soon", { dueDate: "2026-06-15" }), NOW)).toBe(61); // 3 left
    expect(scoreItem(signal("gate_soon", { dueDate: "2026-06-12" }), NOW)).toBe(73); // today
  });

  it("scores gate_ready a flat 52 (opportunity, not emergency)", () => {
    expect(scoreItem(signal("gate_ready"), NOW)).toBe(52);
  });
});

describe("rankAdvisorItems", () => {
  it("orders the baseline types by severity", () => {
    const ranked = rankAdvisorItems(
      [
        signal("stale_card"),
        signal("awaiting_client", { occurredAt: NOW.toISOString() }),
        signal("gate_overdue", { dueDate: "2026-06-11" }),
        signal("decision_needed"),
        signal("cascade_risk"),
        signal("blocker", { occurredAt: NOW.toISOString() }),
        signal("quote_expiring", { dueDate: "2026-06-19" }),
        signal("gate_soon", { dueDate: "2026-06-19" }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.type)).toEqual([
      "gate_overdue",   // 102
      "blocker",        // 80
      "cascade_risk",   // 75
      "decision_needed",// 70
      "awaiting_client",// 60
      "quote_expiring", // 50
      "gate_soon",      // 45
      "stale_card",     // 30
    ]);
  });

  it("lets a long-overdue gate dominate everything else", () => {
    const ranked = rankAdvisorItems(
      [
        signal("blocker", { occurredAt: "2025-01-01T00:00:00Z" }), // maxed: 100
        signal("gate_overdue", { dueDate: "2026-06-07" }),         // 110
      ],
      NOW,
    );
    expect(ranked[0]!.type).toBe("gate_overdue");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("ranks gate_ready below blockers/overdue but above gate_soon and stale_card", () => {
    const ranked = rankAdvisorItems(
      [
        signal("stale_card"),                              // 30
        signal("gate_soon", { dueDate: "2026-06-19" }),    // 45
        signal("gate_ready"),                              // 52
        signal("schedule_rot"),                            // 55
        signal("blocker", { occurredAt: NOW.toISOString() }), // 80
        signal("gate_overdue", { dueDate: "2026-06-11" }), // 102
      ],
      NOW,
    );
    expect(ranked.map((r) => r.type)).toEqual([
      "gate_overdue",
      "blocker",
      "schedule_rot",
      "gate_ready",
      "gate_soon",
      "stale_card",
    ]);
  });

  it("lifts a deadline-boosted decision above blockers", () => {
    const ranked = rankAdvisorItems(
      [
        signal("blocker", { occurredAt: "2026-06-08T08:00:00Z" }), // 84
        signal("decision_needed", { dueDate: "2026-06-13" }),      // 90
      ],
      NOW,
    );
    expect(ranked[0]!.type).toBe("decision_needed");
  });

  it("caps the list at the limit (default 10) after sorting", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      signal(i === 14 ? "gate_overdue" : "stale_card", i === 14 ? { dueDate: "2026-06-01" } : {}),
    );
    const top10 = rankAdvisorItems(many, NOW);
    expect(top10).toHaveLength(10);
    expect(top10[0]!.type).toBe("gate_overdue"); // sorted before capping

    expect(rankAdvisorItems(many, NOW, 3)).toHaveLength(3);
  });

  it("keeps input order for ties (stable sort) and handles empty input", () => {
    const ranked = rankAdvisorItems(
      [
        signal("cascade_risk", { title: "pertama" }),
        signal("cascade_risk", { title: "kedua" }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.title)).toEqual(["pertama", "kedua"]);

    expect(rankAdvisorItems([], NOW)).toEqual([]);
  });

  it("attaches the computed score and strips the raw time anchors", () => {
    const [item] = rankAdvisorItems([signal("gate_overdue", { dueDate: "2026-06-07" })], NOW);
    expect(item!.score).toBe(110);
    expect(item).not.toHaveProperty("dueDate");
    expect(item).not.toHaveProperty("occurredAt");
  });
});

describe("label helpers", () => {
  it("dueLabelFor renders overdue / today / upcoming in Bahasa", () => {
    expect(dueLabelFor("2026-06-07", NOW)).toBe("lewat 5 hari");
    expect(dueLabelFor("2026-06-12", NOW)).toBe("hari ini");
    expect(dueLabelFor("2026-06-15", NOW)).toBe("3 hari lagi");
  });

  it("ageLabelFor renders day and month ages", () => {
    expect(ageLabelFor(NOW.toISOString(), NOW)).toBe("hari ini");
    expect(ageLabelFor("2026-06-11T08:00:00Z", NOW)).toBe("1 hari");
    expect(ageLabelFor("2026-04-01T08:00:00Z", NOW)).toBe("2 bulan");
  });
});
