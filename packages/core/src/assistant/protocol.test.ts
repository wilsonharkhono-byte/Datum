import { describe, expect, it } from "vitest";
import {
  parseStreamLine,
  extractCitations,
  stripCitationTokens,
} from "./protocol";

const UUID = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";
const UUID3 = "00000000-0000-0000-0000-000000000003";

describe("parseStreamLine — delta", () => {
  it("parses a delta event", () => {
    const result = parseStreamLine(JSON.stringify({ type: "delta", text: "Halo" }));
    expect(result).toEqual({ type: "delta", text: "Halo" });
  });

  it("parses a delta with empty string text", () => {
    const result = parseStreamLine(JSON.stringify({ type: "delta", text: "" }));
    expect(result).toEqual({ type: "delta", text: "" });
  });
});

describe("parseStreamLine — done", () => {
  it("parses a full done event", () => {
    const done = {
      type: "done",
      sessionId: UUID,
      citations: [{ cardId: UUID2, eventIds: [UUID3] }],
      usage: { input_tokens: 10, output_tokens: 20 },
    };
    const result = parseStreamLine(JSON.stringify(done));
    expect(result).toEqual(done);
  });

  it("handles null sessionId", () => {
    const result = parseStreamLine(
      JSON.stringify({ type: "done", sessionId: null, citations: [], usage: { input_tokens: 0, output_tokens: 0 } }),
    );
    expect(result).toMatchObject({ type: "done", sessionId: null });
  });

  it("filters invalid citations", () => {
    const result = parseStreamLine(
      JSON.stringify({
        type: "done",
        sessionId: null,
        citations: [
          { cardId: UUID, eventIds: [UUID2] },
          { notACard: true },
          "garbage",
        ],
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
    );
    expect(result).toMatchObject({
      type: "done",
      citations: [{ cardId: UUID, eventIds: [UUID2] }],
    });
  });
});

describe("parseStreamLine — error", () => {
  it("parses an error event", () => {
    const result = parseStreamLine(JSON.stringify({ type: "error", message: "Gagal" }));
    expect(result).toEqual({ type: "error", message: "Gagal" });
  });
});

describe("parseStreamLine — null cases", () => {
  it("returns null for blank line", () => {
    expect(parseStreamLine("")).toBeNull();
    expect(parseStreamLine("   ")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseStreamLine("{not json")).toBeNull();
  });

  it("returns null for JSON with unknown type", () => {
    expect(parseStreamLine(JSON.stringify({ type: "unknown", data: 1 }))).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseStreamLine('"just a string"')).toBeNull();
    expect(parseStreamLine("42")).toBeNull();
  });

  it("handles whitespace-padded lines", () => {
    const result = parseStreamLine(`  ${JSON.stringify({ type: "delta", text: "ok" })}  `);
    expect(result).toEqual({ type: "delta", text: "ok" });
  });
});

describe("extractCitations", () => {
  it("extracts a card with one event", () => {
    const answer = `Kartu [card:${UUID}] memiliki keputusan [event:${UUID2}].`;
    expect(extractCitations(answer)).toEqual([{ cardId: UUID, eventIds: [UUID2] }]);
  });

  it("extracts multiple cards", () => {
    const answer = `[card:${UUID}] info. [card:${UUID2}] info lain.`;
    const citations = extractCitations(answer);
    expect(citations).toHaveLength(2);
    expect(citations.map((c) => c.cardId)).toContain(UUID);
    expect(citations.map((c) => c.cardId)).toContain(UUID2);
  });

  it("returns empty array for text with no tokens", () => {
    expect(extractCitations("Tidak ada citation di sini.")).toEqual([]);
  });

  it("deduplicates event ids on the same card", () => {
    const answer = `[card:${UUID}] x [event:${UUID2}] y [event:${UUID2}]`;
    const [c] = extractCitations(answer);
    expect(c!.eventIds).toEqual([UUID2]);
  });

  it("handles text with only event tokens (no card) gracefully", () => {
    // event with no preceding card: best-effort — should not throw
    const citations = extractCitations(`[event:${UUID}] tanpa kartu`);
    expect(citations).toEqual([]);
  });
});

describe("stripCitationTokens", () => {
  it("removes a complete card token", () => {
    expect(stripCitationTokens(`Jawaban [card:${UUID}] selesai.`)).toBe("Jawaban selesai.");
  });

  it("removes a complete event token", () => {
    expect(stripCitationTokens(`Info [event:${UUID}] di sini.`)).toBe("Info di sini.");
  });

  it("removes multiple tokens", () => {
    const text = `A [card:${UUID}] B [event:${UUID2}] C`;
    expect(stripCitationTokens(text)).toBe("A B C");
  });

  it("leaves partial token intact (streaming safety)", () => {
    // A partial token (missing closing bracket) must NOT be stripped.
    const partial = `Halo [card:${UUID.slice(0, 8)}`;
    expect(stripCitationTokens(partial)).toContain("[card:");
  });

  it("does not modify text with no citation tokens", () => {
    const plain = "Tidak ada citation di sini.";
    expect(stripCitationTokens(plain)).toBe(plain);
  });
});
