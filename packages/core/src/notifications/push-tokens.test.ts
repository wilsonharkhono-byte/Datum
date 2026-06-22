import { describe, it, expect, vi } from "vitest";
import { upsertPushToken, UpsertPushTokenInput } from "./push-tokens";

// ─── Mock builder ─────────────────────────────────────────────────────────────

function makeSupa({
  userId,
  upsertError,
}: {
  userId: string | null;
  upsertError?: { message: string } | null;
}) {
  const upsertMock = vi.fn().mockResolvedValue({ error: upsertError ?? null });
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        userId
          ? { data: { user: { id: userId } }, error: null }
          : { data: { user: null }, error: { message: "Not authenticated" } },
      ),
    },
    from: fromMock,
    _mocks: { upsertMock, fromMock },
  };
  return client;
}

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe("UpsertPushTokenInput schema", () => {
  it("accepts valid ios input", () => {
    expect(
      UpsertPushTokenInput.safeParse({ token: "ExponentPushToken[xxx]", platform: "ios" }).success,
    ).toBe(true);
  });

  it("accepts optional deviceName", () => {
    expect(
      UpsertPushTokenInput.safeParse({
        token: "ExponentPushToken[xxx]",
        platform: "android",
        deviceName: "Pixel 7",
      }).success,
    ).toBe(true);
  });

  it("rejects empty token", () => {
    expect(
      UpsertPushTokenInput.safeParse({ token: "", platform: "ios" }).success,
    ).toBe(false);
  });

  it("rejects unknown platform", () => {
    expect(
      UpsertPushTokenInput.safeParse({ token: "tok", platform: "desktop" }).success,
    ).toBe(false);
  });
});

// ─── upsertPushToken tests ────────────────────────────────────────────────────

describe("upsertPushToken — unauthenticated", () => {
  it("returns ok:false when there is no user", async () => {
    const supa = makeSupa({ userId: null });
    const result = await upsertPushToken(supa as never, {
      token: "ExponentPushToken[abc]",
      platform: "ios",
    });
    expect(result).toEqual({ ok: false, error: "Not authenticated" });
    expect(supa.from).not.toHaveBeenCalled();
  });
});

describe("upsertPushToken — happy path", () => {
  it("returns ok:true and calls upsert with correct payload", async () => {
    const supa = makeSupa({ userId: "staff-uuid-123" });
    const result = await upsertPushToken(supa as never, {
      token: "ExponentPushToken[abc]",
      platform: "ios",
      deviceName: "iPhone 15 Pro",
    });
    expect(result).toEqual({ ok: true });

    expect(supa.from).toHaveBeenCalledWith("push_tokens");
    const { upsertMock } = supa._mocks;
    expect(upsertMock).toHaveBeenCalledOnce();
    const [payload, opts] = upsertMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(payload).toMatchObject({
      staff_id: "staff-uuid-123",
      token: "ExponentPushToken[abc]",
      platform: "ios",
      device_name: "iPhone 15 Pro",
    });
    expect(payload["last_seen_at"]).toBeTruthy();
    expect(opts).toEqual({ onConflict: "token" });
  });
});

describe("upsertPushToken — DB error", () => {
  it("returns ok:false with DB error message", async () => {
    const supa = makeSupa({ userId: "staff-uuid-123", upsertError: { message: "RLS violation" } });
    const result = await upsertPushToken(supa as never, {
      token: "ExponentPushToken[abc]",
      platform: "android",
    });
    expect(result).toEqual({ ok: false, error: "RLS violation" });
  });
});
