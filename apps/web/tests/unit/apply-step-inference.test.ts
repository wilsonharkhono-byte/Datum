// apps/web/tests/unit/apply-step-inference.test.ts
import { it, expect, vi, beforeEach } from "vitest";
import { applyStepInference } from "@/lib/steps/mutations";
import type { SelectedMatch } from "@/lib/steps/infer";

vi.mock("@/lib/steps/reminders", () => ({ notifyUnconfirmedAiBlock: vi.fn().mockResolvedValue(undefined) }));
import { notifyUnconfirmedAiBlock } from "@/lib/steps/reminders";

beforeEach(() => {
  vi.mocked(notifyUnconfirmedAiBlock).mockClear();
});

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
    occurredAt: "2026-06-30T10:00:00.000Z",
    selected,
  });
  expect(captured).toHaveLength(1);
  expect(captured[0]).toMatchObject({
    area_step_id: "as-1",
    project_id: "p-1",
    status: "done",
    note: null,
    percent_complete: null,
    source: "ai",
    confidence: 0.9,
    card_event_id: "ce-1",
    occurred_at: "2026-06-30T10:00:00.000Z",
  });
  expect(notifyUnconfirmedAiBlock).not.toHaveBeenCalled();
});

it("fires notifyUnconfirmedAiBlock exactly once when the selected match's status is 'blocked'", async () => {
  const captured: any[] = [];
  const selected: SelectedMatch[] = [
    { area_step_id: "as-1", step_code: "BW1", status: "blocked", blocked_on: "marmer belum datang", confidence: 0.8 },
  ];
  await applyStepInference(fakeSupabase(captured) as any, {
    cardEventId: "ce-2",
    projectId: "p-1",
    occurredAt: "2026-06-30T10:00:00.000Z",
    selected,
  });
  expect(notifyUnconfirmedAiBlock).toHaveBeenCalledTimes(1);
  expect(notifyUnconfirmedAiBlock).toHaveBeenCalledWith(expect.anything(), {
    areaStepId: "as-1",
    cardEventId: "ce-2",
    projectId: "p-1",
  });
});

it("does not fire notifyUnconfirmedAiBlock for a non-blocked status ('in_progress')", async () => {
  const captured: any[] = [];
  const selected: SelectedMatch[] = [
    { area_step_id: "as-1", step_code: "BW1", status: "in_progress", blocked_on: null, confidence: 0.7 },
  ];
  await applyStepInference(fakeSupabase(captured) as any, {
    cardEventId: "ce-3",
    projectId: "p-1",
    occurredAt: "2026-06-30T10:00:00.000Z",
    selected,
  });
  expect(notifyUnconfirmedAiBlock).not.toHaveBeenCalled();
});

it("skips notifyUnconfirmedAiBlock on a duplicate insert (23505) since it doesn't re-project either", async () => {
  const dupSupabase = {
    from(table: string) {
      if (table === "area_step_events") {
        return {
          insert: () => Promise.resolve({ error: { code: "23505" } }),
          select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        };
      }
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  };
  const selected: SelectedMatch[] = [
    { area_step_id: "as-1", step_code: "BW1", status: "blocked", blocked_on: "x", confidence: 0.8 },
  ];
  await applyStepInference(dupSupabase as any, {
    cardEventId: "ce-4",
    projectId: "p-1",
    occurredAt: "2026-06-30T10:00:00.000Z",
    selected,
  });
  expect(notifyUnconfirmedAiBlock).not.toHaveBeenCalled();
});
