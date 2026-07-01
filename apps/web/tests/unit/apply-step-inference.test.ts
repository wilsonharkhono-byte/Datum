// apps/web/tests/unit/apply-step-inference.test.ts
import { it, expect } from "vitest";
import { applyStepInference } from "@/lib/steps/mutations";
import type { SelectedMatch } from "@/lib/steps/infer";

function fakeSupabase(captured: any[]) {
  return {
    from(table: string) {
      if (table === "area_step_events") {
        return {
          insert: (row: any) => { captured.push(row); return Promise.resolve({ error: null }); },
          // projectAreaStep also reads area_step_events — return empty so it no-ops
          select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        };
      }
      // projectAreaStep reads — return empty data so it no-ops cleanly
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
}

it("inserts one AI event per selected match with source/confidence/card_event_id", async () => {
  const captured: any[] = [];
  const selected: SelectedMatch[] = [
    { area_step_id: "as-1", step_code: "BW1", status: "done", blocked_on: null, confidence: 0.9 },
  ];
  await applyStepInference(fakeSupabase(captured) as any, {
    cardEventId: "ce-1",
    projectId: "p-1",
    selected,
  });
  expect(captured).toHaveLength(1);
  expect(captured[0]).toMatchObject({
    area_step_id: "as-1",
    project_id: "p-1",
    status: "done",
    note: null,
    percent_complete: 100,
    source: "ai",
    confidence: 0.9,
    card_event_id: "ce-1",
  });
});
