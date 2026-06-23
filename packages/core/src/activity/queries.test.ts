import { describe, it, expect } from "vitest";
import { summarizeEvent } from "./queries";

describe("summarizeEvent", () => {
  it("formats decision events", () => {
    expect(summarizeEvent("decision", { topic: "Marmer lantai", proposed_spec: "60x60 Carrara" }))
      .toBe("Marmer lantai — 60x60 Carrara");
  });

  it("formats vendor_quote events with amount", () => {
    const result = summarizeEvent("vendor_quote", { vendor_name: "PT Baja", amount: 5000000 });
    expect(result).toContain("PT Baja");
    expect(result).toContain("Rp");
  });

  it("formats progress events with percent", () => {
    expect(summarizeEvent("progress", { status: "in_progress", percent_complete: 75 }))
      .toBe("in_progress (75%)");
  });

  it("formats progress events without percent", () => {
    expect(summarizeEvent("progress", { status: "blocked" })).toBe("blocked");
  });

  it("formats note events", () => {
    expect(summarizeEvent("note", { body: "Perlu koordinasi dengan arsitek" }))
      .toBe("Perlu koordinasi dengan arsitek");
  });

  it("formats photo events with caption", () => {
    expect(summarizeEvent("photo", { caption: "Foto keramik" })).toBe("Foto keramik");
  });

  it("uses default fallback for unknown kinds", () => {
    const result = summarizeEvent("unknown_kind", { foo: "bar" });
    expect(result).toContain("foo");
  });

  it("formats material events", () => {
    expect(summarizeEvent("material", { item: "keramik", status: "ordered" }))
      .toBe("keramik — ordered");
  });

  it("formats worker_assigned events", () => {
    expect(summarizeEvent("worker_assigned", { worker_name: "Pak Budi", scope: "keramik" }))
      .toBe("Pak Budi — keramik");
  });

  it("formats worker_assigned without scope", () => {
    expect(summarizeEvent("worker_assigned", { worker_name: "Pak Budi" })).toBe("Pak Budi");
  });

  it("formats survey events", () => {
    expect(summarizeEvent("survey", { vendor_name: "CV Maju", location: "Bandung" }))
      .toBe("CV Maju · Bandung");
  });

  it("formats survey events with empty payload", () => {
    expect(summarizeEvent("survey", {})).toBe("survei");
  });
});
