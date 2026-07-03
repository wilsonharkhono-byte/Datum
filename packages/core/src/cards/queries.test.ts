import { describe, expect, it } from "vitest";
import { getDecisionOutcomesByCardEvent } from "./queries";

// ─── getDecisionOutcomesByCardEvent ────────────────────────────────────────────
//
// Fix 3 rework: decision outcome capture reads record_revisions.reason back
// out (written by resolve_card_event's unmodified p_reason param — see
// cards/events/resolve.ts combineReasonAndOutcome) rather than a new RPC
// param, so it needs no migration. These tests exercise the read side: the
// query filter shape and the "Keputusan: " prefix parsing.

type RevisionRow = { entity_id: string; reason: string | null; created_at: string };

/** Minimal chainable mock matching exactly the .from().select().eq().eq()
 *  .in().not().order() shape getDecisionOutcomesByCardEvent issues. */
function makeSupabaseMock(rows: RevisionRow[], error: { message: string } | null = null) {
  const calls: { table?: string; eqCalls: [string, unknown][]; inCol?: string; inVals?: unknown[] } = {
    eqCalls: [],
  };
  return {
    mock: {
      from: (table: string) => {
        calls.table = table;
        return {
          select: (_cols: string) => ({
            eq: (col: string, val: unknown) => {
              calls.eqCalls.push([col, val]);
              return {
                eq: (col2: string, val2: unknown) => {
                  calls.eqCalls.push([col2, val2]);
                  return {
                    in: (col3: string, vals: unknown[]) => {
                      calls.inCol = col3;
                      calls.inVals = vals;
                      return {
                        not: (_col4: string, _op: string, _val4: unknown) => ({
                          order: (_col5: string, _opts: unknown) =>
                            Promise.resolve(error ? { data: null, error } : { data: rows, error: null }),
                        }),
                      };
                    },
                  };
                },
              };
            },
          }),
        };
      },
    } as unknown,
    calls,
  };
}

describe("getDecisionOutcomesByCardEvent", () => {
  it("returns an empty map without querying when cardEventIds is empty", async () => {
    const { mock } = makeSupabaseMock([]);
    const result = await getDecisionOutcomesByCardEvent(
      mock as Parameters<typeof getDecisionOutcomesByCardEvent>[0],
      [],
    );
    expect(result.size).toBe(0);
  });

  it("filters to card_event / corrected revisions with a non-null reason, scoped to the given event ids", async () => {
    const { mock, calls } = makeSupabaseMock([
      { entity_id: "ev-1", reason: "Keputusan: pakai marmer putih", created_at: "2026-07-01T00:00:00Z" },
    ]);
    await getDecisionOutcomesByCardEvent(
      mock as Parameters<typeof getDecisionOutcomesByCardEvent>[0],
      ["ev-1", "ev-2"],
    );
    expect(calls.table).toBe("record_revisions");
    expect(calls.eqCalls).toContainEqual(["entity_type", "card_event"]);
    expect(calls.eqCalls).toContainEqual(["revision_type", "corrected"]);
    expect(calls.inCol).toBe("entity_id");
    expect(calls.inVals).toEqual(["ev-1", "ev-2"]);
  });

  it("extracts the outcome text from a 'Keputusan: ' prefixed reason", async () => {
    const { mock } = makeSupabaseMock([
      { entity_id: "ev-1", reason: "Keputusan: pakai marmer putih", created_at: "2026-07-01T00:00:00Z" },
    ]);
    const result = await getDecisionOutcomesByCardEvent(
      mock as Parameters<typeof getDecisionOutcomesByCardEvent>[0],
      ["ev-1"],
    );
    expect(result.get("ev-1")).toBe("pakai marmer putih");
  });

  it("takes only the decision part when reason combines outcome and a caller reason", async () => {
    const { mock } = makeSupabaseMock([
      {
        entity_id: "ev-1",
        reason: "Keputusan: pakai marmer putih — klien sudah setuju",
        created_at: "2026-07-01T00:00:00Z",
      },
    ]);
    const result = await getDecisionOutcomesByCardEvent(
      mock as Parameters<typeof getDecisionOutcomesByCardEvent>[0],
      ["ev-1"],
    );
    expect(result.get("ev-1")).toBe("pakai marmer putih");
  });

  it("skips revisions whose reason has no 'Keputusan: ' prefix (plain reasons)", async () => {
    const { mock } = makeSupabaseMock([
      { entity_id: "ev-1", reason: "sudah dijawab", created_at: "2026-07-01T00:00:00Z" },
    ]);
    const result = await getDecisionOutcomesByCardEvent(
      mock as Parameters<typeof getDecisionOutcomesByCardEvent>[0],
      ["ev-1"],
    );
    expect(result.has("ev-1")).toBe(false);
  });

  it("keeps the latest outcome when an event was resolved more than once", async () => {
    const { mock } = makeSupabaseMock([
      { entity_id: "ev-1", reason: "Keputusan: opsi A", created_at: "2026-07-01T00:00:00Z" },
      { entity_id: "ev-1", reason: "Keputusan: opsi B (revisi)", created_at: "2026-07-02T00:00:00Z" },
    ]);
    const result = await getDecisionOutcomesByCardEvent(
      mock as Parameters<typeof getDecisionOutcomesByCardEvent>[0],
      ["ev-1"],
    );
    expect(result.get("ev-1")).toBe("opsi B (revisi)");
  });

  it("throws when the query errors", async () => {
    const { mock } = makeSupabaseMock([], { message: "permission denied" });
    await expect(
      getDecisionOutcomesByCardEvent(mock as Parameters<typeof getDecisionOutcomesByCardEvent>[0], ["ev-1"]),
    ).rejects.toMatchObject({ message: "permission denied" });
  });
});
