import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// Mock heavy dependencies so the unit test stays fast and offline.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/steps/infer-runner", () => ({ getCandidateStepsForCard: vi.fn(), inferCardEventSteps: vi.fn() }));
vi.mock("@/lib/steps/mutations", () => ({ applyStepInference: vi.fn() }));
vi.mock("@/lib/steps/infer", () => ({ selectApplicableMatches: vi.fn(), summarizeEventText: vi.fn() }));
vi.mock("@/lib/gates/recompute-system", () => ({ recomputeProjectGatesSystem: vi.fn().mockResolvedValue({ ok: true, cellsUpdated: 0, ruleVersion: 2 }) }));

import { processPendingStepInference } from "@/lib/steps/run-inference";
import { getCandidateStepsForCard, inferCardEventSteps } from "@/lib/steps/infer-runner";
import { applyStepInference } from "@/lib/steps/mutations";
import { summarizeEventText } from "@/lib/steps/infer";
import { recomputeProjectGatesSystem } from "@/lib/gates/recompute-system";

function makeSupabase(
  rpcResult: { data: unknown; error: unknown },
  opts?: { projectCode?: string },
): SupabaseClient<Database> {
  const updateCalls: any[] = [];
  const client = {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    from: vi.fn((table: string) => {
      if (table === "card_events") {
        return {
          update: (row: any) => {
            updateCalls.push(row);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      if (table === "cards") {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { title: "KM Utama" } }) }) }) };
      }
      if (table === "projects") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { project_code: opts?.projectCode ?? "BDG-H1" } }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _updateCalls: updateCalls,
  };
  return client as unknown as SupabaseClient<Database>;
}

describe("processPendingStepInference", () => {
  beforeEach(() => {
    vi.mocked(recomputeProjectGatesSystem).mockClear();
    vi.mocked(inferCardEventSteps).mockClear();
    vi.mocked(applyStepInference).mockClear();
    // Default: non-empty text so the empty-text short-circuit doesn't fire
    // for tests unrelated to it. The dedicated no_text test overrides this.
    vi.mocked(summarizeEventText).mockReturnValue("some field text");
  });

  it("returns migrationPending when the claim RPC is missing (PGRST202)", async () => {
    const supabase = makeSupabase({
      data: null,
      error: { code: "PGRST202", message: "function claim_card_events_for_step_inference not found" },
    });
    const result = await processPendingStepInference(supabase, 5);
    expect(result).toEqual({ migrationPending: true });
  });

  it("returns zero counts when the claim RPC returns an empty list", async () => {
    const supabase = makeSupabase({ data: [], error: null });
    const result = await processPendingStepInference(supabase, 5);
    expect(result).toEqual({ claimed: 0, done: 0, skipped: 0, failed: 0 });
  });

  it("marks the event skipped with ai_step_error='not_progress' when the verdict says is_progress: false, without applying any step inference", async () => {
    const claimedEvent = {
      id: "ce-1",
      card_id: "card-1",
      project_id: "p-1",
      occurred_at: "2026-07-02T10:00:00.000Z",
      payload: { body: "diskusi warna cat dengan klien" },
    };
    const supabase = makeSupabase({ data: [claimedEvent], error: null });
    vi.mocked(getCandidateStepsForCard).mockResolvedValue([
      { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
    ] as any);
    vi.mocked(inferCardEventSteps).mockResolvedValue({
      verdict: { is_progress: false, matches: [] },
    } as any);

    const result = await processPendingStepInference(supabase, 5);

    expect(result).toEqual({ claimed: 1, done: 0, skipped: 1, failed: 0 });
    expect(applyStepInference).not.toHaveBeenCalled();
    const calls = (supabase as any)._updateCalls as any[];
    expect(calls).toContainEqual(
      expect.objectContaining({ ai_step_status: "skipped", ai_step_error: "not_progress" }),
    );
    expect(recomputeProjectGatesSystem).not.toHaveBeenCalled();
  });

  it("marks the event skipped with ai_step_error='no_text' and never calls Haiku when summarizeEventText returns empty/whitespace", async () => {
    const claimedEvent = {
      id: "ce-empty",
      card_id: "card-1",
      project_id: "p-1",
      occurred_at: "2026-07-02T10:00:00.000Z",
      event_kind: "note",
      payload: { body: "   " },
    };
    const supabase = makeSupabase({ data: [claimedEvent], error: null });
    vi.mocked(getCandidateStepsForCard).mockResolvedValue([
      { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
    ] as any);
    vi.mocked(summarizeEventText).mockReturnValue("   ");

    const result = await processPendingStepInference(supabase, 5);

    expect(result).toEqual({ claimed: 1, done: 0, skipped: 1, failed: 0 });
    expect(inferCardEventSteps).not.toHaveBeenCalled();
    expect(applyStepInference).not.toHaveBeenCalled();
    const calls = (supabase as any)._updateCalls as any[];
    expect(calls).toContainEqual(
      expect.objectContaining({ ai_step_status: "skipped", ai_step_error: "no_text" }),
    );
    expect(recomputeProjectGatesSystem).not.toHaveBeenCalled();
  });

  // B4 self-heal: AI-written step progress is gate-relevant, so writing an
  // area_step_event via inference must trigger the same gate recompute a
  // human "work" event would. This is what lets stale cells clear even when
  // the progress came from the inference cron route (no request to hang an
  // after() recompute off of) rather than a direct createCardEvent call.
  it("recomputes gates for the project once selected matches are applied", async () => {
    const claimedEvent = {
      id: "ce-2",
      card_id: "card-1",
      project_id: "p-1",
      occurred_at: "2026-07-02T10:00:00.000Z",
      payload: { body: "waterproofing selesai" },
    };
    const supabase = makeSupabase({ data: [claimedEvent], error: null }, { projectCode: "BDG-H1" });
    vi.mocked(getCandidateStepsForCard).mockResolvedValue([
      { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
    ] as any);
    vi.mocked(inferCardEventSteps).mockResolvedValue({
      verdict: { is_progress: true, matches: [{ area_step_id: "as-1", status: "done", confidence: 0.9 }] },
    } as any);
    const { selectApplicableMatches } = await import("@/lib/steps/infer");
    vi.mocked(selectApplicableMatches).mockReturnValue([
      { area_step_id: "as-1", status: "done", confidence: 0.9 } as any,
    ]);

    const result = await processPendingStepInference(supabase, 5);

    expect(result).toEqual({ claimed: 1, done: 1, skipped: 0, failed: 0 });
    expect(applyStepInference).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).toHaveBeenCalledTimes(1);
    expect(recomputeProjectGatesSystem).toHaveBeenCalledWith("p-1", "BDG-H1");
  });

  it("recomputes gates once per project even when multiple claimed events land on the same project", async () => {
    const claimed = [
      { id: "ce-3", card_id: "card-1", project_id: "p-1", occurred_at: "2026-07-02T10:00:00.000Z", payload: {} },
      { id: "ce-4", card_id: "card-2", project_id: "p-1", occurred_at: "2026-07-02T10:05:00.000Z", payload: {} },
    ];
    const supabase = makeSupabase({ data: claimed, error: null }, { projectCode: "BDG-H1" });
    vi.mocked(getCandidateStepsForCard).mockResolvedValue([
      { area_step_id: "as-1", step_code: "BW1", name: "Waterproofing", gate_code: "B", status: "not_started" },
    ] as any);
    vi.mocked(inferCardEventSteps).mockResolvedValue({
      verdict: { is_progress: true, matches: [{ area_step_id: "as-1", status: "done", confidence: 0.9 }] },
    } as any);
    const { selectApplicableMatches } = await import("@/lib/steps/infer");
    vi.mocked(selectApplicableMatches).mockReturnValue([
      { area_step_id: "as-1", status: "done", confidence: 0.9 } as any,
    ]);

    const result = await processPendingStepInference(supabase, 5);

    expect(result).toEqual({ claimed: 2, done: 2, skipped: 0, failed: 0 });
    expect(recomputeProjectGatesSystem).toHaveBeenCalledTimes(1);
  });
});
