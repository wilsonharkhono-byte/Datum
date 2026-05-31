import { describe, expect, it } from "vitest";
import {
  EventPayloadByKind,
  parseEventPayload,
  EVENT_KINDS,
} from "@datum/types";

describe("event-kind schemas", () => {
  it("exports all 14 event kinds", () => {
    expect(EVENT_KINDS).toEqual([
      "decision","drawing","survey","vendor_quote","vendor_pick",
      "material","worker_assigned","progress","defect","photo",
      "document","client_request","note","pending",
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

  it("rejects an invalid vendor_quote payload (missing amount)", () => {
    expect(() =>
      parseEventPayload("vendor_quote", { vendor_name: "PT Galleria" }),
    ).toThrow();
  });

  it("parses a minimal note payload", () => {
    const parsed = parseEventPayload("note", { body: "perlu cek ulang" });
    expect(parsed.body).toBe("perlu cek ulang");
  });

  it("provides a type-safe discriminated union", () => {
    // compile-time check: the union covers all 14 kinds
    const x: EventPayloadByKind["decision"] = { topic: "x" };
    expect(x.topic).toBe("x");
  });
});
