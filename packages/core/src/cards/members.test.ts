import { describe, expect, it } from "vitest";
import {
  AddCardMemberInput,
  RemoveCardMemberInput,
  addCardMember,
  removeCardMember,
} from "./members";

// ─── Schema validation ────────────────────────────────────────────────────────

describe("AddCardMemberInput schema", () => {
  const base = {
    cardId:         "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    staffId:        "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    role:           "watcher" as const,
    addedByStaffId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  };

  it("accepts a valid input", () => {
    expect(AddCardMemberInput.safeParse(base).success).toBe(true);
  });

  it("defaults role to watcher when omitted", () => {
    const { role: _, ...rest } = base;
    const result = AddCardMemberInput.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.role).toBe("watcher");
  });

  it("accepts owner role", () => {
    expect(AddCardMemberInput.safeParse({ ...base, role: "owner" }).success).toBe(true);
  });

  it("accepts assignee role", () => {
    expect(AddCardMemberInput.safeParse({ ...base, role: "assignee" }).success).toBe(true);
  });

  it("rejects an invalid role", () => {
    expect(AddCardMemberInput.safeParse({ ...base, role: "viewer" }).success).toBe(false);
  });

  it("rejects non-uuid cardId", () => {
    expect(AddCardMemberInput.safeParse({ ...base, cardId: "bad" }).success).toBe(false);
  });

  it("rejects missing staffId", () => {
    const { staffId: _, ...rest } = base;
    expect(AddCardMemberInput.safeParse(rest).success).toBe(false);
  });
});

describe("RemoveCardMemberInput schema", () => {
  const base = {
    cardId:  "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    staffId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    role:    "watcher" as const,
  };

  it("accepts a valid input", () => {
    expect(RemoveCardMemberInput.safeParse(base).success).toBe(true);
  });

  it("rejects missing role (no default — required for remove)", () => {
    const { role: _, ...rest } = base;
    expect(RemoveCardMemberInput.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid role", () => {
    expect(RemoveCardMemberInput.safeParse({ ...base, role: "guest" }).success).toBe(false);
  });
});

// ─── addCardMember — mocked supabase ─────────────────────────────────────────

const BASE_ARGS = {
  cardId:         "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  staffId:        "b2c3d4e5-f6a7-8901-bcde-f12345678901",
  role:           "watcher" as const,
  addedByStaffId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
};

/** A mock where the existing-member lookup returns `existingRow` (or null). */
function makeMemberMock(overrides: {
  existingRow?: { removed_at: string | null } | null;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
} = {}) {
  const { existingRow = null, updateError = null, insertError = null } = overrides;

  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (_c2: string, _v2: unknown) => ({
            eq: (_c3: string, _v3: unknown) => ({
              maybeSingle: () =>
                Promise.resolve({ data: existingRow, error: null }),
            }),
          }),
        }),
      }),
      update: (_patch: unknown) => ({
        eq: (_c1: string, _v1: unknown) => ({
          eq: (_c2: string, _v2: unknown) => ({
            eq: (_c3: string, _v3: unknown) =>
              Promise.resolve({ error: updateError }),
          }),
        }),
      }),
      insert: (_row: unknown) =>
        Promise.resolve({ error: insertError }),
    }),
  } as unknown;
}

describe("addCardMember", () => {
  it("inserts a new row when no existing row found", async () => {
    const supabase = makeMemberMock({ existingRow: null });
    const result = await addCardMember(
      supabase as Parameters<typeof addCardMember>[0],
      BASE_ARGS,
    );
    expect(result.ok).toBe(true);
  });

  it("updates (un-removes) an existing soft-removed row", async () => {
    const supabase = makeMemberMock({
      existingRow: { removed_at: "2026-01-01T00:00:00Z" },
    });
    const result = await addCardMember(
      supabase as Parameters<typeof addCardMember>[0],
      BASE_ARGS,
    );
    expect(result.ok).toBe(true);
  });

  it("returns error when insert fails", async () => {
    const supabase = makeMemberMock({
      existingRow:  null,
      insertError:  { message: "foreign key violation" },
    });
    const result = await addCardMember(
      supabase as Parameters<typeof addCardMember>[0],
      BASE_ARGS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("foreign key violation");
  });

  it("returns error when update fails on un-remove", async () => {
    const supabase = makeMemberMock({
      existingRow:  { removed_at: "2026-01-01T00:00:00Z" },
      updateError:  { message: "permission denied" },
    });
    const result = await addCardMember(
      supabase as Parameters<typeof addCardMember>[0],
      BASE_ARGS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("permission denied");
  });

  it("rejects invalid args (bad uuid)", async () => {
    const supabase = makeMemberMock();
    const result = await addCardMember(
      supabase as Parameters<typeof addCardMember>[0],
      { ...BASE_ARGS, cardId: "not-a-uuid" },
    );
    expect(result.ok).toBe(false);
  });
});

// ─── removeCardMember — mocked supabase ──────────────────────────────────────

describe("removeCardMember", () => {
  function makeRemoveMock(error: { message: string } | null = null) {
    return {
      from: (_table: string) => ({
        update: (_patch: unknown) => ({
          eq: (_c1: string, _v1: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              eq: (_c3: string, _v3: unknown) => ({
                is: (_c4: string, _v4: unknown) =>
                  Promise.resolve({ error }),
              }),
            }),
          }),
        }),
      }),
    } as unknown;
  }

  it("returns ok on success", async () => {
    const supabase = makeRemoveMock(null);
    const result = await removeCardMember(
      supabase as Parameters<typeof removeCardMember>[0],
      { cardId: BASE_ARGS.cardId, staffId: BASE_ARGS.staffId, role: "watcher" },
    );
    expect(result.ok).toBe(true);
  });

  it("returns error on DB failure", async () => {
    const supabase = makeRemoveMock({ message: "row not found" });
    const result = await removeCardMember(
      supabase as Parameters<typeof removeCardMember>[0],
      { cardId: BASE_ARGS.cardId, staffId: BASE_ARGS.staffId, role: "watcher" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("row not found");
  });

  it("rejects invalid role", async () => {
    const supabase = makeRemoveMock(null);
    const result = await removeCardMember(
      supabase as Parameters<typeof removeCardMember>[0],
      { cardId: BASE_ARGS.cardId, staffId: BASE_ARGS.staffId, role: "guest" as never },
    );
    expect(result.ok).toBe(false);
  });
});
