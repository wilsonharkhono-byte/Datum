import { describe, expect, it, vi } from "vitest";
import { CreateCardInput } from "./create";
import { CreateTopicInput, createTopic } from "./createTopic";
import { MoveCardInput, moveCard } from "./move";

// ─── Schema validation ────────────────────────────────────────────────────────

describe("CreateCardInput schema", () => {
  it("accepts a valid input", () => {
    const result = CreateCardInput.safeParse({
      projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      topicId:   "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      title:     "Pintu utama",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing projectId", () => {
    const result = CreateCardInput.safeParse({
      topicId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      title:   "Pintu utama",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing topicId", () => {
    const result = CreateCardInput.safeParse({
      projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      title:     "Pintu utama",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = CreateCardInput.safeParse({
      projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      topicId:   "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      title:     "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid uuid for projectId", () => {
    const result = CreateCardInput.safeParse({
      projectId: "not-a-uuid",
      topicId:   "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      title:     "OK",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateTopicInput schema", () => {
  it("accepts a valid input", () => {
    const result = CreateTopicInput.safeParse({
      projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name:      "Kamar Mandi",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing projectId", () => {
    const result = CreateTopicInput.safeParse({ name: "Kamar Mandi" });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = CreateTopicInput.safeParse({
      projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name:      "",
    });
    expect(result.success).toBe(false);
  });
});

describe("MoveCardInput schema", () => {
  it("accepts a valid input", () => {
    const result = MoveCardInput.safeParse({
      cardId:     "c3d4e5f6-a7b8-9012-cdef-123456789012",
      newTopicId: "d4e5f6a7-b8c9-0123-def0-234567890123",
      projectId:  "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing cardId", () => {
    const result = MoveCardInput.safeParse({
      newTopicId: "d4e5f6a7-b8c9-0123-def0-234567890123",
      projectId:  "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing newTopicId", () => {
    const result = MoveCardInput.safeParse({
      cardId:    "c3d4e5f6-a7b8-9012-cdef-123456789012",
      projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing projectId", () => {
    const result = MoveCardInput.safeParse({
      cardId:     "c3d4e5f6-a7b8-9012-cdef-123456789012",
      newTopicId: "d4e5f6a7-b8c9-0123-def0-234567890123",
    });
    expect(result.success).toBe(false);
  });
});

// ─── Mocked DB behaviour ─────────────────────────────────────────────────────

/** Build a minimal Supabase mock that chains .from().select()/insert()/update() */
function makeSupabaseMock(overrides: {
  auth?: { user: { id: string } | null };
  fromHandlers?: Record<string, {
    select?: () => unknown;
    insert?: () => unknown;
    update?: () => unknown;
  }>;
}) {
  const authUser = overrides.auth?.user ?? { id: "staff-uuid-001" };

  return {
    auth: {
      getUser: () => Promise.resolve({ data: { user: authUser }, error: null }),
    },
    from: (table: string) => {
      const handler = overrides.fromHandlers?.[table];
      const chain = {
        select: (_cols?: string) => ({
          eq: (_col: string, _val: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              maybeSingle: () =>
                Promise.resolve(handler?.select ? handler.select() : { data: null, error: null }),
            }),
            order: (_col2: string, _opts: unknown) => ({
              limit: (_n: number) => ({
                maybeSingle: () =>
                  Promise.resolve(handler?.select ? handler.select() : { data: null, error: null }),
              }),
            }),
            maybeSingle: () =>
              Promise.resolve(handler?.select ? handler.select() : { data: null, error: null }),
          }),
          maybeSingle: () =>
            Promise.resolve(handler?.select ? handler.select() : { data: null, error: null }),
        }),
        insert: (_row: unknown) => ({
          select: (_cols?: string) => ({
            single: () =>
              Promise.resolve(handler?.insert ? handler.insert() : { data: { id: "new-id" }, error: null }),
          }),
        }),
        update: (_patch: unknown) => ({
          eq: (_col: string, _val: unknown) => ({
            eq: (_c2: string, _v2: unknown) => ({
              is: (_c3: string, _v3: unknown) =>
                Promise.resolve(handler?.update ? handler.update() : { data: null, error: null }),
            }),
            select: (_cols?: string) => ({
              single: () =>
                Promise.resolve(handler?.update ? handler.update() : { data: { id: "upd-id" }, error: null }),
            }),
          }),
        }),
      };
      return chain;
    },
  } as unknown;
}

// ─── createTopic: 23505 duplicate handling ───────────────────────────────────

describe("createTopic", () => {
  it("maps a 23505 insert error to the Bahasa 'sudah ada' message", async () => {
    let insertCallCount = 0;
    const supabase = {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "s1" } } }) },
      from: (table: string) => {
        if (table === "topics") {
          return {
            select: (_c?: string) => ({
              eq: (_col: string, _val: unknown) => ({
                eq: (_c2: string, _v2: unknown) => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  limit: (_n: number) => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
                }),
                order: (_col2: string, _opts: unknown) => ({
                  limit: (_n: number) => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
                }),
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
            insert: (_row: unknown) => ({
              select: (_c?: string) => ({
                single: () => {
                  insertCallCount++;
                  return Promise.resolve({
                    data: null,
                    error: { code: "23505", message: "duplicate key value" },
                  });
                },
              }),
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) };
      },
    } as unknown;

    const result = await createTopic(supabase as Parameters<typeof createTopic>[0], {
      projectId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      name:      "Kamar Mandi",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("sudah ada");
    }
    expect(insertCallCount).toBe(1);
  });
});

// ─── moveCard: cross-project validation ──────────────────────────────────────

describe("moveCard", () => {
  it("returns 'Kolom tujuan tidak ditemukan' when topic is not found", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "topics") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          };
        }
        return {};
      },
    } as unknown;

    const result = await moveCard(supabase as Parameters<typeof moveCard>[0], {
      cardId:     "c3d4e5f6-a7b8-9012-cdef-123456789012",
      newTopicId: "d4e5f6a7-b8c9-0123-def0-234567890123",
      projectId:  "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Kolom tujuan tidak ditemukan");
    }
  });

  it("returns 'Kolom tujuan ada di proyek lain' when topic belongs to different project", async () => {
    const supabase = {
      from: (table: string) => {
        if (table === "topics") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: "d4e5f6a7-b8c9-0123-def0-234567890123", project_id: "different-project-id" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        return {};
      },
    } as unknown;

    const result = await moveCard(supabase as Parameters<typeof moveCard>[0], {
      cardId:     "c3d4e5f6-a7b8-9012-cdef-123456789012",
      newTopicId: "d4e5f6a7-b8c9-0123-def0-234567890123",
      projectId:  "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Kolom tujuan ada di proyek lain");
    }
  });

  it("succeeds when topic belongs to the same project", async () => {
    const projectId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const newTopicId = "d4e5f6a7-b8c9-0123-def0-234567890123";

    const supabase = {
      from: (table: string) => {
        if (table === "topics") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { id: newTopicId, project_id: projectId },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "cards") {
          return {
            update: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        }
        return {};
      },
    } as unknown;

    const result = await moveCard(supabase as Parameters<typeof moveCard>[0], {
      cardId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
      newTopicId,
      projectId,
    });

    expect(result.ok).toBe(true);
  });
});
