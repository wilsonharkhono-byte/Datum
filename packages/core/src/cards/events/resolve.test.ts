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

  it("accepts an optional outcome, empty allowed", () => {
    expect(ResolveEventInput.safeParse({ ...base, outcome: "pakai marmer putih" }).success).toBe(true);
    expect(ResolveEventInput.safeParse({ ...base, outcome: "" }).success).toBe(true);
    expect(ResolveEventInput.safeParse(base).success).toBe(true); // omitted entirely
  });

  it("rejects outcome longer than 500 chars", () => {
    const long = "x".repeat(501);
    expect(ResolveEventInput.safeParse({ ...base, outcome: long }).success).toBe(false);
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

  it("passes the reason through to the rpc's p_reason param", async () => {
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

  // Fix 3 rework: resolve_card_event has no p_outcome param (that would need
  // a migration). `outcome` instead rides the RPC's existing p_reason param,
  // prefixed "Keputusan: " so getDecisionOutcomesByCardEvent can read it back
  // out of record_revisions.reason for the timeline.
  it("folds the outcome into p_reason with a 'Keputusan: ' prefix, and sends no p_outcome arg", async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: (_fn: string, args: unknown) => {
        calls.push(args);
        return Promise.resolve({ error: null });
      },
    } as unknown;

    await resolveCardEvent(
      supabase as Parameters<typeof resolveCardEvent>[0],
      { eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", newStatus: "decided", outcome: "pakai marmer putih" },
    );

    const args = calls[0] as Record<string, unknown>;
    expect(args.p_reason).toBe("Keputusan: pakai marmer putih");
    expect("p_outcome" in args).toBe(false);
  });

  it("combines outcome and reason when both are supplied, decision line first", async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: (_fn: string, args: unknown) => {
        calls.push(args);
        return Promise.resolve({ error: null });
      },
    } as unknown;

    await resolveCardEvent(
      supabase as Parameters<typeof resolveCardEvent>[0],
      {
        eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        newStatus: "decided",
        outcome: "pakai marmer putih",
        reason: "klien sudah setuju",
      },
    );

    const args = calls[0] as Record<string, unknown>;
    expect(args.p_reason).toBe("Keputusan: pakai marmer putih — klien sudah setuju");
  });

  it("trims whitespace and omits p_reason entirely when outcome/reason are blank", async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: (_fn: string, args: unknown) => {
        calls.push(args);
        return Promise.resolve({ error: null });
      },
    } as unknown;

    await resolveCardEvent(
      supabase as Parameters<typeof resolveCardEvent>[0],
      { eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", newStatus: "decided", outcome: "   ", reason: "" },
    );

    const args = calls[0] as Record<string, unknown>;
    expect(args.p_reason).toBeUndefined();
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
