import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { fetchRecentMessages, HISTORY_WINDOW } from "@/lib/assistant/audit";

/**
 * Fake client mirroring the `.select().eq().order().limit()` chain used by
 * fetchRecentMessages. Rows are handed back exactly as given (already in the
 * "most-recent-first" shape the real `.order("created_at", { ascending:
 * false })` query would return), so tests assert the .reverse() to
 * oldest-first happens in fetchRecentMessages itself.
 */
function fakeClient(rows: unknown[] | { error: unknown }) {
  const limit = vi.fn().mockResolvedValue(
    "error" in (rows as { error?: unknown })
      ? { data: null, error: (rows as { error: unknown }).error }
      : { data: rows, error: null },
  );
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, eq, order, limit };
}

describe("fetchRecentMessages", () => {
  it("returns [] without querying when sessionId is undefined (brand-new session)", async () => {
    const { client, from } = fakeClient([]);
    const result = await fetchRecentMessages(client, undefined);
    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("queries assistant_messages scoped to the session, limited to HISTORY_WINDOW, newest-first", async () => {
    const { client, from, eq, order, limit } = fakeClient([
      { role: "assistant", content: "a2" },
      { role: "user", content: "q2" },
    ]);
    await fetchRecentMessages(client, "session-1");
    expect(from).toHaveBeenCalledWith("assistant_messages");
    expect(eq).toHaveBeenCalledWith("session_id", "session-1");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(HISTORY_WINDOW);
  });

  it("reverses the newest-first query result back to oldest-first for replay", async () => {
    const { client } = fakeClient([
      { role: "assistant", content: "a2" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q1" },
    ]);
    const result = await fetchRecentMessages(client, "session-1");
    expect(result).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("degrades to [] on a read error rather than throwing", async () => {
    const { client } = fakeClient({ error: new Error("boom") });
    const result = await fetchRecentMessages(client, "session-1");
    expect(result).toEqual([]);
  });
});
