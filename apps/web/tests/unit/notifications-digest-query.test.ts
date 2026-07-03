/**
 * getTodaysDigestCandidates — Phase 3 Task 5 (completes T4's deferred /brief
 * wiring). Narrow query-layer test: verifies the filters sent to Supabase
 * (kind/link/date window) and that it degrades to [] on error rather than
 * throwing (best-effort, matches this codebase's other retrieval degrade
 * patterns) and passes through the caller-supplied (RLS-scoped) client.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { getTodaysDigestCandidates } from "@/lib/notifications/queries";

type Call = { fn: string; args: unknown[] };

function fakeClient(
  result: { data: unknown; error: unknown },
  opts?: { onFrom?: (table: string) => void; onCall?: (calls: Call[]) => void },
): SupabaseClient<Database> {
  return {
    from(table: string) {
      opts?.onFrom?.(table);
      const calls: Call[] = [];
      const chain = ["select", "eq", "gte", "lt", "order"];
      const builder: any = {};
      for (const fn of chain) {
        builder[fn] = (...args: unknown[]) => {
          calls.push({ fn, args });
          return builder;
        };
      }
      builder.then = (res: (v: unknown) => void) => {
        opts?.onCall?.(calls);
        return res(result);
      };
      Object.defineProperty(builder, Symbol.toStringTag, { value: "Promise" });
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

const TODAY_START = "2026-07-01T17:00:00.000Z";
const TOMORROW_START = "2026-07-02T17:00:00.000Z";

describe("getTodaysDigestCandidates", () => {
  it("queries the caller-supplied (RLS-scoped) client — never a hardcoded admin client", async () => {
    let seenTable = "";
    const supa = fakeClient({ data: [], error: null }, { onFrom: (t) => (seenTable = t) });
    await getTodaysDigestCandidates(supa, TODAY_START, TOMORROW_START);
    expect(seenTable).toBe("notifications");
  });

  it("filters by kind=readiness_reminder, link=/brief, and the given day window", async () => {
    let calls: Call[] = [];
    const supa = fakeClient({ data: [], error: null }, { onCall: (c) => (calls = c) });
    await getTodaysDigestCandidates(supa, TODAY_START, TOMORROW_START);

    expect(calls).toContainEqual({ fn: "eq", args: ["kind", "readiness_reminder"] });
    expect(calls).toContainEqual({ fn: "eq", args: ["link", "/brief"] });
    expect(calls).toContainEqual({ fn: "gte", args: ["created_at", TODAY_START] });
    expect(calls).toContainEqual({ fn: "lt", args: ["created_at", TOMORROW_START] });
  });

  it("returns the rows on success", async () => {
    const rows = [
      { kind: "readiness_reminder", link: "/brief", summary: "Pagi Rani…", read_at: null, created_at: TODAY_START },
    ];
    const supa = fakeClient({ data: rows, error: null });
    const result = await getTodaysDigestCandidates(supa, TODAY_START, TOMORROW_START);
    expect(result).toEqual(rows);
  });

  it("degrades to an empty array on a query error (best-effort, never throws)", async () => {
    const supa = fakeClient({ data: null, error: { message: "boom" } });
    const result = await getTodaysDigestCandidates(supa, TODAY_START, TOMORROW_START);
    expect(result).toEqual([]);
  });

  it("degrades to an empty array when data is null without an explicit error", async () => {
    const supa = fakeClient({ data: null, error: null });
    const result = await getTodaysDigestCandidates(supa, TODAY_START, TOMORROW_START);
    expect(result).toEqual([]);
  });
});
