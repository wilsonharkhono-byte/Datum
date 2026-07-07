import { describe, expect, it } from "vitest";
import { markGatePassed } from "@datum/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// Minimal fake Supabase builder covering markGatePassed's two chains:
//   1. from().select().eq().eq()            → awaited builder (thenable) → area cells
//   2. from().update().eq()x3.is().select().maybeSingle() → update result
type CellRow = { gate_code: string; status: string; actual_end_date: string | null; project_id: string };

function fakeSb(cells: CellRow[], updateData: { area_id: string } | null = { area_id: "a1" }) {
  const updates: unknown[] = [];
  function builder(): any {
    const b: any = {
      _op: "select",
      select: () => b,
      eq: () => b,
      is: () => b,
      update: (payload: unknown) => { b._op = "update"; updates.push(payload); return b; },
      upsert: () => Promise.resolve({ error: null }),
      maybeSingle: () =>
        Promise.resolve(
          b._op === "update"
            ? { data: updateData, error: null }
            : { data: cells[0] ?? null, error: null },
        ),
      then: (resolve: any, reject: any) =>
        Promise.resolve({ data: cells, error: null }).then(resolve, reject),
    };
    return b;
  }
  const client = { from: () => builder() } as unknown as SupabaseClient<Database>;
  return { client, updates };
}

const PID = "11111111-1111-1111-1111-111111111111";
const AID = "22222222-2222-2222-2222-222222222222";

function cell(gate: string, status: string, actualEnd: string | null = null): CellRow {
  return { gate_code: gate, status, actual_end_date: actualEnd, project_id: PID };
}

function pass(client: SupabaseClient<Database>, gateCode: "A" | "B" | "C") {
  return markGatePassed(client, "33333333-3333-3333-3333-333333333333", {
    projectId: PID,
    areaId: AID,
    gateCode,
  });
}

describe("markGatePassed — predecessor guard", () => {
  it("rejects passing C while B is still in_progress", async () => {
    const { client } = fakeSb([cell("B", "in_progress"), cell("C", "ready_for_handoff")]);
    const res = await pass(client, "C");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Gate B belum selesai");
  });

  it("rejects passing C when B has no row at all (counts as not started)", async () => {
    const { client } = fakeSb([cell("C", "ready_for_handoff")]);
    const res = await pass(client, "C");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Gate B belum selesai");
  });

  it("allows passing C when B is passed", async () => {
    const { client } = fakeSb([
      cell("A", "passed", "2026-07-01"),
      cell("B", "passed", "2026-07-02"),
      cell("C", "ready_for_handoff"),
    ]);
    const res = await pass(client, "C");
    expect(res.ok).toBe(true);
  });

  it("treats a wedged predecessor (actual_end_date set, status clobbered) as passed", async () => {
    const { client } = fakeSb([
      cell("A", "passed", "2026-07-01"),
      cell("B", "in_progress", "2026-07-02"), // wedged: date set, status computed
      cell("C", "ready_for_handoff"),
    ]);
    const res = await pass(client, "C");
    expect(res.ok).toBe(true);
  });

  it("skips a not_applicable predecessor and checks the one before it", async () => {
    const { client } = fakeSb([
      cell("A", "passed", "2026-07-01"),
      cell("B", "not_applicable"),
      cell("C", "ready_for_handoff"),
    ]);
    const res = await pass(client, "C");
    expect(res.ok).toBe(true);
  });

  it("rejects across a not_applicable gap when the earlier gate is not passed", async () => {
    const { client } = fakeSb([
      cell("A", "in_progress"),
      cell("B", "not_applicable"),
      cell("C", "ready_for_handoff"),
    ]);
    const res = await pass(client, "C");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Gate A belum selesai");
  });

  it("allows passing gate A (no predecessor)", async () => {
    const { client } = fakeSb([cell("A", "in_progress")]);
    const res = await pass(client, "A");
    expect(res.ok).toBe(true);
  });

  it("still rejects an already-passed cell before the predecessor walk", async () => {
    const { client } = fakeSb([cell("A", "passed", "2026-07-01")]);
    const res = await pass(client, "A");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("sudah ditandai selesai");
  });
});
