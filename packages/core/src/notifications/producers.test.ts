import { describe, expect, it, vi } from "vitest";
import {
  shouldNotifyWatchers,
  notifyMentions,
  notifyWatchersOfEvent,
} from "./producers";

// ─── shouldNotifyWatchers — pure fn ──────────────────────────────────────────

describe("shouldNotifyWatchers", () => {
  it("returns true for decision events", () => {
    expect(shouldNotifyWatchers("decision")).toBe(true);
  });

  it("returns true for client_request events", () => {
    expect(shouldNotifyWatchers("client_request")).toBe(true);
  });

  it("returns false for note events", () => {
    expect(shouldNotifyWatchers("note")).toBe(false);
  });

  it("returns false for photo events", () => {
    expect(shouldNotifyWatchers("photo")).toBe(false);
  });

  it("returns false for material events", () => {
    expect(shouldNotifyWatchers("material")).toBe(false);
  });

  it("returns true for work events with status=blocked", () => {
    expect(shouldNotifyWatchers("work", { status: "blocked" })).toBe(true);
  });

  it("returns true for work events with issue=defect", () => {
    expect(shouldNotifyWatchers("work", { issue: "defect" })).toBe(true);
  });

  it("returns false for work events with routine status", () => {
    expect(shouldNotifyWatchers("work", { status: "in_progress" })).toBe(false);
  });

  it("returns false for work events with no payload", () => {
    expect(shouldNotifyWatchers("work", null)).toBe(false);
  });

  it("returns false for work events with undefined payload", () => {
    expect(shouldNotifyWatchers("work", undefined)).toBe(false);
  });

  it("returns false for unknown event kinds", () => {
    expect(shouldNotifyWatchers("drawing")).toBe(false);
  });
});

// ─── notifyMentions — mocked supabase ────────────────────────────────────────

describe("notifyMentions", () => {
  function makeInsertMock() {
    const inserted: unknown[] = [];
    const supabase = {
      from: (_table: string) => ({
        insert: (rows: unknown) => {
          (rows as unknown[]).forEach((r) => inserted.push(r));
          return Promise.resolve({ error: null });
        },
      }),
      _inserted: inserted,
    };
    return supabase as unknown as { _inserted: unknown[] } & Parameters<typeof notifyMentions>[0];
  }

  it("inserts one notification per mentioned staff (excluding actor)", async () => {
    const supabase = makeInsertMock();
    await notifyMentions(supabase, {
      mentionedStaffIds: ["staff-001", "staff-002"],
      actorId:           "staff-actor",
      projectId:         "proj-001",
      cardId:            "card-001",
      cardSlug:          "pintu-utama",
      cardComment:       { id: "comment-001", body: "Cek @budi dan @tanya" },
      projectCode:       "SANO",
    });
    expect(supabase._inserted).toHaveLength(2);
  });

  it("filters out self-mentions (actor == mentioned staff)", async () => {
    const supabase = makeInsertMock();
    await notifyMentions(supabase, {
      mentionedStaffIds: ["staff-actor", "staff-002"],
      actorId:           "staff-actor",
      projectId:         "proj-001",
      cardId:            "card-001",
      cardSlug:          "pintu-utama",
      cardComment:       { id: "comment-001", body: "test" },
      projectCode:       "SANO",
    });
    expect(supabase._inserted).toHaveLength(1);
  });

  it("does nothing when mentionedStaffIds is empty", async () => {
    const supabase = makeInsertMock();
    await notifyMentions(supabase, {
      mentionedStaffIds: [],
      actorId:           "staff-actor",
      projectId:         "proj-001",
      cardId:            "card-001",
      cardSlug:          "pintu-utama",
      cardComment:       { id: "comment-001", body: "no mention" },
      projectCode:       "SANO",
    });
    expect(supabase._inserted).toHaveLength(0);
  });

  it("truncates preview to 100 chars with ellipsis", async () => {
    const supabase = makeInsertMock();
    const longBody = "x".repeat(150);
    await notifyMentions(supabase, {
      mentionedStaffIds: ["staff-001"],
      actorId:           "staff-actor",
      projectId:         "proj-001",
      cardId:            "card-001",
      cardSlug:          "pintu",
      cardComment:       { id: "c-001", body: longBody },
      projectCode:       "SANO",
    });
    const row = supabase._inserted[0] as { summary: string };
    expect(row.summary).toContain("…");
    // preview part: 100 chars + "…" wrapped in quotes
    const preview = row.summary.replace('Anda disebut di komentar: "', "").replace('"', "");
    expect(preview.length).toBeLessThanOrEqual(101); // 100 + ellipsis
  });
});

// ─── notifyWatchersOfEvent — mocked supabase ─────────────────────────────────

describe("notifyWatchersOfEvent", () => {
  function makeMock(members: Array<{ staff_id: string }>) {
    const inserted: unknown[] = [];
    const supabase = {
      from: (table: string) => {
        if (table === "card_members") {
          return {
            select: (_cols: string) => ({
              eq: (_col: string, _val: unknown) => ({
                is: (_c2: string, _v2: unknown) =>
                  Promise.resolve({ data: members, error: null }),
              }),
            }),
          };
        }
        // notifications
        return {
          insert: (rows: unknown) => {
            (rows as unknown[]).forEach((r) => inserted.push(r));
            return Promise.resolve({ error: null });
          },
        };
      },
      _inserted: inserted,
    };
    return supabase as unknown as { _inserted: unknown[] } & Parameters<typeof notifyWatchersOfEvent>[0];
  }

  const BASE = {
    eventId:     "event-001",
    eventKind:   "decision",
    payload:     null,
    actorId:     "staff-actor",
    projectId:   "proj-001",
    projectCode: "SANO",
    cardId:      "card-001",
    cardSlug:    "pintu-utama",
    cardTitle:   "Pintu Utama",
  };

  it("fans out to all card members except the actor", async () => {
    const supabase = makeMock([
      { staff_id: "staff-001" },
      { staff_id: "staff-002" },
      { staff_id: "staff-actor" }, // actor — should be excluded
    ]);
    await notifyWatchersOfEvent(supabase, BASE);
    expect(supabase._inserted).toHaveLength(2);
  });

  it("does nothing when shouldNotifyWatchers returns false (e.g. material event)", async () => {
    const supabase = makeMock([{ staff_id: "staff-001" }]);
    await notifyWatchersOfEvent(supabase, { ...BASE, eventKind: "material" });
    expect(supabase._inserted).toHaveLength(0);
  });

  it("notifies for work events with blocked status", async () => {
    const supabase = makeMock([{ staff_id: "staff-001" }]);
    await notifyWatchersOfEvent(supabase, {
      ...BASE,
      eventKind: "work",
      payload:   { status: "blocked" },
    });
    expect(supabase._inserted).toHaveLength(1);
  });

  it("does not notify for routine work events", async () => {
    const supabase = makeMock([{ staff_id: "staff-001" }]);
    await notifyWatchersOfEvent(supabase, {
      ...BASE,
      eventKind: "work",
      payload:   { status: "in_progress" },
    });
    expect(supabase._inserted).toHaveLength(0);
  });

  it("deduplicates recipients", async () => {
    // Same staff_id twice (shouldn't happen in DB, but defensive)
    const supabase = makeMock([
      { staff_id: "staff-001" },
      { staff_id: "staff-001" },
    ]);
    await notifyWatchersOfEvent(supabase, BASE);
    expect(supabase._inserted).toHaveLength(1);
  });
});
