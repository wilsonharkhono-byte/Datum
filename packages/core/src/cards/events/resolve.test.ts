import { describe, expect, it } from "vitest";
import { ResolveEventInput, resolveCardEvent } from "./resolve";

// ─── Schema validation ────────────────────────────────────────────────────────

describe("ResolveEventInput schema", () => {
  const base = {
    eventId:   "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    newStatus: "decided" as const,
  };

  it("accepts a valid input without reason", () => {
    expect(ResolveEventInput.safeParse(base).success).toBe(true);
  });

  it("accepts all valid status values", () => {
    const statuses = ["needs_decision", "decided", "superseded", "open", "answered"] as const;
    for (const newStatus of statuses) {
      expect(ResolveEventInput.safeParse({ ...base, newStatus }).success).toBe(true);
    }
  });

  it("accepts an optional reason", () => {
    expect(ResolveEventInput.safeParse({ ...base, reason: "klien sudah setuju" }).success).toBe(true);
  });

  it("rejects invalid newStatus", () => {
    expect(ResolveEventInput.safeParse({ ...base, newStatus: "maybe" }).success).toBe(false);
  });

  it("rejects non-uuid eventId", () => {
    expect(ResolveEventInput.safeParse({ ...base, eventId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects reason longer than 500 chars", () => {
    const long = "x".repeat(501);
    expect(ResolveEventInput.safeParse({ ...base, reason: long }).success).toBe(false);
  });
});

// ─── Mocked supabase ─────────────────────────────────────────────────────────

describe("resolveCardEvent", () => {
  it("calls resolve_card_event rpc and returns ok:true", async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: (_fn: string, args: unknown) => {
        calls.push(args);
        return Promise.resolve({ error: null });
      },
    } as unknown;

    const result = await resolveCardEvent(
      supabase as Parameters<typeof resolveCardEvent>[0],
      { eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", newStatus: "decided" },
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const args = calls[0] as Record<string, unknown>;
    expect(args.p_event_id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(args.p_new_status).toBe("decided");
  });

  it("passes the reason through to the rpc", async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: (_fn: string, args: unknown) => {
        calls.push(args);
        return Promise.resolve({ error: null });
      },
    } as unknown;

    await resolveCardEvent(
      supabase as Parameters<typeof resolveCardEvent>[0],
      { eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", newStatus: "answered", reason: "sudah dijawab" },
    );

    const args = calls[0] as Record<string, unknown>;
    expect(args.p_reason).toBe("sudah dijawab");
  });

  it("returns ok:false with the rpc error message", async () => {
    const supabase = {
      rpc: () => Promise.resolve({ error: { message: "permission denied" } }),
    } as unknown;

    const result = await resolveCardEvent(
      supabase as Parameters<typeof resolveCardEvent>[0],
      { eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", newStatus: "decided" },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("permission denied");
  });
});
