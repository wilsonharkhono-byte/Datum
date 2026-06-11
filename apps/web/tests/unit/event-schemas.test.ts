import { describe, expect, it } from "vitest";
import {
  EventPayloadByKind,
  parseEventPayload,
  EVENT_KINDS,
} from "@datum/types";

describe("event-kind schemas", () => {
  it("exports all 9 event kinds", () => {
    expect(EVENT_KINDS).toEqual([
      "decision","drawing","vendor","material","work","client_request","note","photo","document",
    ]);
  });

  it("parses a valid decision payload", () => {
    const payload = {
      topic: "marmer lantai master bath",
      proposed_spec: "Statuario",
      approved_by: "client",
    };
    const parsed = parseEventPayload("decision", payload);
    expect(parsed.topic).toBe("marmer lantai master bath");
    expect(parsed.approved_by).toBe("client");
  });

  it("rejects an invalid vendor payload (missing vendor_name)", () => {
    expect(() =>
      parseEventPayload("vendor", { interaction: "quote" }),
    ).toThrow();
  });

  it("parses a valid vendor payload", () => {
    const parsed = parseEventPayload("vendor", {
      interaction: "quote",
      vendor_name: "PT Galleria",
      amount: 2400000,
      currency: "IDR",
      quote_date: "2026-05-18",
    });
    expect(parsed.vendor_name).toBe("PT Galleria");
    expect(parsed.interaction).toBe("quote");
  });

  it("parses a valid work payload", () => {
    const parsed = parseEventPayload("work", {
      status: "blocked",
      description: "Retak pada dinding utara",
      severity: "high",
    });
    expect(parsed.status).toBe("blocked");
    expect(parsed.severity).toBe("high");
  });

  it("parses a minimal note payload", () => {
    const parsed = parseEventPayload("note", { body: "perlu cek ulang" });
    expect(parsed.body).toBe("perlu cek ulang");
  });

  it("provides a type-safe discriminated union", () => {
    // compile-time check: the union covers all 9 kinds
    // status is required on the parsed (output) type since the lifecycle fix.
    const x: EventPayloadByKind["decision"] = { topic: "x", status: "needs_decision" };
    expect(x.topic).toBe("x");
  });
});
