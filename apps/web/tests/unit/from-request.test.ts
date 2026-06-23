import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() runs at hoist time (before imports), so mock variables are
// available inside the vi.mock factories which are also hoisted.
const { mockCreateClient, mockCookieClient, mockCreateSupabaseServerClient } = vi.hoisted(() => {
  const mockCookieClient = { auth: { getUser: vi.fn() }, isCookieClient: true as const };
  const mockCreateSupabaseServerClient = vi.fn().mockResolvedValue(mockCookieClient);
  const mockCreateClient = vi.fn();
  return { mockCreateClient, mockCookieClient, mockCreateSupabaseServerClient };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mockCreateSupabaseServerClient,
}));

// Import AFTER mocks are registered.
import { createSupabaseClientForRequest } from "@/lib/supabase/from-request";

const URL_ENV = "https://example.supabase.co";
const ANON_KEY_ENV = "anon-key-test";

beforeEach(() => {
  vi.clearAllMocks();
  // Restore resolved value after clearAllMocks (clearAllMocks resets implementations).
  mockCreateSupabaseServerClient.mockResolvedValue(mockCookieClient);
  // Provide env vars so the module can read them.
  process.env.NEXT_PUBLIC_SUPABASE_URL = URL_ENV;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY_ENV;
  // createClient should return a fake client object.
  mockCreateClient.mockReturnValue({ auth: {}, isBearerClient: true as const });
});

describe("createSupabaseClientForRequest", () => {
  it("(a) Bearer header — calls createClient with anon key + Authorization header", async () => {
    const token = "test-access-token-xyz";
    const req = new Request("https://example.com/api/test", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const client = await createSupabaseClientForRequest(req);

    expect(mockCreateClient).toHaveBeenCalledOnce();
    const call = mockCreateClient.mock.calls[0] as [
      string,
      string,
      { global?: { headers?: Record<string, string> } },
    ];
    const [url, key, options] = call;
    expect(url).toBe(URL_ENV);
    expect(key).toBe(ANON_KEY_ENV);
    expect(options?.global?.headers?.Authorization).toBe(`Bearer ${token}`);

    // Did NOT fall back to the cookie client.
    expect(mockCreateSupabaseServerClient).not.toHaveBeenCalled();
    expect(client).toEqual({ auth: {}, isBearerClient: true });
  });

  it("(b) No auth header — falls back to createSupabaseServerClient (cookie client)", async () => {
    const req = new Request("https://example.com/api/test");

    const client = await createSupabaseClientForRequest(req);

    expect(mockCreateSupabaseServerClient).toHaveBeenCalledOnce();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(client).toBe(mockCookieClient);
  });

  it("non-Bearer Authorization header also falls back to cookie client", async () => {
    const req = new Request("https://example.com/api/test", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });

    await createSupabaseClientForRequest(req);

    expect(mockCreateSupabaseServerClient).toHaveBeenCalledOnce();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("Authorization: 'Bearer' with no token falls back to cookie client (Headers API trims trailing space)", async () => {
    // The Headers API trims "Bearer " → "Bearer", which does not start with
    // "Bearer " (with space), so the helper correctly falls back to the cookie
    // client rather than calling createClient with an empty token.
    const req = new Request("https://example.com/api/test", {
      headers: { Authorization: "Bearer " },
    });

    await createSupabaseClientForRequest(req);

    expect(mockCreateSupabaseServerClient).toHaveBeenCalledOnce();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
