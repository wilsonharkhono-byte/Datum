import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// Mock heavy dependencies so the unit test stays fast and offline.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/steps/infer-runner", () => ({ getCandidateStepsForCard: vi.fn(), inferCardEventSteps: vi.fn() }));
vi.mock("@/lib/steps/mutations", () => ({ applyStepInference: vi.fn() }));
vi.mock("@/lib/steps/infer", () => ({ selectApplicableMatches: vi.fn(), summarizeWorkEvent: vi.fn() }));

import { processPendingStepInference } from "@/lib/steps/run-inference";

function makeSupabase(rpcResult: { data: unknown; error: unknown }): SupabaseClient<Database> {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as SupabaseClient<Database>;
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
});
