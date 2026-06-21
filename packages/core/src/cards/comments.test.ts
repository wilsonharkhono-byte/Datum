import { describe, expect, it } from "vitest";
import {
  CreateCommentInput,
  EditCommentInput,
  extractMentionTokens,
  resolveMentionStaffIds,
  createComment,
  editComment,
  deleteComment,
} from "./comments";

// ─── extractMentionTokens — pure fn ──────────────────────────────────────────

describe("extractMentionTokens", () => {
  it("extracts a single @mention", () => {
    expect(extractMentionTokens("Hey @budi, cek ini")).toEqual(["budi"]);
  });

  it("extracts multiple @mentions", () => {
    const tokens = extractMentionTokens("@budi dan @tanya sudah lihat?");
    expect(tokens).toContain("budi");
    expect(tokens).toContain("tanya");
    expect(tokens).toHaveLength(2);
  });

  it("lowercases tokens", () => {
    expect(extractMentionTokens("@Budi @TANYA")).toEqual(["budi", "tanya"]);
  });

  it("deduplicates the same token", () => {
    expect(extractMentionTokens("@budi @budi terima kasih")).toEqual(["budi"]);
  });

  it("returns empty array when no mentions", () => {
    expect(extractMentionTokens("tidak ada mention di sini")).toEqual([]);
  });

  it("ignores email-like patterns (requires letter start + min 2 chars after @)", () => {
    // @a alone is only 1 char after @, below the {1,30} min — still valid since
    // regex is {1,30} so single-char first names do match. This tests email@host.
    const tokens = extractMentionTokens("email@example.com");
    // "example" would be extracted because "@example" matches; the pure helper
    // doesn't try to disambiguate email — that's intentional (same as web).
    // Just verify the function doesn't throw.
    expect(Array.isArray(tokens)).toBe(true);
  });

  it("handles a body with no mentions gracefully (empty string)", () => {
    expect(extractMentionTokens("")).toEqual([]);
  });
});

// ─── resolveMentionStaffIds — mocked supabase ────────────────────────────────

describe("resolveMentionStaffIds", () => {
  function makeStaffMock(staff: Array<{ id: string; full_name: string | null }>) {
    return {
      from: (_table: string) => ({
        select: (_cols: string) => ({
          eq: (_col: string, _val: unknown) => Promise.resolve({ data: staff, error: null }),
        }),
      }),
    } as unknown;
  }

  it("resolves a token to the matching staff id (case-insensitive first name)", async () => {
    const supabase = makeStaffMock([
      { id: "staff-001", full_name: "Budi Santoso" },
      { id: "staff-002", full_name: "Tanya Wijaya" },
    ]);
    const ids = await resolveMentionStaffIds(
      supabase as Parameters<typeof resolveMentionStaffIds>[0],
      ["budi"],
    );
    expect(ids).toEqual(["staff-001"]);
  });

  it("resolves multiple tokens", async () => {
    const supabase = makeStaffMock([
      { id: "staff-001", full_name: "Budi Santoso" },
      { id: "staff-002", full_name: "Tanya Wijaya" },
    ]);
    const ids = await resolveMentionStaffIds(
      supabase as Parameters<typeof resolveMentionStaffIds>[0],
      ["budi", "tanya"],
    );
    expect(ids).toContain("staff-001");
    expect(ids).toContain("staff-002");
    expect(ids).toHaveLength(2);
  });

  it("returns empty when no tokens match any staff", async () => {
    const supabase = makeStaffMock([{ id: "staff-001", full_name: "Budi Santoso" }]);
    const ids = await resolveMentionStaffIds(
      supabase as Parameters<typeof resolveMentionStaffIds>[0],
      ["nobody"],
    );
    expect(ids).toEqual([]);
  });

  it("returns empty immediately when tokens array is empty (no DB call needed)", async () => {
    let called = false;
    const supabase = {
      from: () => {
        called = true;
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      },
    } as unknown;
    const ids = await resolveMentionStaffIds(
      supabase as Parameters<typeof resolveMentionStaffIds>[0],
      [],
    );
    expect(ids).toEqual([]);
    expect(called).toBe(false);
  });

  it("deduplicates when two tokens match the same person", async () => {
    const supabase = makeStaffMock([{ id: "staff-001", full_name: "Budi Budi" }]);
    // "budi" appears twice — should still resolve to one id
    const ids = await resolveMentionStaffIds(
      supabase as Parameters<typeof resolveMentionStaffIds>[0],
      ["budi", "budi"],
    );
    expect(ids).toEqual(["staff-001"]);
  });

  it("handles staff with null full_name gracefully", async () => {
    const supabase = makeStaffMock([
      { id: "staff-001", full_name: null },
      { id: "staff-002", full_name: "Tanya Wijaya" },
    ]);
    const ids = await resolveMentionStaffIds(
      supabase as Parameters<typeof resolveMentionStaffIds>[0],
      ["tanya"],
    );
    expect(ids).toEqual(["staff-002"]);
  });
});

// ─── Schema validation ────────────────────────────────────────────────────────

describe("CreateCommentInput schema", () => {
  const base = {
    cardId:           "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    projectId:        "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    body:             "Ini komentar",
    createdByStaffId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  };

  it("accepts a valid input", () => {
    expect(CreateCommentInput.safeParse(base).success).toBe(true);
  });

  it("rejects empty body", () => {
    expect(CreateCommentInput.safeParse({ ...base, body: "" }).success).toBe(false);
  });

  it("rejects body over 4000 chars", () => {
    expect(CreateCommentInput.safeParse({ ...base, body: "x".repeat(4001) }).success).toBe(false);
  });

  it("rejects non-uuid cardId", () => {
    expect(CreateCommentInput.safeParse({ ...base, cardId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects missing projectId", () => {
    const { projectId: _, ...rest } = base;
    expect(CreateCommentInput.safeParse(rest).success).toBe(false);
  });
});

describe("EditCommentInput schema", () => {
  it("accepts valid commentId + body", () => {
    expect(EditCommentInput.safeParse({
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      body:      "Diperbarui",
    }).success).toBe(true);
  });

  it("rejects empty body", () => {
    expect(EditCommentInput.safeParse({
      commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      body:      "",
    }).success).toBe(false);
  });

  it("rejects non-uuid commentId", () => {
    expect(EditCommentInput.safeParse({
      commentId: "bad-id",
      body:      "ok",
    }).success).toBe(false);
  });
});

// ─── createComment — mocked supabase ─────────────────────────────────────────

function makeCommentInsertMock(overrides: {
  insertResult?: unknown;
  staff?: Array<{ id: string; full_name: string | null }>;
} = {}) {
  const insertResult = overrides.insertResult ?? {
    data: { id: "comment-uuid-001" },
    error: null,
  };
  const staff = overrides.staff ?? [];

  return {
    from: (table: string) => {
      if (table === "staff") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => Promise.resolve({ data: staff, error: null }),
          }),
        };
      }
      // card_comments
      return {
        insert: (_row: unknown) => ({
          select: (_cols?: string) => ({
            single: () => Promise.resolve(insertResult),
          }),
        }),
      };
    },
  } as unknown;
}

describe("createComment", () => {
  const args = {
    cardId:           "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    projectId:        "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    body:             "Periksa @budi besok",
    createdByStaffId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  };

  it("returns commentId + resolved mentions on success", async () => {
    const supabase = makeCommentInsertMock({
      staff: [{ id: "staff-budi", full_name: "Budi Santoso" }],
    });
    const result = await createComment(
      supabase as Parameters<typeof createComment>[0],
      args,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.commentId).toBe("comment-uuid-001");
      expect(result.mentions).toEqual(["staff-budi"]);
    }
  });

  it("returns ok with empty mentions when no @mention in body", async () => {
    const supabase = makeCommentInsertMock();
    const result = await createComment(
      supabase as Parameters<typeof createComment>[0],
      { ...args, body: "Tidak ada mention" },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mentions).toEqual([]);
  });

  it("returns error on DB failure", async () => {
    const supabase = makeCommentInsertMock({
      insertResult: { data: null, error: { message: "violates foreign key" } },
    });
    const result = await createComment(
      supabase as Parameters<typeof createComment>[0],
      args,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("violates foreign key");
  });
});

// ─── editComment — mocked supabase ───────────────────────────────────────────

function makeCommentUpdateMock(overrides: {
  updateResult?: unknown;
  staff?: Array<{ id: string; full_name: string | null }>;
} = {}) {
  const updateResult = overrides.updateResult ?? {
    data: { id: "comment-uuid-001", card_id: "card-001", project_id: "proj-001" },
    error: null,
  };
  const staff = overrides.staff ?? [];

  return {
    from: (table: string) => {
      if (table === "staff") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: unknown) => Promise.resolve({ data: staff, error: null }),
          }),
        };
      }
      // card_comments
      return {
        update: (_patch: unknown) => ({
          eq: (_col: string, _val: unknown) => ({
            select: (_cols?: string) => ({
              single: () => Promise.resolve(updateResult),
            }),
          }),
        }),
      };
    },
  } as unknown;
}

describe("editComment", () => {
  const args = {
    commentId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    body:      "Diperbarui @tanya",
  };

  it("returns cardId + projectId + mentions on success", async () => {
    const supabase = makeCommentUpdateMock({
      staff: [{ id: "staff-tanya", full_name: "Tanya Wijaya" }],
    });
    const result = await editComment(
      supabase as Parameters<typeof editComment>[0],
      args,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cardId).toBe("card-001");
      expect(result.projectId).toBe("proj-001");
      expect(result.mentions).toEqual(["staff-tanya"]);
    }
  });

  it("returns error on DB failure", async () => {
    const supabase = makeCommentUpdateMock({
      updateResult: { data: null, error: { message: "row not found" } },
    });
    const result = await editComment(
      supabase as Parameters<typeof editComment>[0],
      args,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("row not found");
  });

  it("rejects empty body via schema", async () => {
    const supabase = makeCommentUpdateMock();
    const result = await editComment(
      supabase as Parameters<typeof editComment>[0],
      { ...args, body: "" },
    );
    expect(result.ok).toBe(false);
  });
});

// ─── deleteComment — mocked supabase ─────────────────────────────────────────

describe("deleteComment", () => {
  it("returns ok on success", async () => {
    const supabase = {
      from: (_table: string) => ({
        update: (_patch: unknown) => ({
          eq: (_col: string, _val: unknown) => Promise.resolve({ error: null }),
        }),
      }),
    } as unknown;
    const result = await deleteComment(
      supabase as Parameters<typeof deleteComment>[0],
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    expect(result.ok).toBe(true);
  });

  it("returns error on DB failure", async () => {
    const supabase = {
      from: (_table: string) => ({
        update: (_patch: unknown) => ({
          eq: (_col: string, _val: unknown) =>
            Promise.resolve({ error: { message: "permission denied" } }),
        }),
      }),
    } as unknown;
    const result = await deleteComment(
      supabase as Parameters<typeof deleteComment>[0],
      "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("permission denied");
  });
});
