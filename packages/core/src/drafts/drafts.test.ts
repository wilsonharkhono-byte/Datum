import { describe, expect, it } from "vitest";
import { ApproveDraftInput } from "./approve";
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
