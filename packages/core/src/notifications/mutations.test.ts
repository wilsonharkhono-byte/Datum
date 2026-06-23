import { describe, it, expect, vi } from "vitest";
import { markNotificationRead, markAllNotificationsRead, MarkReadInput } from "./mutations";

// Minimal mock supabase client
function makeSupa(error: null | { message: string } = null) {
  const chain = {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ error }),
    is: vi.fn().mockResolvedValue({ error }),
  };
  return {
    from: vi.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

describe("MarkReadInput schema", () => {
  it("accepts a valid uuid", () => {
    const result = MarkReadInput.safeParse({ notificationId: "550e8400-e29b-41d4-a716-446655440000" });
    expect(result.success).toBe(true);
  });

  it("rejects a non-uuid string", () => {
    const result = MarkReadInput.safeParse({ notificationId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects missing notificationId", () => {
    const result = MarkReadInput.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("markNotificationRead", () => {
  it("returns ok:true on success", async () => {
    const supa = makeSupa(null);
    const result = await markNotificationRead(supa as never, "550e8400-e29b-41d4-a716-446655440000");
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false with error message on DB error", async () => {
    const supa = makeSupa({ message: "not found" });
    const result = await markNotificationRead(supa as never, "550e8400-e29b-41d4-a716-446655440000");
    expect(result).toEqual({ ok: false, error: "not found" });
  });
});

describe("markAllNotificationsRead", () => {
  it("returns ok:true on success", async () => {
    const supa = makeSupa(null);
    const result = await markAllNotificationsRead(supa as never);
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false with error message on DB error", async () => {
    const supa = makeSupa({ message: "RLS violation" });
    const result = await markAllNotificationsRead(supa as never);
    expect(result).toEqual({ ok: false, error: "RLS violation" });
  });
});
