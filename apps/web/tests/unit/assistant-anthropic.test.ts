import { describe, expect, it } from "vitest";
import {
  buildHistoryTurns,
  cachedSystemBlock,
  MAX_HISTORY_TURNS,
  SYSTEM,
} from "@/lib/assistant/anthropic";
import type { StoredMessage } from "@/lib/assistant/audit";

function msg(role: "user" | "assistant" | "system", content: string): StoredMessage {
  return { role, content };
}

describe("buildHistoryTurns", () => {
  it("returns an empty array for no history", () => {
    expect(buildHistoryTurns([])).toEqual([]);
  });

  it("maps stored user/assistant rows 1:1 preserving order", () => {
    const rows: StoredMessage[] = [
      msg("user", "Apa status kamar mandi utama?"),
      msg("assistant", "Sedang berjalan pemasangan keramik."),
    ];
    expect(buildHistoryTurns(rows)).toEqual([
      { role: "user", content: "Apa status kamar mandi utama?" },
      { role: "assistant", content: "Sedang berjalan pemasangan keramik." },
    ]);
  });

  it("drops role: system rows — the messages array only wants user/assistant turns", () => {
    const rows: StoredMessage[] = [
      msg("system", "internal note"),
      msg("user", "Halo"),
      msg("assistant", "Halo, ada yang bisa dibantu?"),
    ];
    const turns = buildHistoryTurns(rows);
    expect(turns).toHaveLength(2);
    expect(turns.every((t) => t.role === "user" || t.role === "assistant")).toBe(true);
    expect(turns.some((t) => t.content === "internal note")).toBe(false);
  });

  it("caps to the last MAX_HISTORY_TURNS (8) entries, keeping the most recent", () => {
    const rows: StoredMessage[] = [];
    for (let i = 0; i < 12; i++) {
      rows.push(msg(i % 2 === 0 ? "user" : "assistant", `turn-${i}`));
    }
    const turns = buildHistoryTurns(rows);
    expect(turns).toHaveLength(MAX_HISTORY_TURNS);
    // The oldest 4 (turn-0..turn-3) should have been dropped; turn-4..turn-11 kept.
    expect(turns[0]!.content).toBe("turn-4");
    expect(turns[turns.length - 1]!.content).toBe("turn-11");
  });

  it("role-alternation sanity: a well-formed session (user/assistant pairs) alternates in the output", () => {
    const rows: StoredMessage[] = [
      msg("user", "q1"), msg("assistant", "a1"),
      msg("user", "q2"), msg("assistant", "a2"),
    ];
    const turns = buildHistoryTurns(rows);
    for (let i = 0; i < turns.length; i++) {
      expect(turns[i]!.role).toBe(i % 2 === 0 ? "user" : "assistant");
    }
  });

  it("caps at exactly MAX_HISTORY_TURNS when there are precisely that many rows (no off-by-one)", () => {
    const rows: StoredMessage[] = [];
    for (let i = 0; i < MAX_HISTORY_TURNS; i++) {
      rows.push(msg(i % 2 === 0 ? "user" : "assistant", `t${i}`));
    }
    const turns = buildHistoryTurns(rows);
    expect(turns).toHaveLength(MAX_HISTORY_TURNS);
    expect(turns[0]!.content).toBe("t0");
  });
});

describe("cachedSystemBlock", () => {
  it("wraps text as a single ephemeral-cached text block", () => {
    const block = cachedSystemBlock("hello");
    expect(block).toEqual([
      { type: "text", text: "hello", cache_control: { type: "ephemeral" } },
    ]);
  });
});

describe("PM system prompt content (Task 2 requirements)", () => {
  it("keeps the Bahasa Indonesia + context-only + no-repeat-question instructions", () => {
    expect(SYSTEM).toMatch(/Bahasa Indonesia/);
    expect(SYSTEM).toMatch(/Hanya gunakan informasi dari blok KONTEKS/);
    expect(SYSTEM).toMatch(/Jangan ulangi pertanyaan/);
  });

  it("instructs leading with a direct answer", () => {
    expect(SYSTEM).toMatch(/jawaban langsung/i);
  });

  it("instructs proactively flagging the top risk when relevant", () => {
    expect(SYSTEM).toMatch(/risiko paling mendesak/i);
    expect(SYSTEM).toMatch(/proaktif/i);
  });

  it("caps follow-up suggestions to at most one", () => {
    expect(SYSTEM).toMatch(/paling banyak satu saran tindak lanjut/i);
  });

  it("carve-out: names all four PM-context sections as needing no citation token", () => {
    expect(SYSTEM).toMatch(/LANGKAH PER RUANGAN/);
    expect(SYSTEM).toMatch(/KEPUTUSAN TERBUKA/);
    expect(SYSTEM).toMatch(/PENGADAAN\/ORDER/);
    expect(SYSTEM).toMatch(/PERKIRAAN/);
    expect(SYSTEM).toMatch(/TIDAK butuh token sitasi/i);
  });

  it("carve-out: instructs citing those sections by naming the room/step instead", () => {
    expect(SYSTEM).toMatch(/sebut nama ruangan atau langkah/i);
  });

  it("carve-out: still forbids fabricating citation tokens", () => {
    expect(SYSTEM).toMatch(/[Jj]angan pernah mengarang.*token sitasi/);
  });

  it("still requires [card:]/[event:] tokens for card/event-sourced facts", () => {
    expect(SYSTEM).toMatch(/\[card:UUID\]/);
    expect(SYSTEM).toMatch(/\[event:UUID\]/);
  });

  it("is byte-stable across repeated reads (no timestamp/random leaking into the cached block)", () => {
    const a = SYSTEM;
    const b = SYSTEM;
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // no ISO timestamp
  });
});

describe("PM system prompt content (Task 3 — confirm-gated action tail)", () => {
  it("describes the fenced <action>{json}</action> tail format", () => {
    expect(SYSTEM).toMatch(/<action>/);
    expect(SYSTEM).toMatch(/<\/action>/);
  });

  it("names all three action types", () => {
    expect(SYSTEM).toMatch(/"remind"/);
    expect(SYSTEM).toMatch(/"update_step"/);
    expect(SYSTEM).toMatch(/"record_decision"/);
  });

  it("caps proposals to at most one action tail per reply", () => {
    expect(SYSTEM).toMatch(/paling banyak satu (blok )?aksi/i);
  });

  it("instructs offering an action only when clearly helpful, not by default", () => {
    expect(SYSTEM).toMatch(/hanya (jika|bila|saat).*(jelas membantu|benar-benar membantu)/i);
  });

  it("instructs the action tail must be the very last thing in the reply", () => {
    expect(SYSTEM).toMatch(/akhir (dari )?jawaban/i);
  });

  it("is still byte-stable after the Task 3 extension (no interpolated values)", () => {
    expect(SYSTEM).toBe(SYSTEM);
    expect(SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});
