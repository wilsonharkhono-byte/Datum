import { describe, expect, it } from "vitest";
import { evaluateGate } from "@/lib/gates/readiness-rules";
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

describe("evaluateGate", () => {
  it("returns not_started when there are no events", () => {
    const r = evaluateGate("B", { events: [] });
    expect(r.status).toBe("not_started");
    expect(r.readinessScore).toBe(0);
  });

  it("ignores irrelevant kinds for a gate", () => {
    // For gate B (bathroom), 'photo' is not relevant
    const r = evaluateGate("B", { events: [mockEvent("photo", { caption: "site" })] });
    expect(r.status).toBe("not_started");
  });

  it("returns in_progress with relevant events", () => {
    const r = evaluateGate("B", { events: [mockEvent("material", { item: "marmer", status: "specified" })] });
    expect(r.status).toBe("in_progress");
    expect(r.readinessScore).toBeGreaterThan(0);
    expect(r.readinessScore).toBeLessThan(1);
  });

  it("returns blocked when a pending event exists", () => {
    const r = evaluateGate("B", { events: [
      mockEvent("material", { item: "marmer", status: "specified" }),
      mockEvent("pending", { what: "menunggu approval Wilson" }),
    ]});
    expect(r.status).toBe("blocked");
    expect(r.blockingReason).toContain("Wilson");
  });

  it("returns ready_for_handoff when progress hits 100%", () => {
    const r = evaluateGate("E", { events: [
      mockEvent("progress", { status: "selesai", percent_complete: 100 }),
    ]});
    expect(r.status).toBe("ready_for_handoff");
    expect(r.readinessScore).toBe(1.0);
  });

  it("uses latest pending's 'what' as the blocking reason", () => {
    const r = evaluateGate("H", { events: [
      mockEvent("pending", { what: "tunggu spec" }, "2026-05-10T00:00:00Z"),
      mockEvent("pending", { what: "tunggu approval klien" }, "2026-05-20T00:00:00Z"),
    ]});
    expect(r.blockingReason).toContain("klien");
  });
});
