import { describe, expect, it } from "vitest";
import { shouldNotifyWatchers } from "@/lib/notifications/producers";

describe("shouldNotifyWatchers", () => {
  it("notifies for decisions and client requests", () => {
    expect(shouldNotifyWatchers("decision", { topic: "marmer" })).toBe(true);
    expect(shouldNotifyWatchers("client_request", { request_text: "ubah warna" })).toBe(true);
  });

  it("does not notify for routine evidence kinds", () => {
    expect(shouldNotifyWatchers("photo", {})).toBe(false);
    expect(shouldNotifyWatchers("note", { body: "ok" })).toBe(false);
    expect(shouldNotifyWatchers("material", { item: "keramik", status: "ordered" })).toBe(false);
  });

  it("notifies for work only when blocked or a defect", () => {
    expect(shouldNotifyWatchers("work", { status: "in_progress" })).toBe(false);
    expect(shouldNotifyWatchers("work", { status: "blocked", blocked_on: "tunggu klien" })).toBe(true);
    expect(shouldNotifyWatchers("work", { status: "in_progress", issue: "defect", severity: "high" })).toBe(true);
    expect(shouldNotifyWatchers("work", undefined)).toBe(false);
    expect(shouldNotifyWatchers("work", null)).toBe(false);
  });

  it("does not notify for retired kinds", () => {
    expect(shouldNotifyWatchers("pending", { what: "x" })).toBe(false);
    expect(shouldNotifyWatchers("defect", { description: "x" })).toBe(false);
  });
});
