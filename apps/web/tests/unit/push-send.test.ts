/**
 * push-send.test.ts
 *
 * Unit tests for sendExpoPush (apps/web/lib/notifications/push-send.ts).
 *
 * Mocking strategy:
 *   - @/lib/supabase/admin  → mockCreateSupabaseAdminClient (returns a fake admin client)
 *   - server-only           → aliased to empty stub via vitest.config.ts
 *   - global fetch          → vi.stubGlobal("fetch", ...)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockAdminFrom, mockCreateSupabaseAdminClient } = vi.hoisted(() => {
  const mockAdminFrom = vi.fn();
  const mockAdminClient = { from: mockAdminFrom };
  const mockCreateSupabaseAdminClient = vi.fn().mockReturnValue(mockAdminClient);
  return { mockAdminFrom, mockCreateSupabaseAdminClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockCreateSupabaseAdminClient,
}));

// Import the unit under test AFTER mocks are hoisted.
import { sendExpoPush } from "@/lib/notifications/push-send";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a chainable Supabase .from().select().in() mock returning `rows`. */
function makeTokenQuery(tokens: string[], error: null | { message: string } = null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    in:     vi.fn().mockResolvedValue({ data: tokens.map((t) => ({ token: t })), error }),
  };
  mockAdminFrom.mockReturnValue(chain);
  return chain;
}

const PAYLOAD = { title: "Test title", body: "Test body", data: { link: "/project/abc" } };

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("sendExpoPush", () => {
  it("no-ops immediately when recipientStaffIds is empty", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await sendExpoPush([], PAYLOAD);

    // Admin client should never be touched — early return before any I/O.
    expect(mockCreateSupabaseAdminClient).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops when push_tokens query returns zero rows", async () => {
    makeTokenQuery([]); // no registered tokens
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await sendExpoPush(["staff-001"], PAYLOAD);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs correct Expo payload for a single token", async () => {
    makeTokenQuery(["ExponentPushToken[abc123]"]);

    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendExpoPush(["staff-001"], PAYLOAD);

    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string) as unknown[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      to:    "ExponentPushToken[abc123]",
      title: PAYLOAD.title,
      body:  PAYLOAD.body,
      sound: "default",
      data:  PAYLOAD.data,
    });
  });

  it("sends correct Expo payload for multiple tokens within a single chunk", async () => {
    makeTokenQuery(["ExponentPushToken[t1]", "ExponentPushToken[t2]", "ExponentPushToken[t3]"]);

    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendExpoPush(["staff-001", "staff-002", "staff-003"], PAYLOAD);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string) as unknown[];
    expect(body).toHaveLength(3);
    const tos = (body as Array<{ to: string }>).map((m) => m.to);
    expect(tos).toContain("ExponentPushToken[t1]");
    expect(tos).toContain("ExponentPushToken[t2]");
    expect(tos).toContain("ExponentPushToken[t3]");
  });

  it("splits >100 tokens into multiple chunked requests", async () => {
    // 150 tokens — should produce 2 fetch calls (100 + 50)
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[t${i}]`);
    makeTokenQuery(tokens);

    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendExpoPush(Array.from({ length: 150 }, (_, i) => `staff-${i}`), PAYLOAD);

    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstChunk = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as unknown[];
    const secondChunk = JSON.parse(
      (fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string,
    ) as unknown[];
    expect(firstChunk).toHaveLength(100);
    expect(secondChunk).toHaveLength(50);
  });

  it("does not throw when fetch rejects (network error)", async () => {
    makeTokenQuery(["ExponentPushToken[abc]"]);

    const fetchSpy = vi.fn().mockRejectedValue(new Error("network failure"));
    vi.stubGlobal("fetch", fetchSpy);

    // Must resolve cleanly — no throw
    await expect(sendExpoPush(["staff-001"], PAYLOAD)).resolves.toBeUndefined();
  });

  it("does not throw when the admin query errors", async () => {
    // Admin query returns an error
    const chain = {
      select: vi.fn().mockReturnThis(),
      in:     vi.fn().mockResolvedValue({ data: null, error: { message: "permission denied" } }),
    };
    mockAdminFrom.mockReturnValue(chain);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sendExpoPush(["staff-001"], PAYLOAD)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("omits the `data` field from the Expo message when none is provided", async () => {
    makeTokenQuery(["ExponentPushToken[x]"]);

    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await sendExpoPush(["staff-001"], { title: "T", body: "B" });

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Array<Record<string, unknown>>;
    expect(body[0]).not.toHaveProperty("data");
    expect(body[0]).toMatchObject({ to: "ExponentPushToken[x]", title: "T", body: "B", sound: "default" });
  });

  it("queries push_tokens with all supplied staff IDs", async () => {
    const chain = makeTokenQuery([]);
    vi.stubGlobal("fetch", vi.fn());

    await sendExpoPush(["staff-aaa", "staff-bbb"], PAYLOAD);

    expect(chain.in).toHaveBeenCalledWith("staff_id", ["staff-aaa", "staff-bbb"]);
  });
});
