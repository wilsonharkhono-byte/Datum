import { describe, expect, it } from "vitest";
import {
  parseEventPayload,
  isDecisionOpen,
  isClientRequestOpen,
} from "@datum/types";

describe("decision lifecycle", () => {
  it("accepts status and awaiting", () => {
    const p = parseEventPayload("decision", {
      topic: "marmer master bath",
      status: "needs_decision",
      awaiting: "client",
    });
    expect(p.status).toBe("needs_decision");
    expect(p.awaiting).toBe("client");
  });

  it("rejects unknown status / awaiting values", () => {
    expect(() => parseEventPayload("decision", { topic: "x", status: "maybe" })).toThrow();
    expect(() => parseEventPayload("decision", { topic: "x", awaiting: "mandor" })).toThrow();
  });

  it("isDecisionOpen: explicit status wins, else falls back to approved_by", () => {
    expect(isDecisionOpen({ status: "needs_decision" })).toBe(true);
    expect(isDecisionOpen({ status: "decided" })).toBe(false);
    expect(isDecisionOpen({ status: "superseded" })).toBe(false);
    // Legacy payloads without status:
    expect(isDecisionOpen({ approved_by: "client" })).toBe(false);
    expect(isDecisionOpen({})).toBe(true);
  });
});

describe("lifecycle status defaults", () => {
  it("defaults status on parse: open decision unless approved, open request", () => {
    expect(parseEventPayload("decision", { topic: "x" }).status).toBe("needs_decision");
    expect(parseEventPayload("decision", { topic: "x", approved_by: "client" }).status).toBe("decided");
    expect(parseEventPayload("client_request", { request_text: "y" }).status).toBe("open");
  });
});

describe("client_request lifecycle", () => {
  it("accepts open/answered status", () => {
    const p = parseEventPayload("client_request", { request_text: "ubah warna kusen", status: "open" });
    expect(p.status).toBe("open");
  });

  it("isClientRequestOpen treats missing status as open", () => {
    expect(isClientRequestOpen({})).toBe(true);
    expect(isClientRequestOpen({ status: "open" })).toBe(true);
    expect(isClientRequestOpen({ status: "answered" })).toBe(false);
  });
});

describe("work blocker/defect fields", () => {
  it("accepts blocked_on, issue and fix_required_by", () => {
    const p = parseEventPayload("work", {
      status: "blocked",
      blocked_on: "menunggu keputusan klien soal granit",
      issue: "defect",
      severity: "high",
      fix_required_by: "2026-07-01",
    });
    expect(p.blocked_on).toContain("granit");
    expect(p.issue).toBe("defect");
  });

  it("rejects unknown issue values", () => {
    expect(() => parseEventPayload("work", { status: "blocked", issue: "rework" })).toThrow();
  });
});
