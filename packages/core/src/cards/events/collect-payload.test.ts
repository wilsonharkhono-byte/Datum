import { describe, expect, it } from "vitest";
import { collectPayloadFromEntries, collectPayload } from "./collect-payload";

// ─── collectPayloadFromEntries ────────────────────────────────────────────────

describe("collectPayloadFromEntries", () => {
  it("extracts payload_* fields and ignores others", () => {
    const entries: [string, string][] = [
      ["cardId", "some-uuid"],
      ["payload_body", "catatan penting"],
      ["payload_notes", "tambahan"],
    ];
    const result = collectPayloadFromEntries(entries);
    expect(result).toEqual({ body: "catatan penting", notes: "tambahan" });
    expect("cardId" in result).toBe(false);
  });

  it("coerces amount to number", () => {
    const result = collectPayloadFromEntries([["payload_amount", "500000"]]);
    expect(result.amount).toBe(500000);
    expect(typeof result.amount).toBe("number");
  });

  it("coerces percent_complete to number", () => {
    const result = collectPayloadFromEntries([["payload_percent_complete", "75"]]);
    expect(result.percent_complete).toBe(75);
  });

  it("coerces quantity to number", () => {
    const result = collectPayloadFromEntries([["payload_quantity", "12"]]);
    expect(result.quantity).toBe(12);
  });

  it("skips amount if value is not a number", () => {
    const result = collectPayloadFromEntries([["payload_amount", "NaN-text"]]);
    expect("amount" in result).toBe(false);
  });

  it("splits attendees csv into string[]", () => {
    const result = collectPayloadFromEntries([["payload_attendees", "Budi, Sari , Joko"]]);
    expect(result.attendees).toEqual(["Budi", "Sari", "Joko"]);
  });

  it("filters empty attendees tokens", () => {
    const result = collectPayloadFromEntries([["payload_attendees", "Budi,,Sari"]]);
    expect(result.attendees).toEqual(["Budi", "Sari"]);
  });

  it("drops empty string values", () => {
    const result = collectPayloadFromEntries([
      ["payload_body", "  "],   // blank → skipped
      ["payload_notes", "ok"],
    ]);
    expect("body" in result).toBe(false);
    expect(result.notes).toBe("ok");
  });

  it("returns empty object when no payload_ keys", () => {
    const result = collectPayloadFromEntries([["eventKind", "note"], ["cardId", "x"]]);
    expect(result).toEqual({});
  });
});

// ─── collectPayload (FormData wrapper) ───────────────────────────────────────

describe("collectPayload (FormData)", () => {
  it("extracts payload fields from FormData", () => {
    const fd = new FormData();
    fd.set("payload_body", "test");
    fd.set("payload_amount", "100");
    fd.set("eventKind", "note");
    const result = collectPayload(fd);
    expect(result.body).toBe("test");
    expect(result.amount).toBe(100);
    expect("eventKind" in result).toBe(false);
  });
});
