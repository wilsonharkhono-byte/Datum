import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// Mock heavy dependencies so the unit test stays fast and offline.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/steps/infer-runner", () => ({ getCandidateStepsForCard: vi.fn(), inferCardEventSteps: vi.fn() }));
vi.mock("@/lib/steps/mutations", () => ({ applyStepInference: vi.fn() }));
vi.mock("@/lib/steps/infer", () => ({ selectApplicableMatches: vi.fn(), summarizeEventText: vi.fn() }));

import { processPendingStepInference } from "@/lib/steps/run-inference";
import { getCandidateStepsForCard, inferCardEventSteps } from "@/lib/steps/infer-runner";
import { applyStepInference } from "@/lib/steps/mutations";

function makeSupabase(rpcResult: { data: unknown; error: unknown }): SupabaseClient<Database> {
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
      throw new Error(`unexpected table ${table}`);
    }),
    _updateCalls: updateCalls,
  };
  return client as unknown as SupabaseClient<Database>;
}

describe("processPendingStepInference", () => {
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
  });
});
