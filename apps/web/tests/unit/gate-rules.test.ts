import { describe, expect, it } from "vitest";
import { evaluateGate, RULE_VERSION } from "@/lib/gates/readiness-rules";
import type { CardEvent } from "@datum/db";

function mockEvent(kind: string, payload: Record<string, unknown> = {}, occurredAt = "2026-05-20T00:00:00Z"): CardEvent {
  return {
    id: crypto.randomUUID(),
    card_id: "c1",
    project_id: "p1",
    event_kind: kind as CardEvent["event_kind"],
    payload: payload as never,
    occurred_at: occurredAt,
    logged_by_staff_id: null,
    source_kind: "manual",
    source_id: null,
    cost_visible: false,
    draft_id: null,
    created_at: occurredAt,
  };
}

describe("evaluateGate (rule version 2)", () => {
  it("bumped the rule version", () => {
    expect(RULE_VERSION).toBe(2);
  });

  it("returns not_started when there are no events", () => {
    const r = evaluateGate("B", { events: [] });
    expect(r.status).toBe("not_started");
    expect(r.readinessScore).toBe(0);
  });

  it("ignores irrelevant kinds for a gate", () => {
    // For gate B (Kamar Mandi), 'photo' is not relevant
    const r = evaluateGate("B", { events: [mockEvent("photo", { caption: "site" })] });
    expect(r.status).toBe("not_started");
  });

  it("counts active kinds for every gate — G advances on work events", () => {
    const r = evaluateGate("G", { events: [mockEvent("work", { status: "in_progress" })] });
    expect(r.status).toBe("in_progress");
  });

  it("returns in_progress with relevant evidence", () => {
    const r = evaluateGate("B", { events: [mockEvent("material", { item: "marmer", status: "specified" })] });
    expect(r.status).toBe("in_progress");
    expect(r.readinessScore).toBeGreaterThan(0);
    expect(r.readinessScore).toBeLessThan(1);
  });

  it("returns blocked when the latest work event is blocked", () => {
    const r = evaluateGate("B", { events: [
      mockEvent("material", { item: "marmer", status: "specified" }),
      mockEvent("work", { status: "blocked", description: "menunggu approval Wilson" }),
    ]});
    expect(r.status).toBe("blocked");
    expect(r.blockingReason).toContain("Wilson");
  });

  it("prefers blocked_on over description as the blocking reason", () => {
    const r = evaluateGate("A", { events: [
      mockEvent("work", { status: "blocked", blocked_on: "PLN belum sambung listrik", description: "rough-in lt 2" }),
    ]});
    expect(r.status).toBe("blocked");
    expect(r.blockingReason).toBe("PLN belum sambung listrik");
  });

  it("a later non-blocked work event supersedes an older blocker", () => {
    const r = evaluateGate("A", { events: [
      mockEvent("work", { status: "blocked", description: "tunggu material" }, "2026-05-10T00:00:00Z"),
      mockEvent("work", { status: "in_progress" }, "2026-05-20T00:00:00Z"),
    ]});
    expect(r.status).toBe("in_progress");
  });

  it("returns ready_for_handoff when the latest work event is done", () => {
    const r = evaluateGate("E", { events: [mockEvent("work", { status: "done" })] });
    expect(r.status).toBe("ready_for_handoff");
    expect(r.readinessScore).toBe(1.0);
  });

  it("returns ready_for_handoff when the latest work event hits 100%", () => {
    const r = evaluateGate("E", { events: [
      mockEvent("work", { status: "in_progress", percent_complete: 100 }),
    ]});
    expect(r.status).toBe("ready_for_handoff");
  });

  it("a later blocked event supersedes an older done event", () => {
    const r = evaluateGate("E", { events: [
      mockEvent("work", { status: "done" }, "2026-05-10T00:00:00Z"),
      mockEvent("work", { status: "blocked", description: "defect cat mengelupas" }, "2026-05-20T00:00:00Z"),
    ]});
    expect(r.status).toBe("blocked");
  });
});
