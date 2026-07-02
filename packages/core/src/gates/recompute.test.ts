import { describe, it, expect, vi } from "vitest";
import { GateCodes } from "@datum/types";
import { recomputeProjectGates } from "./recompute";

// ─── Mock builder ─────────────────────────────────────────────────────────────
//
// Mirrors recomputeProjectGates's read sequence:
//   1. areas (select id, eq project_id)
//   2. card_areas (select card_id/area_id/cards!inner, eq cards.project_id)
//   3. card_events (select *, in card_id)   — only if there are linked cards
//   4. area_gate_status (select area_id/gate_code, eq project_id, eq status
//      'passed', not actual_end_date null)  — sticky-passed lookup
//   5. area_gate_status upsert(rows, onConflict)  — the bulk write under test
//
// Task 6.5: this must be exactly ONE upsert call carrying all
// areas.length * GateCodes.length rows, not one upsert per cell.

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PROJECT_CODE = "BDG-H1";

function makeSupa(opts: {
  areaIds: string[];
  cardAreas?: Array<{ card_id: string; area_id: string }>;
  cardEvents?: Array<Record<string, unknown>>;
  stickyPassed?: Array<{ area_id: string; gate_code: string }>;
  upsertError?: { message: string } | null;
}) {
  const upsertCalls: Array<{ rows: unknown; options: unknown }> = [];
  const upsertMock = vi.fn((rows: unknown, options: unknown) => {
    upsertCalls.push({ rows, options });
    return Promise.resolve({ error: opts.upsertError ?? null });
  });

  const fromMock = vi.fn((table: string) => {
    if (table === "areas") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: opts.areaIds.map((id) => ({ id })), error: null }),
        }),
      };
    }
    if (table === "card_areas") {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: opts.cardAreas ?? [], error: null }),
        }),
      };
    }
    if (table === "card_events") {
      return {
        select: () => ({
          in: () => Promise.resolve({ data: opts.cardEvents ?? [], error: null }),
        }),
      };
    }
    if (table === "area_gate_status") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              not: () => Promise.resolve({ data: opts.stickyPassed ?? [], error: null }),
            }),
          }),
        }),
        upsert: upsertMock,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });

  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "staff-1" } } }) },
    from: fromMock,
    _mocks: { fromMock, upsertMock, upsertCalls },
  };
  return client as any;
}

function workEvent(cardId: string, status: string, id = crypto.randomUUID()) {
  return {
    id,
    card_id: cardId,
    project_id: PROJECT_ID,
    event_kind: "work",
    payload: { status },
    occurred_at: "2026-06-01T00:00:00Z",
    created_at: "2026-06-01T00:00:00Z",
    logged_by_staff_id: null,
    source_kind: "manual",
    source_id: null,
    cost_visible: false,
    draft_id: null,
    search_text: null,
    ai_step_status: "pending",
    ai_step_error: null,
    ai_step_attempts: 0,
    ai_step_processed_at: null,
  };
}

describe("recomputeProjectGates — bulk upsert (Task 6.5)", () => {
  it("issues exactly ONE upsert call carrying all area x gate rows", async () => {
    const supa = makeSupa({
      areaIds: ["area-1", "area-2"],
      cardAreas: [{ card_id: "card-1", area_id: "area-1" }, { card_id: "card-2", area_id: "area-2" }],
      cardEvents: [workEvent("card-1", "done"), workEvent("card-2", "in_progress")],
    });

    const result = await recomputeProjectGates(supa, PROJECT_ID, PROJECT_CODE, { skipAuthCheck: true });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.cellsUpdated).toBe(2 * GateCodes.length);

    expect(supa._mocks.upsertMock).toHaveBeenCalledTimes(1);
    const [{ rows, options }] = supa._mocks.upsertCalls;
    expect(Array.isArray(rows)).toBe(true);
    expect((rows as unknown[]).length).toBe(2 * GateCodes.length);
    expect(options).toEqual({ onConflict: "project_id,area_id,gate_code" });

    // Every row carries the project id and a valid gate code; each
    // (area,gate) pair appears exactly once.
    const seen = new Set<string>();
    for (const row of rows as any[]) {
      expect(row.project_id).toBe(PROJECT_ID);
      expect(GateCodes).toContain(row.gate_code);
      const key = `${row.area_id}|${row.gate_code}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("returns zero cells and skips the upsert entirely when the project has no areas", async () => {
    const supa = makeSupa({ areaIds: [] });

    const result = await recomputeProjectGates(supa, PROJECT_ID, PROJECT_CODE, { skipAuthCheck: true });

    expect(result).toEqual({ ok: true, cellsUpdated: 0, ruleVersion: expect.any(Number) });
    expect(supa._mocks.upsertMock).not.toHaveBeenCalled();
  });

  // STICKY-PASSED guard: a cell manually marked passed (status='passed' +
  // actual_end_date set) is a human decision — recompute must never clobber
  // its status/blocking_reason back to a rule-derived value, even though all
  // cells now travel through one bulk upsert call. Stickiness is decided
  // per-cell BEFORE the write (using the same stickyPassed set the old
  // sequential loop read), so the row for a sticky cell omits status/
  // blocking_reason from its upsert payload — Postgres upsert only touches
  // columns present in the row, leaving the existing DB value untouched.
  it("omits status/blocking_reason from the row for a sticky-passed cell, but still includes it for non-sticky cells in the SAME bulk upsert call", async () => {
    const supa = makeSupa({
      areaIds: ["area-1"],
      cardAreas: [{ card_id: "card-1", area_id: "area-1" }],
      // A blocked "work" event would normally drive gate B to status
      // "blocked" — but area-1/B is sticky-passed below, so recompute must
      // leave its status alone.
      cardEvents: [workEvent("card-1", "blocked")],
      stickyPassed: [{ area_id: "area-1", gate_code: "B" }],
    });

    const result = await recomputeProjectGates(supa, PROJECT_ID, PROJECT_CODE, { skipAuthCheck: true });
    expect(result.ok).toBe(true);

    expect(supa._mocks.upsertMock).toHaveBeenCalledTimes(1);
    const [{ rows }] = supa._mocks.upsertCalls;
    const rowList = rows as any[];
    expect(rowList).toHaveLength(GateCodes.length);

    const stickyRow = rowList.find((r) => r.gate_code === "B");
    expect(stickyRow).toBeDefined();
    expect(stickyRow).not.toHaveProperty("status");
    expect(stickyRow).not.toHaveProperty("blocking_reason");
    // Recompute bookkeeping still refreshes even for sticky cells.
    expect(stickyRow.readiness_score).toBeTypeOf("number");
    expect(stickyRow.last_recomputed_at).toBeTypeOf("string");
    expect(stickyRow.stale).toBe(false);

    // Non-sticky gates in the same call DO carry a derived status.
    const nonStickyRow = rowList.find((r) => r.gate_code !== "B");
    expect(nonStickyRow).toHaveProperty("status");
  });

  it("surfaces the upsert error without partial success bookkeeping", async () => {
    const supa = makeSupa({
      areaIds: ["area-1"],
      cardAreas: [],
      cardEvents: [],
      upsertError: { message: "connection reset" },
    });

    const result = await recomputeProjectGates(supa, PROJECT_ID, PROJECT_CODE, { skipAuthCheck: true });

    expect(result).toEqual({ ok: false, error: "connection reset" });
  });
});
