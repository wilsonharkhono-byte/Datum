/**
 * Tests for `composePersonalBrief` and `roleLabel` — pure Bahasa digest
 * compose (Task 4, launch-phase03). No DB, no model call.
 */

import { describe, expect, it } from "vitest";
import { composePersonalBrief, roleLabel } from "@/lib/assistant/daily-brief";

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
