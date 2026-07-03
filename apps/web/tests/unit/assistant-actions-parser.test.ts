/**
 * assistant-actions-parser.test.ts
 *
 * Pure-function tests for the confirm-gated action tail: parseActionTail
 * extracts + validates a single trailing `<action>{json}</action>` block from
 * an assistant reply, and stripActionTail removes it from displayed text.
 * No I/O — schema + regex only.
 */
import { describe, expect, it } from "vitest";
import { parseActionTail, stripActionTail, ActionProposal } from "@/lib/assistant/actions";

describe("parseActionTail — valid", () => {
  it("parses a valid remind action", () => {
    const text = `Baik, akan saya bantu.\n<action>{"type":"remind","recipientRole":"site_supervisor","message":"Lakukan flood test KM-1 besok"}</action>`;
    const result = parseActionTail(text);
    expect(result).toEqual({
      type: "remind",
      recipientRole: "site_supervisor",
      message: "Lakukan flood test KM-1 besok",
    });
  });

  it("parses a valid remind action with staffName and link", () => {
    const text = `<action>{"type":"remind","staffName":"Budi","message":"Cek keramik","link":"/project/ABC/rooms"}</action>`;
    const result = parseActionTail(text);
    expect(result).toEqual({
      type: "remind",
      staffName: "Budi",
      message: "Cek keramik",
      link: "/project/ABC/rooms",
    });
  });

  it("parses a valid update_step action", () => {
    const text = `<action>{"type":"update_step","areaName":"Kamar Mandi Utama","stepName":"Pemasangan keramik","status":"in_progress"}</action>`;
    const result = parseActionTail(text);
    expect(result).toEqual({
      type: "update_step",
      areaName: "Kamar Mandi Utama",
      stepName: "Pemasangan keramik",
      status: "in_progress",
    });
  });

  it("parses a valid update_step action with a note", () => {
    const text = `<action>{"type":"update_step","areaName":"KM-1","stepName":"Flood test","status":"blocked","note":"Menunggu drainase"}</action>`;
    const result = parseActionTail(text);
    expect(result).toEqual({
      type: "update_step",
      areaName: "KM-1",
      stepName: "Flood test",
      status: "blocked",
      note: "Menunggu drainase",
    });
  });

  it("parses a valid record_decision action", () => {
    const text = `<action>{"type":"record_decision","cardSlug":"whastudio-42","outcome":"Pakai marmer Carrara"}</action>`;
    const result = parseActionTail(text);
    expect(result).toEqual({
      type: "record_decision",
      cardSlug: "whastudio-42",
      outcome: "Pakai marmer Carrara",
    });
  });

  it("parses a record_decision action with a question but no cardSlug", () => {
    const text = `<action>{"type":"record_decision","question":"Warna keramik apa?","outcome":"Putih"}</action>`;
    const result = parseActionTail(text);
    expect(result).toEqual({
      type: "record_decision",
      question: "Warna keramik apa?",
      outcome: "Putih",
    });
  });

  it("tolerates surrounding whitespace/newlines around the tag", () => {
    const text = `Jawaban.\n\n  <action>{"type":"remind","message":"Ingatkan"}</action>  \n`;
    const result = parseActionTail(text);
    expect(result).toEqual({ type: "remind", message: "Ingatkan" });
  });
});

describe("parseActionTail — invalid → ignore silently", () => {
  it("returns null when there is no action tail", () => {
    expect(parseActionTail("Jawaban biasa tanpa aksi.")).toBeNull();
  });

  it("returns null for malformed JSON inside the tag", () => {
    const text = `<action>{"type":"remind", message: "tidak ada kutip"}</action>`;
    expect(parseActionTail(text)).toBeNull();
  });

  it("returns null for an unknown action type", () => {
    const text = `<action>{"type":"delete_project","id":"x"}</action>`;
    expect(parseActionTail(text)).toBeNull();
  });

  it("returns null when a required field is missing (remind without message)", () => {
    const text = `<action>{"type":"remind","recipientRole":"pic"}</action>`;
    expect(parseActionTail(text)).toBeNull();
  });

  it("returns null when update_step has an invalid status enum value", () => {
    const text = `<action>{"type":"update_step","areaName":"KM-1","stepName":"Keramik","status":"finished"}</action>`;
    expect(parseActionTail(text)).toBeNull();
  });

  it("returns null when record_decision is missing outcome", () => {
    const text = `<action>{"type":"record_decision","cardSlug":"x"}</action>`;
    expect(parseActionTail(text)).toBeNull();
  });

  it("returns null for an empty action tag", () => {
    expect(parseActionTail("<action></action>")).toBeNull();
  });

  it("returns null when the tag is unclosed", () => {
    const text = `<action>{"type":"remind","message":"Ingatkan"}`;
    expect(parseActionTail(text)).toBeNull();
  });
});

describe("parseActionTail — multiple tails → first only", () => {
  it("uses only the first action tail when two are present", () => {
    const text =
      `<action>{"type":"remind","message":"Pertama"}</action>` +
      `<action>{"type":"remind","message":"Kedua"}</action>`;
    const result = parseActionTail(text);
    expect(result).toEqual({ type: "remind", message: "Pertama" });
  });

  it("uses the first tail even when the first is invalid and the second is valid", () => {
    // Deliberately conservative: an invalid first tail does not fall through
    // to a later one — ignore silently rather than guess which one the model meant.
    const text =
      `<action>{"type":"remind"}</action>` + // missing message — invalid
      `<action>{"type":"remind","message":"Valid"}</action>`;
    expect(parseActionTail(text)).toBeNull();
  });
});

describe("parseActionTail — oversized", () => {
  it("returns null when the JSON payload exceeds the size cap", () => {
    const huge = "x".repeat(20_000);
    const text = `<action>{"type":"remind","message":"${huge}"}</action>`;
    expect(parseActionTail(text)).toBeNull();
  });

  it("accepts a message right at the schema's max length", () => {
    const okLen = "y".repeat(500);
    const text = `<action>{"type":"remind","message":"${okLen}"}</action>`;
    const result = parseActionTail(text);
    expect(result).not.toBeNull();
    expect((result as { message: string }).message).toBe(okLen);
  });
});

describe("stripActionTail", () => {
  it("removes a valid, well-formed action tail from the end of the text", () => {
    const text = `Jawaban lengkap.\n<action>{"type":"remind","message":"Ingatkan"}</action>`;
    expect(stripActionTail(text)).toBe("Jawaban lengkap.");
  });

  it("removes trailing whitespace left behind after stripping", () => {
    const text = `Jawaban.   \n\n<action>{"type":"remind","message":"x"}</action>\n\n`;
    expect(stripActionTail(text)).toBe("Jawaban.");
  });

  it("returns the text unchanged when there is no action tail", () => {
    expect(stripActionTail("Jawaban tanpa aksi.")).toBe("Jawaban tanpa aksi.");
  });

  it("strips even a malformed/invalid tag so it never leaks into the UI", () => {
    const text = `Jawaban.\n<action>{"type":"remind", message: bad}</action>`;
    expect(stripActionTail(text)).toBe("Jawaban.");
  });

  it("strips only the first tail, leaving nothing else appended, when multiple tails are present", () => {
    const text =
      `Jawaban.\n<action>{"type":"remind","message":"Pertama"}</action>` +
      `<action>{"type":"remind","message":"Kedua"}</action>`;
    expect(stripActionTail(text)).toBe("Jawaban.");
  });

  it("strips an unclosed tag through to the end of the text", () => {
    const text = `Jawaban.\n<action>{"type":"remind"`;
    expect(stripActionTail(text)).toBe("Jawaban.");
  });
});

describe("ActionProposal schema — direct validation", () => {
  it("accepts a minimal remind proposal", () => {
    expect(() =>
      ActionProposal.parse({ type: "remind", message: "Ingatkan" }),
    ).not.toThrow();
  });

  it("rejects a remind proposal with an empty message", () => {
    expect(() => ActionProposal.parse({ type: "remind", message: "" })).toThrow();
  });

  it("accepts all three update_step statuses", () => {
    for (const status of ["in_progress", "blocked", "done"] as const) {
      expect(() =>
        ActionProposal.parse({
          type: "update_step",
          areaName: "KM-1",
          stepName: "Keramik",
          status,
        }),
      ).not.toThrow();
    }
  });

  it("rejects record_decision with an empty outcome", () => {
    expect(() =>
      ActionProposal.parse({ type: "record_decision", cardSlug: "x", outcome: "" }),
    ).toThrow();
  });
});
