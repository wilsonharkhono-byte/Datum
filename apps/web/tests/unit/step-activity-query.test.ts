import { describe, expect, it } from "vitest";
import { getProjectStepActivity } from "@/lib/activity/step-activity";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

const BASE_ROW = {
  id: "e1", status: "in_progress", note: null, percent_complete: 30,
  occurred_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", area_step_id: "as1",
  area_steps: { step_code: "BW2", areas: { area_name: "KM" }, trade_steps: { name: "Waterproofing" } },
  staff: null,
};

/** Fake client: captures each .select() call; resolves via a terminal .limit() call. */
function fakeClient(rows: unknown[], selects: string[]) {
  function chain(): any {
    const builder: any = {
      select(s: string) {
        selects.push(s);
        return builder;
      },
      eq: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: rows, error: null }),
    };
    return builder;
  }
  return { from: (_t: string) => chain() } as unknown as SupabaseClient<Database>;
}

/** Fake client: first .limit() errors (missing-column), second succeeds with fallbackRows. */
function fakeDegradingClient(fallbackRows: unknown[], error: { code?: string; message?: string }, selects: string[]) {
  let call = 0;
  function chain(): any {
    const builder: any = {
      select(s: string) {
        selects.push(s);
        return builder;
      },
      eq: () => builder,
      order: () => builder,
      limit: () => {
        call++;
        if (call === 1) return Promise.resolve({ data: null, error });
        return Promise.resolve({ data: fallbackRows, error: null });
      },
    };
    return builder;
  }
  return { from: (_t: string) => chain() } as unknown as SupabaseClient<Database>;
}

describe("getProjectStepActivity", () => {
  it("selects source, confidence, and the card_events->cards->projects join on the first attempt", async () => {
    const selects: string[] = [];
    const supa = fakeClient([], selects);
    await getProjectStepActivity(supa, "proj1");
    expect(selects[0]).toContain("source");
    expect(selects[0]).toContain("confidence");
    expect(selects[0]).toContain("card_events");
  });

  it("maps rows including attribution when the attribution select succeeds", async () => {
    const aiRow = {
      ...BASE_ROW,
      source: "ai",
      confidence: 0.88,
      card_events: { card_id: "c1", cards: { slug: "laporan", projects: { project_code: "BDG-H1" } } },
    };
    const supa = fakeClient([aiRow], []);
    const items = await getProjectStepActivity(supa, "proj1");
    expect(items[0]).toMatchObject({
      source: "ai",
      confidence: 0.88,
      cardLink: { projectCode: "BDG-H1", cardSlug: "laporan" },
    });
  });

  it("degrades to the base select (no attribution) when the attribution select errors with a missing column", async () => {
    const selects: string[] = [];
    const supa = fakeDegradingClient([BASE_ROW], { code: "42703", message: 'column "source" does not exist' }, selects);
    const items = await getProjectStepActivity(supa, "proj1");
    expect(selects[0]).toContain("source");
    expect(selects[1]).not.toContain("source");
    expect(items[0]).toMatchObject({ source: "human", confidence: null, cardLink: null });
  });

  it("rethrows non-missing-column errors without retrying", async () => {
    const selects: string[] = [];
    const supa = fakeDegradingClient([], { code: "PGRST301", message: "JWT expired" }, selects);
    await expect(getProjectStepActivity(supa, "proj1")).rejects.toMatchObject({ code: "PGRST301" });
    expect(selects).toHaveLength(1);
  });
});
