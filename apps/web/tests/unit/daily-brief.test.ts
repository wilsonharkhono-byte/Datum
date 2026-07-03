/**
 * Tests for `composePersonalBrief` and `roleLabel` — pure Bahasa digest
 * compose (Task 4, launch-phase03). No DB, no model call.
 *
 * Also `findTodaysUnreadDigest` (Task 5) — the pure decision the /brief
 * layout uses to pick which notification (if any) seeds the portfolio dock.
 */

import { describe, expect, it } from "vitest";
import {
  composePersonalBrief,
  roleLabel,
  findTodaysUnreadDigest,
  isDuplicateSeed,
  DIGEST_NOTIFICATION_KIND,
  DIGEST_LINK,
  type DigestNotificationCandidate,
} from "@/lib/assistant/daily-brief";

describe("composePersonalBrief", () => {
  it("returns null when there are no items", () => {
    expect(composePersonalBrief({ name: "Rani", items: [] })).toBeNull();
  });

  it("composes the greeting + count + numbered items + deep link for a single item", () => {
    const msg = composePersonalBrief({
      name: "Rani",
      items: [{ message: "[Kamar Mandi A] Screed terlambat dari rencana." }],
    });
    expect(msg).toBe(
      "Pagi Rani — 1 hal hari ini: 1) [Kamar Mandi A] Screed terlambat dari rencana. Lihat: /brief",
    );
  });

  it("numbers up to 3 items with no overflow suffix at exactly 3", () => {
    const msg = composePersonalBrief({
      name: "Budi",
      items: [
        { message: "Item satu." },
        { message: "Item dua." },
        { message: "Item tiga." },
      ],
    });
    expect(msg).toContain("3 hal hari ini");
    expect(msg).toContain("1) Item satu.");
    expect(msg).toContain("2) Item dua.");
    expect(msg).toContain("3) Item tiga.");
    expect(msg).not.toContain("lainnya");
  });

  it("truncates beyond 3 items with a '+N lainnya' suffix", () => {
    const msg = composePersonalBrief({
      name: "Budi",
      items: [
        { message: "Item satu." },
        { message: "Item dua." },
        { message: "Item tiga." },
        { message: "Item empat." },
        { message: "Item lima." },
      ],
    });
    expect(msg).toContain("5 hal hari ini");
    expect(msg).toContain("3) Item tiga.");
    expect(msg).not.toContain("4) ");
    expect(msg).toContain("+2 lainnya");
  });

  it("always includes the /brief deep link", () => {
    const msg = composePersonalBrief({ name: "X", items: [{ message: "y" }] });
    expect(msg).toContain("/brief");
  });

  it("appends the escalation transparency line when escalatedTo is non-empty", () => {
    const msg = composePersonalBrief({
      name: "Rani",
      items: [{ message: "Waterproofing terblokir." }],
      escalatedTo: ["mandor", "principal"],
    });
    expect(msg).toContain("Juga dikirim ke: mandor, principal.");
  });

  it("omits the escalation line when escalatedTo is empty or absent", () => {
    const withoutArg = composePersonalBrief({ name: "Rani", items: [{ message: "y" }] });
    const withEmpty = composePersonalBrief({ name: "Rani", items: [{ message: "y" }], escalatedTo: [] });
    expect(withoutArg).not.toContain("dikirim ke");
    expect(withEmpty).not.toContain("dikirim ke");
  });

  it("de-dupes escalatedTo roles", () => {
    const msg = composePersonalBrief({
      name: "Rani",
      items: [{ message: "y" }],
      escalatedTo: ["mandor", "mandor", "principal"],
    });
    expect(msg).toContain("Juga dikirim ke: mandor, principal.");
  });

  it("stays at or under 600 chars even with many/long items and an escalation line", () => {
    const longItems = Array.from({ length: 10 }, (_, i) => ({
      message: `Item nomor ${i} dengan deskripsi yang cukup panjang untuk menguji batas karakter pesan digest harian ini sungguh.`,
    }));
    const msg = composePersonalBrief({
      name: "Rani Kusuma Wijaya",
      items: longItems,
      escalatedTo: ["mandor", "principal", "PIC", "desainer"],
    });
    expect(msg).not.toBeNull();
    expect(msg!.length).toBeLessThanOrEqual(600);
    // The deep link must survive even under hard truncation.
    expect(msg).toContain("/brief");
  });

  it("drops the escalation line first when over budget, keeping the base digest if it fits", () => {
    // Construct items that fit in 600 chars alone, but not with a long escalation line.
    const items = [
      { message: "A".repeat(500) },
    ];
    const msg = composePersonalBrief({
      name: "Rani",
      items,
      escalatedTo: ["mandor-yang-namanya-sangat-panjang-sekali-untuk-tes-ini-berulang-ulang"],
    });
    expect(msg).not.toBeNull();
    expect(msg!.length).toBeLessThanOrEqual(600);
    expect(msg).not.toContain("dikirim ke");
  });
});

describe("roleLabel", () => {
  it("maps known staff_role values to Bahasa labels", () => {
    expect(roleLabel("site_supervisor")).toBe("mandor");
    expect(roleLabel("principal")).toBe("principal");
    expect(roleLabel("pic")).toBe("PIC");
    expect(roleLabel("designer")).toBe("desainer");
    expect(roleLabel("admin")).toBe("admin");
    expect(roleLabel("estimator")).toBe("estimator");
  });

  it("falls back to the raw string for unknown roles", () => {
    expect(roleLabel("carpenter")).toBe("carpenter");
  });
});

describe("findTodaysUnreadDigest", () => {
  const TODAY_START_UTC = new Date("2026-07-02T00:00:00+07:00").toISOString();
  const TOMORROW_START_UTC = new Date("2026-07-03T00:00:00+07:00").toISOString();

  function candidate(overrides: Partial<DigestNotificationCandidate> = {}): DigestNotificationCandidate {
    return {
      id: "11111111-1111-1111-1111-111111111111",
      kind: DIGEST_NOTIFICATION_KIND,
      link: DIGEST_LINK,
      summary: "Pagi Rani — 2 hal hari ini: 1) A. 2) B. Lihat: /brief",
      read_at: null,
      created_at: new Date("2026-07-02T02:00:00+07:00").toISOString(), // within today's window
      ...overrides,
    };
  }

  it("returns null for an empty list", () => {
    expect(findTodaysUnreadDigest([], TODAY_START_UTC, TOMORROW_START_UTC)).toBeNull();
  });

  it("returns the id + summary of today's unread digest when present", () => {
    const row = candidate();
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toEqual({
      id: row.id,
      summary: row.summary,
    });
  });

  it("returns null when the matching row is already read", () => {
    const row = candidate({ read_at: new Date("2026-07-02T03:00:00+07:00").toISOString() });
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toBeNull();
  });

  it("ignores rows with a different notification kind", () => {
    const row = candidate({ kind: "watcher_event" });
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toBeNull();
  });

  it("ignores rows with a different link (not the cross-project /brief digest)", () => {
    const row = candidate({ link: "/project/WHA-01/rooms" });
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toBeNull();
  });

  it("ignores rows from before today's window (yesterday's digest)", () => {
    const row = candidate({ created_at: new Date("2026-07-01T08:00:00+07:00").toISOString() });
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toBeNull();
  });

  it("ignores rows from tomorrow's window (boundary is exclusive)", () => {
    const row = candidate({ created_at: TOMORROW_START_UTC });
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toBeNull();
  });

  it("includes a row exactly at today's start boundary (inclusive)", () => {
    const row = candidate({ created_at: TODAY_START_UTC });
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toEqual({
      id: row.id,
      summary: row.summary,
    });
  });

  it("picks the newest matching row when multiple exist (shouldn't normally happen — one digest/day — but defensive)", () => {
    const older = candidate({
      id: "22222222-2222-2222-2222-222222222222",
      summary: "OLDER",
      created_at: new Date("2026-07-02T02:00:00+07:00").toISOString(),
    });
    const newer = candidate({
      id: "33333333-3333-3333-3333-333333333333",
      summary: "NEWER",
      created_at: new Date("2026-07-02T09:00:00+07:00").toISOString(),
    });
    expect(findTodaysUnreadDigest([older, newer], TODAY_START_UTC, TOMORROW_START_UTC)).toEqual({
      id: newer.id,
      summary: "NEWER",
    });
  });

  it("does not seed from an unrelated notification even if unread and today", () => {
    const row = candidate({ kind: "mention", link: "/project/WHA-01/cards/foo" });
    expect(findTodaysUnreadDigest([row], TODAY_START_UTC, TOMORROW_START_UTC)).toBeNull();
  });
});

describe("isDuplicateSeed", () => {
  const SEED_TEXT = "Pagi Rani — 2 hal hari ini: 1) A. 2) B. Lihat: /brief";

  it("returns false when there are no existing messages", () => {
    expect(isDuplicateSeed([], SEED_TEXT)).toBe(false);
  });

  it("returns false when no existing message matches the seed text", () => {
    expect(isDuplicateSeed(["Halo", "Ada yang bisa dibantu?"], SEED_TEXT)).toBe(false);
  });

  it("returns true when an existing message content exactly equals the seed text (post-hydration duplicate)", () => {
    expect(isDuplicateSeed(["Halo", SEED_TEXT], SEED_TEXT)).toBe(true);
  });

  it("does not match on partial/substring overlap — exact equality only", () => {
    expect(isDuplicateSeed([SEED_TEXT + " extra"], SEED_TEXT)).toBe(false);
  });
});
