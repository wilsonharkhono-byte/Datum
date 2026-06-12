import { describe, expect, it } from "vitest";
import { deriveScope, deriveProjectMeta, normalizeBoard } from "../trello-normalize";

describe("deriveScope", () => {
  it("maps prefixes to scope", () => {
    expect(deriveScope("AR.IN - BDG H-1")).toBe("arin");
    expect(deriveScope("ARCH - BDG H-16")).toBe("arch");
    expect(deriveScope("INTR - CITRALAND M-8")).toBe("intr");
    expect(deriveScope("WHA - WORKING DRAWINGS")).toBe("wha");
  });
  it("defaults unknown prefixes to arin", () => {
    expect(deriveScope("PAKUWON AB1/28")).toBe("arin");
  });
});

describe("deriveProjectMeta", () => {
  it("splits site and client on the trailing ' - ' token", () => {
    const m = deriveProjectMeta("AR.IN - BUKIT DARMO GOLF I-23 - YENI KALIM");
    expect(m.scope).toBe("arin");
    expect(m.project_name).toBe("Bukit Darmo Golf I-23");
    expect(m.client_name).toBe("Yeni Kalim");
    expect(m.site_address).toBe("Bukit Darmo Golf I-23");
    expect(m.project_code).toBe("ARIN-BUKIT-DARMO-GOLF-I-23");
    expect(m.search_aliases).toContain("Yeni Kalim");
    expect(m.search_aliases).toContain("Bukit Darmo Golf I-23");
  });
  it("splits on the trailing underscore token", () => {
    const m = deriveProjectMeta("AR.IN - KARAWANG_NABIL");
    expect(m.project_name).toBe("Karawang");
    expect(m.client_name).toBe("Nabil");
    expect(m.project_code).toBe("ARIN-KARAWANG");
  });
  it("leaves client null when the trailing token looks like a unit", () => {
    const m = deriveProjectMeta("AR.IN - CITRALAND GA7/45");
    expect(m.client_name).toBeNull();
    expect(m.project_name).toBe("Citraland Ga7/45");
    expect(m.project_code).toBe("ARIN-CITRALAND-GA7-45");
  });
  it("keeps ARCH/INTR/WHA scope prefixes in the code", () => {
    expect(deriveProjectMeta("ARCH - BDG H-16").project_code).toBe("ARCH-BDG-H-16");
    expect(deriveProjectMeta("INTR - CITRALAND M-8").project_code).toBe("INTR-CITRALAND-M-8");
    expect(deriveProjectMeta("WHA - WORKING DRAWINGS").project_code).toBe("WHA-WORKING-DRAWINGS");
  });
});

describe("normalizeBoard", () => {
  const raw = {
    id: "665e984287e87d6665545a17",
    shortLink: "QQQcBn6d",
    name: "AR.IN - BDG H-1",
    lists: [{ id: "l1", name: "A04 — Tangga", closed: false }],
    cards: [
      {
        id: "card1",
        name: "Pasang kusen",
        desc: "detail",
        idList: "l1",
        due: null,
        dueComplete: false,
        dateLastActivity: "2026-02-01T00:00:00Z",
        shortUrl: "https://trello.com/c/x",
        shortLink: "x",
        closed: false,
        attachments: [{ id: "a1", name: "foto", url: "https://img", mimeType: "image/jpeg", date: "2026-02-01T00:00:00Z" }],
        checklists: [{ id: "cl1", name: "Checklist", checkItems: [{ id: "ci1", name: "step", state: "incomplete" }] }],
      },
    ],
    actions: [
      { id: "act1", type: "commentCard", date: "2026-02-02T00:00:00Z", data: { card: { id: "card1" }, text: "hi" } },
      { id: "act2", type: "updateCard", date: "2026-02-02T00:00:00Z", data: { card: { id: "card1" } } },
    ],
  };

  it("builds _meta from the board name", () => {
    const b = normalizeBoard(raw);
    expect(b._meta.trello_board_id).toBe("665e984287e87d6665545a17");
    expect(b._meta.short_link).toBe("QQQcBn6d");
    expect(b._meta.project_code).toBe("ARIN-BDG-H-1");
  });

  it("hoists card checklists to a top-level array and sets idChecklists", () => {
    const b = normalizeBoard(raw);
    expect(b.checklists).toHaveLength(1);
    expect(b.checklists[0]).toMatchObject({ id: "cl1", idCard: "card1", name: "Checklist" });
    expect((b.cards[0] as { idChecklists: string[] }).idChecklists).toEqual(["cl1"]);
  });

  it("keeps only commentCard actions", () => {
    const b = normalizeBoard(raw);
    expect(b.actions).toHaveLength(1);
    expect((b.actions[0] as { type: string }).type).toBe("commentCard");
  });
});
