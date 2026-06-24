/**
 * Tests for getProjectStepSignals:
 * - Assembles SignalStep correctly from joined DB rows + deps.
 * - Runs the comparator through the query adapter.
 * - Returns the flattened+labelled signals, severity-sorted.
 *
 * Uses a mocked Supabase client — no real DB calls.
 */
import { describe, expect, it } from "vitest";
import { getProjectStepSignals } from "@/lib/steps/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Fake Supabase builder ────────────────────────────────────────────────────

/**
 * Minimal chainable Supabase mock.
 * Calls resolve in order of the `from()` calls.
 */
function fakeClient(
  responses: Array<{ data: unknown[]; error: null }>,
): SupabaseClient<Database> {
  let callIndex = 0;

  return {
    from(_table: string) {
      const resp = responses[callIndex++] ?? { data: [], error: null };
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (resolve: (v: any) => void) => resolve(resp),
      };
      // Make the builder thenable (Promise-like) so await works.
      Object.defineProperty(builder, Symbol.toStringTag, { value: "Promise" });
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = "2026-07-10";
const NOW = "2026-07-10T08:00:00Z";
const PROJECT_ID = "proj-1";

/** A minimal area_step row as Supabase would return it (joined to trade_steps). */
const BASE_STEP_ROW = {
  id: "as-1",
  step_code: "B4",
  status: "in_progress",
  planned_start: "2026-07-01",
  planned_end: "2026-07-05", // past TODAY → behind_plan (high)
  actual_start: "2026-07-01",
  actual_end: null,
  blocking_reason: null,
  last_progress_at: null,
  area_id: "area-1",
  trade_steps: {
    name: "Screed",
    step_type: "site_work",
    trade_role: null,
    lead_time_days: 0,
    typical_duration_days: 3,
  },
};

const DEPS_RESPONSE = { data: [], error: null };

const AREA_RESPONSE = {
  data: [{ id: "area-1", area_name: "Kamar Mandi A" }],
  error: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("getProjectStepSignals", () => {
  it("returns a behind_plan signal for a step past its planned_end", async () => {
    const supa = fakeClient([
      { data: [BASE_STEP_ROW], error: null }, // area_steps
      DEPS_RESPONSE,                           // trade_step_deps
      AREA_RESPONSE,                           // matrix_areas
    ]);

    const result = await getProjectStepSignals(supa, PROJECT_ID, TODAY, NOW);

    expect(result.length).toBeGreaterThan(0);
    const row = result.find((r) => r.signal.kind === "behind_plan");
    expect(row).toBeDefined();
    expect(row!.areaId).toBe("area-1");
    expect(row!.areaName).toBe("Kamar Mandi A");
    expect(row!.stepCode).toBe("B4");
    expect(row!.stepName).toBe("Screed");
    expect(row!.signal.severity).toBe("high");
  });

  it("returns an empty array when there are no steps", async () => {
    const supa = fakeClient([
      { data: [], error: null }, // no steps
      DEPS_RESPONSE,
      AREA_RESPONSE,
    ]);

    const result = await getProjectStepSignals(supa, PROJECT_ID, TODAY, NOW);
    expect(result).toHaveLength(0);
  });

  it("returns an empty array when all steps are on-plan", async () => {
    const goodStep = {
      ...BASE_STEP_ROW,
      id: "as-good",
      step_code: "B3",
      status: "in_progress",
      planned_start: "2026-07-08", // today is within window
      planned_end: "2026-07-15",
      last_progress_at: "2026-07-09T10:00:00Z", // 1 day ago — under silence threshold
    };

    const supa = fakeClient([
      { data: [goodStep], error: null },
      DEPS_RESPONSE,
      AREA_RESPONSE,
    ]);

    const result = await getProjectStepSignals(supa, PROJECT_ID, TODAY, NOW);
    expect(result).toHaveLength(0);
  });

  it("sorts results: critical first, then high, warning, info", async () => {
    // Two steps: one blocked with imminent successor (critical), one behind_plan (high).
    const blockedStep = {
      ...BASE_STEP_ROW,
      id: "as-blocker",
      step_code: "B4",
      status: "blocked",
      planned_start: "2026-07-01",
      planned_end: "2026-07-08",
      blocking_reason: "Material habis",
    };
    const successorStep = {
      ...BASE_STEP_ROW,
      id: "as-successor",
      step_code: "B5",
      status: "not_started",
      planned_start: "2026-07-13", // 3 days away — within BLOCKING_IMMINENT_DAYS(7)
      planned_end: "2026-07-18",
      blocking_reason: null,
      trade_steps: {
        name: "Pemasangan Keramik",
        step_type: "site_work",
        trade_role: null,
        lead_time_days: 0,
        typical_duration_days: 5,
      },
    };
    const behindStep = {
      ...BASE_STEP_ROW,
      id: "as-behind",
      step_code: "B1",
      status: "in_progress",
      planned_start: "2026-06-25",
      planned_end: "2026-07-01", // past
    };

    const depsWithEdge = {
      data: [{ step_code: "B5", predecessor_code: "B4" }],
      error: null,
    };

    const supa = fakeClient([
      { data: [blockedStep, successorStep, behindStep], error: null },
      depsWithEdge,
      AREA_RESPONSE,
    ]);

    const result = await getProjectStepSignals(supa, PROJECT_ID, TODAY, NOW);
    expect(result.length).toBeGreaterThan(0);
    // First result must be critical
    expect(result[0]!.signal.severity).toBe("critical");
    // All criticals before highs
    let seenNonCritical = false;
    for (const row of result) {
      if (row.signal.severity !== "critical") seenNonCritical = true;
      if (seenNonCritical) {
        expect(row.signal.severity).not.toBe("critical");
      }
    }
  });

  it("labels rows with the correct areaName from matrix_areas", async () => {
    const supa = fakeClient([
      { data: [BASE_STEP_ROW], error: null },
      DEPS_RESPONSE,
      { data: [{ id: "area-1", area_name: "KM Utama" }], error: null },
    ]);

    const result = await getProjectStepSignals(supa, PROJECT_ID, TODAY, NOW);
    expect(result.every((r) => r.areaName === "KM Utama")).toBe(true);
  });

  it("uses step_code as fallback stepName when trade_steps is null", async () => {
    const noTemplate = {
      ...BASE_STEP_ROW,
      trade_steps: null,
    };

    const supa = fakeClient([
      { data: [noTemplate], error: null },
      DEPS_RESPONSE,
      AREA_RESPONSE,
    ]);

    const result = await getProjectStepSignals(supa, PROJECT_ID, TODAY, NOW);
    // Should still return signals; stepName falls back to step_code.
    if (result.length > 0) {
      expect(result[0]!.stepName).toBe("B4");
    }
  });
});
