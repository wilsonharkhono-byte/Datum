import { describe, expect, it } from "vitest";
import { summarize, extractUrls, looksLikeImage, safeHostname, valueLabel, textField, decisionOutcomeLine } from "./event-render";
import type { CardEvent } from "@datum/db";

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeEvent(
  event_kind: string,
  payload: Record<string, unknown>,
): CardEvent {
  return {
    id: "e1",
    card_id: "c1",
    project_id: "p1",
    event_kind,
    payload,
    occurred_at: "2026-06-01T08:00:00Z",
    created_at:  "2026-06-01T08:00:00Z",
    logged_by_staff_id: "s1",
    source_kind: "manual",
    cost_visible: false,
  } as unknown as CardEvent;
}

// ─── valueLabel ───────────────────────────────────────────────────────────────

describe("valueLabel", () => {
  it("maps known enum values to Bahasa labels", () => {
    expect(valueLabel("needs_decision")).toBe("Butuh keputusan");
    expect(valueLabel("decided")).toBe("Sudah diputuskan");
    expect(valueLabel("in_progress")).toBe("Dikerjakan");
    expect(valueLabel("done")).toBe("Selesai");
    expect(valueLabel("quote")).toBe("Penawaran");
  });

  it("returns the raw value for unknown strings", () => {
    expect(valueLabel("something_unknown")).toBe("something_unknown");
    expect(valueLabel("")).toBe("");
  });
});

// ─── textField ────────────────────────────────────────────────────────────────

describe("textField", () => {
  it("returns the first non-empty string field from the candidate list, in order", () => {
    expect(textField({ topic: "Marmer" }, ["topic", "question", "summary"])).toBe("Marmer");
    expect(textField({ question: "Warna?" }, ["topic", "question", "summary"])).toBe("Warna?");
  });

  it("skips missing, non-string, and empty/whitespace-only fields", () => {
    expect(textField({ topic: undefined, question: "" }, ["topic", "question", "summary"])).toBeNull();
    expect(textField({ topic: 42, summary: "Ringkasan" }, ["topic", "summary"])).toBe("Ringkasan");
    expect(textField({ topic: "   " }, ["topic"])).toBeNull();
  });

  it("returns null (never the string 'undefined') when nothing matches", () => {
    expect(textField({}, ["topic", "question", "summary", "body", "description"])).toBeNull();
  });
});

// ─── decisionOutcomeLine ────────────────────────────────────────────────────────
// Fix 3 rework: single source of truth for the "Keputusan: " display prefix,
// paired with getDecisionOutcomesByCardEvent's extraction of the same prefix
// from record_revisions.reason (packages/core/src/cards/queries.ts).

describe("decisionOutcomeLine", () => {
  it("formats a non-empty outcome with the 'Keputusan: ' prefix", () => {
    expect(decisionOutcomeLine("pakai marmer putih")).toBe("Keputusan: pakai marmer putih");
  });

  it("trims surrounding whitespace", () => {
    expect(decisionOutcomeLine("  pakai marmer putih  ")).toBe("Keputusan: pakai marmer putih");
  });

  it("returns null for null, undefined, empty, or whitespace-only input", () => {
    expect(decisionOutcomeLine(null)).toBeNull();
    expect(decisionOutcomeLine(undefined)).toBeNull();
    expect(decisionOutcomeLine("")).toBeNull();
    expect(decisionOutcomeLine("   ")).toBeNull();
  });
});

// ─── summarize ────────────────────────────────────────────────────────────────

describe("summarize", () => {
  it("decision — topic + proposed_spec", () => {
    const ev = makeEvent("decision", { topic: "Marmer", proposed_spec: "Carrara 30x30" });
    expect(summarize(ev)).toBe("Marmer — Carrara 30x30");
  });

  it("decision — falls back to current_spec when no proposed_spec", () => {
    const ev = makeEvent("decision", { topic: "Pintu", current_spec: "Kayu jati" });
    expect(summarize(ev)).toBe("Pintu — Kayu jati");
  });

  // Renderer-tolerance fix: a decision with no topic/spec at all (malformed
  // payload, or an old row from before the taxonomy settled) used to render
  // literal "undefined — " via String(undefined). Must fall back through
  // question/summary/body/description and never print "undefined".
  it("decision — never prints the literal string 'undefined' when topic/spec are missing", () => {
    const ev = makeEvent("decision", {});
    expect(summarize(ev)).not.toContain("undefined");
  });

  it("decision — falls back to question/summary/body/description when topic is missing", () => {
    expect(summarize(makeEvent("decision", { question: "Warna cat apa?" }))).toBe("Warna cat apa?");
    expect(summarize(makeEvent("decision", { summary: "Ringkasan keputusan" }))).toBe("Ringkasan keputusan");
    expect(summarize(makeEvent("decision", { body: "Isi keputusan" }))).toBe("Isi keputusan");
    expect(summarize(makeEvent("decision", { description: "Deskripsi keputusan" }))).toBe("Deskripsi keputusan");
  });

  it("decision — with a fallback topic but no spec, omits the trailing dash instead of printing 'undefined'", () => {
    const ev = makeEvent("decision", { question: "Lantai apa?" });
    expect(summarize(ev)).toBe("Lantai apa?");
  });

  it("decision — a real topic with an empty proposed_spec still renders cleanly", () => {
    const ev = makeEvent("decision", { topic: "Marmer", proposed_spec: "" });
    expect(summarize(ev)).not.toContain("undefined");
  });

  it("drawing — description", () => {
    const ev = makeEvent("drawing", { description: "Denah lantai 1" });
    expect(summarize(ev)).toBe("Denah lantai 1");
  });

  it("drawing — falls back to drawing_code", () => {
    const ev = makeEvent("drawing", { drawing_code: "DWG-001" });
    expect(summarize(ev)).toBe("DWG-001");
  });

  it("vendor — quote interaction", () => {
    const ev = makeEvent("vendor", { interaction: "quote", vendor_name: "PT Maju", amount: 5000000 });
    expect(summarize(ev)).toBe("Quote dari PT Maju · Rp 5.000.000");
  });

  it("vendor — pick interaction", () => {
    const ev = makeEvent("vendor", { interaction: "pick", vendor_name: "CV Jaya" });
    expect(summarize(ev)).toBe("Pilih CV Jaya");
  });

  it("vendor — no amount when not a number", () => {
    const ev = makeEvent("vendor", { interaction: "survey", vendor_name: "TB Makmur" });
    expect(summarize(ev)).toBe("Survei oleh TB Makmur");
  });

  it("material — item + status via valueLabel", () => {
    const ev = makeEvent("material", { item: "Keramik", status: "ordered" });
    expect(summarize(ev)).toBe("Keramik — Dipesan");
  });

  it("work — status + percent + description", () => {
    const ev = makeEvent("work", { status: "in_progress", percent_complete: 60, description: "Plesteran" });
    expect(summarize(ev)).toBe("Dikerjakan (60%) — Plesteran");
  });

  it("work — includes worker_name prefix", () => {
    const ev = makeEvent("work", { worker_name: "Budi", status: "done" });
    expect(summarize(ev)).toBe("Budi · Selesai");
  });

  it("photo — caption", () => {
    const ev = makeEvent("photo", { caption: "Foto progres" });
    expect(summarize(ev)).toBe("Foto progres");
  });

  it("photo — fallback when no caption", () => {
    const ev = makeEvent("photo", {});
    expect(summarize(ev)).toBe("(foto)");
  });

  it("document — title", () => {
    const ev = makeEvent("document", { title: "RAB Revisi 2" });
    expect(summarize(ev)).toBe("RAB Revisi 2");
  });

  it("document — never prints 'undefined' when title is missing", () => {
    expect(summarize(makeEvent("document", {}))).not.toContain("undefined");
    expect(summarize(makeEvent("document", { description: "Dokumen tanpa judul" }))).toBe("Dokumen tanpa judul");
  });

  it("client_request — request_text", () => {
    const ev = makeEvent("client_request", { request_text: "Tambah stop kontak di kamar" });
    expect(summarize(ev)).toBe("Tambah stop kontak di kamar");
  });

  it("client_request — never prints 'undefined' when request_text is missing", () => {
    expect(summarize(makeEvent("client_request", {}))).not.toContain("undefined");
    expect(summarize(makeEvent("client_request", { question: "Bisa tambah rak?" }))).toBe("Bisa tambah rak?");
  });

  it("note — body", () => {
    const ev = makeEvent("note", { body: "Perlu dicek minggu depan" });
    expect(summarize(ev)).toBe("Perlu dicek minggu depan");
  });

  it("note — never prints 'undefined' when body is missing", () => {
    expect(summarize(makeEvent("note", {}))).not.toContain("undefined");
  });

  // Retired kinds
  it("survey (retired) — vendor_name · location", () => {
    const ev = makeEvent("survey", { vendor_name: "PT Maju", location: "Lantai 2" });
    expect(summarize(ev)).toBe("PT Maju · Lantai 2");
  });

  it("vendor_quote (retired) — vendor_name + amount", () => {
    const ev = makeEvent("vendor_quote", { vendor_name: "CV Jaya", amount: 2000000 });
    expect(summarize(ev)).toBe("CV Jaya · Rp 2.000.000");
  });

  it("vendor_pick (retired) — vendor_name", () => {
    const ev = makeEvent("vendor_pick", { vendor_name: "TB Bersama" });
    expect(summarize(ev)).toBe("TB Bersama");
  });

  it("worker_assigned (retired) — name + scope", () => {
    const ev = makeEvent("worker_assigned", { worker_name: "Pak Hasan", scope: "Keramik" });
    expect(summarize(ev)).toBe("Pak Hasan — Keramik");
  });

  it("worker_assigned (retired) — name only (no scope)", () => {
    const ev = makeEvent("worker_assigned", { worker_name: "Pak Hasan" });
    expect(summarize(ev)).toBe("Pak Hasan");
  });

  it("progress (retired) — status + percent", () => {
    const ev = makeEvent("progress", { status: "Berjalan", percent_complete: 40 });
    expect(summarize(ev)).toBe("Berjalan (40%)");
  });

  it("defect (retired) — severity · description", () => {
    const ev = makeEvent("defect", { severity: "major", description: "Retak pada dinding" });
    expect(summarize(ev)).toBe("major · Retak pada dinding");
  });

  it("pending (retired) — what", () => {
    const ev = makeEvent("pending", { what: "Menunggu izin IMB" });
    expect(summarize(ev)).toBe("Menunggu izin IMB");
  });

  it("unknown kind — JSON fallback", () => {
    const ev = makeEvent("unknown_kind", { foo: "bar" });
    expect(summarize(ev)).toBe('{"foo":"bar"}');
  });
});

// ─── extractUrls ─────────────────────────────────────────────────────────────

describe("extractUrls", () => {
  it("finds HTTP and HTTPS URLs in string values", () => {
    const urls = extractUrls({ description: "See http://example.com and https://docs.io/page" });
    expect(urls).toEqual(["http://example.com", "https://docs.io/page"]);
  });

  it("returns an empty array when no URLs present", () => {
    expect(extractUrls({ body: "No links here" })).toEqual([]);
  });

  it("deduplicates repeated URLs", () => {
    const urls = extractUrls({ a: "https://x.com", b: "https://x.com" });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe("https://x.com");
  });

  it("ignores non-string values", () => {
    expect(extractUrls({ count: 42, active: true })).toEqual([]);
  });

  it("extracts URLs from multiple string fields", () => {
    const urls = extractUrls({ a: "https://a.com", b: "https://b.com" });
    expect(urls).toHaveLength(2);
  });
});

// ─── looksLikeImage ──────────────────────────────────────────────────────────

describe("looksLikeImage", () => {
  it("returns true for common image extensions", () => {
    expect(looksLikeImage("https://cdn.example.com/photo.jpg")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/photo.jpeg")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/photo.png")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/photo.gif")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/photo.webp")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/photo.heic")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/photo.heif")).toBe(true);
  });

  it("returns true for URLs with a query string after the extension", () => {
    expect(looksLikeImage("https://cdn.example.com/photo.jpg?w=800")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(looksLikeImage("https://cdn.example.com/photo.JPG")).toBe(true);
    expect(looksLikeImage("https://cdn.example.com/photo.PNG")).toBe(true);
  });

  it("returns false for non-image extensions", () => {
    expect(looksLikeImage("https://cdn.example.com/document.pdf")).toBe(false);
    expect(looksLikeImage("https://cdn.example.com/data.xlsx")).toBe(false);
    expect(looksLikeImage("https://example.com/page")).toBe(false);
  });
});

// ─── safeHostname ─────────────────────────────────────────────────────────────

describe("safeHostname", () => {
  it("returns the hostname for a valid URL", () => {
    expect(safeHostname("https://example.com/path?q=1")).toBe("example.com");
    expect(safeHostname("http://docs.io/page")).toBe("docs.io");
  });

  it("returns a truncated string for a malformed URL", () => {
    const result = safeHostname("not-a-valid-url-at-all");
    expect(result).toContain("…");
  });

  it("truncates to 30 chars + ellipsis for very long invalid input", () => {
    const long = "a".repeat(50);
    const result = safeHostname(long);
    expect(result).toBe("a".repeat(30) + "…");
  });
});
