import { describe, expect, it } from "vitest";
import { computeCardLabels, type LabelEvent } from "@/lib/cards/labels";
import type { Card } from "@datum/db";

function card(status: Card["status"]): Card {
  return {
    id: "c1", project_id: "p1", topic_id: "t1",
    title: "Master bathroom", slug: "master", status,
    current_summary: null, properties: null,
    created_by_staff_id: null, created_at: "2026-01-01", updated_at: "2026-01-01",
    last_event_at: null,
  } as Card;
}

function ev(kind: string, payload: Record<string, unknown>, occurredAt = "2026-06-01T00:00:00Z"): LabelEvent {
  return { event_kind: kind, payload, occurred_at: occurredAt };
}

describe("computeCardLabels v2", () => {
  it("closed → Selesai only; dormant → Tertunda only", () => {
    expect(computeCardLabels(card("closed"), [ev("decision", { status: "needs_decision" })]))
      .toEqual([{ kind: "done", label: "Selesai" }]);
    expect(computeCardLabels(card("dormant"), []))
      .toEqual([{ kind: "pending", label: "Tertunda" }]);
  });

  it("active card with no open loops gets no chips", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { status: "decided" }),
      ev("client_request", { status: "answered" }),
      ev("work", { status: "in_progress" }),
      ev("photo", {}),
    ]);
    expect(labels).toEqual([]);
  });

  it("open decision → Butuh keputusan + Menunggu actor", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { status: "needs_decision", awaiting: "client" }),
    ]);
    expect(labels).toEqual([
      { kind: "needs_decision", label: "Butuh keputusan" },
      { kind: "awaiting", label: "Menunggu Klien" },
    ]);
  });

  it("legacy decision without status but with approved_by counts as closed", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { topic: "marmer", approved_by: "client" }),
    ]);
    expect(labels).toEqual([]);
  });

  it("latest blocked work → Terblokir; superseded blocker does not label", () => {
    expect(computeCardLabels(card("active"), [
      ev("work", { status: "blocked", blocked_on: "tunggu PLN" }),
    ])).toEqual([{ kind: "blocked", label: "Terblokir" }]);

    expect(computeCardLabels(card("active"), [
      ev("work", { status: "blocked" }, "2026-05-01T00:00:00Z"),
      ev("work", { status: "in_progress" }, "2026-06-01T00:00:00Z"),
    ])).toEqual([]);
  });

  it("same-day tie resolves by created_at (blocker cleared)", () => {
    const labels = computeCardLabels(card("active"), [
      { event_kind: "work", payload: { status: "blocked" }, occurred_at: "2026-06-01T00:00:00Z", created_at: "2026-06-01T08:00:00Z", id: "e1" },
      { event_kind: "work", payload: { status: "in_progress" }, occurred_at: "2026-06-01T00:00:00Z", created_at: "2026-06-01T09:00:00Z", id: "e2" },
    ]);
    expect(labels).toEqual([]);
  });

  it("open client_request → Menunggu Klien (deduped against decision-awaiting-client)", () => {
    const labels = computeCardLabels(card("active"), [
      ev("decision", { status: "needs_decision", awaiting: "client" }),
      ev("client_request", { request_text: "ubah warna", status: "open" }),
    ]);
    expect(labels.filter((l) => l.label === "Menunggu Klien")).toHaveLength(1);
  });

  it("caps at 3 chips, blocked first", () => {
    const labels = computeCardLabels(card("active"), [
      ev("work", { status: "blocked" }),
      ev("decision", { status: "needs_decision", awaiting: "vendor" }),
      ev("client_request", { status: "open" }),
    ]);
    expect(labels).toHaveLength(3);
    expect(labels[0]!.kind).toBe("blocked");
  });
});
