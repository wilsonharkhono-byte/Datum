import { describe, expect, it } from "vitest";
import { recomputeProjectGates } from "@datum/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// Table-aware fake covering recomputeProjectGates' chains:
//   areas:            from().select().eq()                    → thenable
//   card_areas:       from().select().eq()                    → thenable
//   area_gate_status: from().select().eq().not()              → thenable (sticky read)
//                     from().update().eq()x3.is().select()    → thenable (guarded update)
//                     from().upsert(payload, opts)            → promise
function fakeSb(cfg: {
  areas: { id: string }[];
  sticky: { area_id: string; gate_code: string }[];
  /** rows "affected" by the guarded update — [] simulates a pass landing mid-recompute (or a missing row) */
  updateRows: { area_id: string }[];
}) {
  const upserts: { payload: any; opts: any }[] = [];
  const updates: any[] = [];
  function builder(table: string): any {
    const b: any = {
      _op: "select",
      select: () => b,
      eq: () => b,
      is: () => b,
      not: () => b,
      in: () => b,
      update: (payload: any) => { b._op = "update"; updates.push(payload); return b; },
      upsert: (payload: any, opts: any) => {
        upserts.push({ payload, opts });
        return Promise.resolve({ error: null });
      },
      then: (resolve: any, reject: any) => {
        let data: unknown;
        if (b._op === "update") data = cfg.updateRows;
        else if (table === "areas") data = cfg.areas;
        else if (table === "card_areas") data = [];
        else data = cfg.sticky; // area_gate_status sticky read
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  const client = {
    from: (table: string) => builder(table),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
  } as unknown as SupabaseClient<Database>;
  return { client, upserts, updates };
}

const PID = "11111111-1111-1111-1111-111111111111";

describe("recomputeProjectGates — pass-clobber guard", () => {
  it("writes status='passed' for sticky cells (self-heals a wedged cell)", async () => {
    const { client, upserts } = fakeSb({
      areas: [{ id: "a1" }],
      sticky: [{ area_id: "a1", gate_code: "A" }],
      updateRows: [{ area_id: "a1" }],
    });
    const res = await recomputeProjectGates(client, PID, "BDG-H1");
    expect(res.ok).toBe(true);
    // The sticky cell's write is an upsert that pins status back to 'passed'
    // and never carries blocking_reason.
    const stickyUpsert = upserts.find((u) => u.payload.gate_code === "A");
    expect(stickyUpsert).toBeDefined();
    expect(stickyUpsert!.payload.status).toBe("passed");
    expect("blocking_reason" in stickyUpsert!.payload).toBe(false);
  });

  it("routes non-sticky cells through the guarded update (actual_end_date IS NULL)", async () => {
    const { client, upserts, updates } = fakeSb({
      areas: [{ id: "a1" }],
      sticky: [],
      updateRows: [{ area_id: "a1" }], // update matched → no fallback needed
    });
    const res = await recomputeProjectGates(client, PID, "BDG-H1");
    expect(res.ok).toBe(true);
    expect(updates.length).toBeGreaterThan(0); // all 8 gates via guarded update
    expect(upserts.length).toBe(0); // no fallback inserts
  });

  it("falls back to insert-only upsert (ignoreDuplicates) when the guarded update matches nothing", async () => {
    const { client, upserts } = fakeSb({
      areas: [{ id: "a1" }],
      sticky: [],
      updateRows: [], // row missing OR a pass landed mid-recompute
    });
    const res = await recomputeProjectGates(client, PID, "BDG-H1");
    expect(res.ok).toBe(true);
    expect(upserts.length).toBeGreaterThan(0);
    for (const u of upserts) {
      // ignoreDuplicates means an existing (just-passed) row is left untouched
      // — the mid-recompute pass can no longer be clobbered.
      expect(u.opts.ignoreDuplicates).toBe(true);
    }
  });
});
