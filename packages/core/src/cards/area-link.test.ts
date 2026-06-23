import { describe, expect, it, vi } from "vitest";
import { AreaLinkInput, linkCardToArea, unlinkCardFromArea } from "./area-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

const UUID_CARD = "00000000-0000-0000-0000-000000000001";
const UUID_AREA = "00000000-0000-0000-0000-000000000002";
const UUID_PROJECT = "00000000-0000-0000-0000-000000000099";

// ─── AreaLinkInput schema ─────────────────────────────────────────────────────

describe("AreaLinkInput schema", () => {
  it("accepts valid uuids", () => {
    expect(() => AreaLinkInput.parse({ cardId: UUID_CARD, areaId: UUID_AREA })).not.toThrow();
  });

  it("rejects non-uuid cardId", () => {
    expect(() => AreaLinkInput.parse({ cardId: "not-a-uuid", areaId: UUID_AREA })).toThrow();
  });

  it("rejects non-uuid areaId", () => {
    expect(() => AreaLinkInput.parse({ cardId: UUID_CARD, areaId: "not-a-uuid" })).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() => AreaLinkInput.parse({ cardId: UUID_CARD })).toThrow();
  });
});

// ─── Mock supabase builder ────────────────────────────────────────────────────

function makeSupabaseMock(opts: {
  cardProjectId?: string | null;
  areaProjectId?: string | null;
  insertError?: { code: string; message: string } | null;
  deleteError?: { code: string; message: string } | null;
}) {
  const maybeSingle = vi.fn();
  let callCount = 0;

  // first call = cards query, second = areas query
  maybeSingle.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({
        data: opts.cardProjectId != null ? { project_id: opts.cardProjectId } : null,
        error: null,
      });
    }
    return Promise.resolve({
      data: opts.areaProjectId != null ? { project_id: opts.areaProjectId } : null,
      error: null,
    });
  });

  const insert = vi.fn().mockResolvedValue({ error: opts.insertError ?? null });
  const del = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: opts.deleteError ?? null }),
    }),
  });

  const from = vi.fn((table: string) => {
    if (table === "card_areas") {
      return {
        insert,
        delete: () => del(),
      };
    }
    // cards or areas table — return chainable .select().eq().maybeSingle()
    return {
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    };
  });

  return { from } as unknown as SupabaseClient<Database>;
}

// ─── linkCardToArea ───────────────────────────────────────────────────────────

describe("linkCardToArea", () => {
  it("returns { ok: true } on success", async () => {
    const supabase = makeSupabaseMock({
      cardProjectId: UUID_PROJECT,
      areaProjectId: UUID_PROJECT,
    });
    const result = await linkCardToArea(supabase, { cardId: UUID_CARD, areaId: UUID_AREA });
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false } for cross-project link", async () => {
    const supabase = makeSupabaseMock({
      cardProjectId: UUID_PROJECT,
      areaProjectId: "00000000-0000-0000-0000-000000000098",
    });
    const result = await linkCardToArea(supabase, { cardId: UUID_CARD, areaId: UUID_AREA });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(/sama/i);
  });

  it("returns { ok: true } on PK conflict (already linked)", async () => {
    const supabase = makeSupabaseMock({
      cardProjectId: UUID_PROJECT,
      areaProjectId: UUID_PROJECT,
      insertError: { code: "23505", message: "unique violation" },
    });
    const result = await linkCardToArea(supabase, { cardId: UUID_CARD, areaId: UUID_AREA });
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false } on DB error other than conflict", async () => {
    const supabase = makeSupabaseMock({
      cardProjectId: UUID_PROJECT,
      areaProjectId: UUID_PROJECT,
      insertError: { code: "42501", message: "permission denied" },
    });
    const result = await linkCardToArea(supabase, { cardId: UUID_CARD, areaId: UUID_AREA });
    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } for invalid input", async () => {
    const supabase = makeSupabaseMock({ cardProjectId: UUID_PROJECT, areaProjectId: UUID_PROJECT });
    const result = await linkCardToArea(supabase, { cardId: "bad", areaId: UUID_AREA });
    expect(result.ok).toBe(false);
  });
});

// ─── unlinkCardFromArea ───────────────────────────────────────────────────────

describe("unlinkCardFromArea", () => {
  it("returns { ok: true } on success", async () => {
    const supabase = makeSupabaseMock({});
    const result = await unlinkCardFromArea(supabase, { cardId: UUID_CARD, areaId: UUID_AREA });
    expect(result).toEqual({ ok: true });
  });

  it("returns { ok: false } on DB error", async () => {
    const supabase = makeSupabaseMock({
      deleteError: { code: "42501", message: "permission denied" },
    });
    const result = await unlinkCardFromArea(supabase, { cardId: UUID_CARD, areaId: UUID_AREA });
    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } for invalid input", async () => {
    const supabase = makeSupabaseMock({});
    const result = await unlinkCardFromArea(supabase, { cardId: "bad", areaId: UUID_AREA });
    expect(result.ok).toBe(false);
  });
});
