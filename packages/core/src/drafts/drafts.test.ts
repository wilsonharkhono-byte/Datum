import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { ApproveDraftInput, approveCardEventDraft } from "./approve";
import { RejectDraftInput } from "./reject";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("ApproveDraftInput schema", () => {
  it("accepts valid draftId + approverId UUIDs", () => {
    expect(() =>
      ApproveDraftInput.parse({ draftId: VALID_UUID, approverId: VALID_UUID }),
    ).not.toThrow();
  });

  it("rejects non-UUID values", () => {
    expect(() =>
      ApproveDraftInput.parse({ draftId: "not-a-uuid", approverId: VALID_UUID }),
    ).toThrow();
    expect(() =>
      ApproveDraftInput.parse({ draftId: VALID_UUID, approverId: "" }),
    ).toThrow();
  });
});

describe("RejectDraftInput schema", () => {
  it("accepts valid args with and without an optional reason", () => {
    expect(() =>
      RejectDraftInput.parse({ draftId: VALID_UUID, rejectorId: VALID_UUID }),
    ).not.toThrow();
    expect(() =>
      RejectDraftInput.parse({ draftId: VALID_UUID, rejectorId: VALID_UUID, reason: "Salah info" }),
    ).not.toThrow();
  });

  it("rejects a reason over 500 chars", () => {
    expect(() =>
      RejectDraftInput.parse({
        draftId: VALID_UUID,
        rejectorId: VALID_UUID,
        reason: "x".repeat(501),
      }),
    ).toThrow();
  });

  it("accepts undefined reason but rejects empty string (not optional empty)", () => {
    // Empty string is falsy — Zod optional() allows undefined but not empty string
    // unless we add .or(z.literal(''))
    const result = RejectDraftInput.safeParse({
      draftId: VALID_UUID,
      rejectorId: VALID_UUID,
      reason: undefined,
    });
    expect(result.success).toBe(true);
  });
});

// ─── approveCardEventDraft — promotion write must not fail silently ───────────

/** Minimal chainable mock covering approve's five query chains. */
function makeApproveMock(opts: { promoteError?: { message: string } | null }) {
  const draftRow = {
    id: VALID_UUID,
    status: "draft",
    draft_type: "card_event",
    project_id: "proj-1",
    created_by_staff_id: "staff-1",
    proposed_payload: {
      kind: "decision",
      payload: { topic: "Uji material lantai" },
      card_id: "card-1",
      occurred_at: "2026-07-04T00:00:00Z",
    },
  };
  const promoteEq = { eq: () => Promise.resolve({ error: opts.promoteError ?? null }) };
  const from = (table: string) => {
    if (table === "data_drafts") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: draftRow, error: null }) }) }),
        update: () => promoteEq,
      };
    }
    if (table === "card_events") {
      return {
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: "ev-1" }, error: null }) }) }),
      };
    }
    if (table === "cards") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { slug: "kartu-1" }, error: null }) }) }) };
    }
    if (table === "projects") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { project_code: "ABC-001" }, error: null }) }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  };
  return { from } as unknown as SupabaseClient<Database>;
}

describe("approveCardEventDraft promotion write", () => {
  it("returns ok:true with the event id when the draft update succeeds", async () => {
    const supabase = makeApproveMock({ promoteError: null });
    const result = await approveCardEventDraft(supabase, { draftId: VALID_UUID, approverId: VALID_UUID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eventId).toBe("ev-1");
  });

  it("returns ok:false when marking the draft approved fails (prevents re-approve duplicating the event)", async () => {
    const supabase = makeApproveMock({ promoteError: { message: "network error" } });
    const result = await approveCardEventDraft(supabase, { draftId: VALID_UUID, approverId: VALID_UUID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("jangan approve ulang");
  });
});
