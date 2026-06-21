import { describe, expect, it } from "vitest";
import { CreateCardEventInput, createCardEvent } from "./create";

// ─── Schema validation ────────────────────────────────────────────────────────

describe("CreateCardEventInput schema", () => {
  const base = {
    cardId:          "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    projectId:       "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    eventKind:       "note" as const,
    payload:         { body: "catatan" },
    loggedByStaffId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  };

  it("accepts a valid input", () => {
    expect(CreateCardEventInput.safeParse(base).success).toBe(true);
  });

  it("accepts an optional occurredAt", () => {
    const result = CreateCardEventInput.safeParse({ ...base, occurredAt: "2026-06-01T00:00:00Z" });
    expect(result.success).toBe(true);
  });

  it("rejects missing cardId", () => {
    const { cardId: _, ...rest } = base;
    expect(CreateCardEventInput.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid eventKind", () => {
    expect(CreateCardEventInput.safeParse({ ...base, eventKind: "bogus" }).success).toBe(false);
  });

  it("rejects non-uuid loggedByStaffId", () => {
    expect(CreateCardEventInput.safeParse({ ...base, loggedByStaffId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects missing payload", () => {
    const { payload: _, ...rest } = base;
    expect(CreateCardEventInput.safeParse(rest).success).toBe(false);
  });
});

// ─── Mocked supabase ─────────────────────────────────────────────────────────

function makeInsertMock(overrides: { insertResult?: unknown } = {}) {
  const insertResult = overrides.insertResult ?? { data: { id: "event-uuid-001" }, error: null };
  return {
    from: (_table: string) => ({
      insert: (_row: unknown) => ({
        select: (_cols?: string) => ({
          single: () => Promise.resolve(insertResult),
        }),
      }),
    }),
  } as unknown;
}

describe("createCardEvent", () => {
  const validArgs = {
    cardId:          "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    projectId:       "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    eventKind:       "note" as const,
    payload:         { body: "test catatan" },
    loggedByStaffId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
  };

  it("returns eventId on success", async () => {
    const supabase = makeInsertMock();
    const result = await createCardEvent(
      supabase as Parameters<typeof createCardEvent>[0],
      validArgs,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventId).toBe("event-uuid-001");
  });

  it("returns error + fieldErrors for invalid payload", async () => {
    const supabase = makeInsertMock();
    // note requires body; empty object should fail schema validation.
    const result = await createCardEvent(
      supabase as Parameters<typeof createCardEvent>[0],
      { ...validArgs, payload: {} },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Isi data wajib");
      expect(result.fieldErrors).toBeDefined();
    }
  });

  it("returns error message on DB error", async () => {
    const supabase = makeInsertMock({
      insertResult: { data: null, error: { message: "duplicate key value" } },
    });
    const result = await createCardEvent(
      supabase as Parameters<typeof createCardEvent>[0],
      validArgs,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("duplicate key value");
  });

  it("sets cost_visible=true for vendor events", async () => {
    let insertedRow: Record<string, unknown> | undefined;
    const supabase = {
      from: (_table: string) => ({
        insert: (row: unknown) => {
          insertedRow = row as Record<string, unknown>;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "ev-vendor" }, error: null }),
            }),
          };
        },
      }),
    } as unknown;

    await createCardEvent(supabase as Parameters<typeof createCardEvent>[0], {
      ...validArgs,
      eventKind: "vendor",
      payload: { interaction: "quote", vendor_name: "PT Galleria" },
    });

    expect(insertedRow?.cost_visible).toBe(true);
  });

  it("sets cost_visible=false for non-vendor events", async () => {
    let insertedRow: Record<string, unknown> | undefined;
    const supabase = {
      from: (_table: string) => ({
        insert: (row: unknown) => {
          insertedRow = row as Record<string, unknown>;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "ev-note" }, error: null }),
            }),
          };
        },
      }),
    } as unknown;

    await createCardEvent(supabase as Parameters<typeof createCardEvent>[0], validArgs);
    expect(insertedRow?.cost_visible).toBe(false);
  });

  it("stamps source_kind=manual", async () => {
    let insertedRow: Record<string, unknown> | undefined;
    const supabase = {
      from: (_table: string) => ({
        insert: (row: unknown) => {
          insertedRow = row as Record<string, unknown>;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "ev-001" }, error: null }),
            }),
          };
        },
      }),
    } as unknown;

    await createCardEvent(supabase as Parameters<typeof createCardEvent>[0], validArgs);
    expect(insertedRow?.source_kind).toBe("manual");
  });
});
