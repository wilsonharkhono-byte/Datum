import { describe, expect, it } from "vitest";
import { getAreaStepEvents, isMissingColumnError, mapAreaStepEventRow } from "@/lib/steps/queries";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// Minimal fake Supabase builder that supports the chaining used by getAreaStepEvents.
// Captures the last .select() call so we can assert the select string.
function fakeClient(rows: unknown[], capturedSelect?: { value?: string }) {
  function chain(): any {
    const builder: any = {
      select(s: string) {
        if (capturedSelect) capturedSelect.value = s;
        return builder;
      },
      in: () => builder,
      order: () => Promise.resolve({ data: rows, error: null }),
    };
    return builder;
  }
  return {
    from(_table: string) {
      return chain();
    },
  } as unknown as SupabaseClient<Database>;
}

/**
 * Fake client whose first .select() call errors (simulating a missing-column
 * error on the attribution-extended select) and whose second call succeeds
 * with `fallbackRows` — models the pre-migration prod degrade path.
 */
function fakeDegradingClient(fallbackRows: unknown[], error: { code?: string; message?: string }, selects: string[]) {
  let call = 0;
  function chain(): any {
    const builder: any = {
      select(s: string) {
        selects.push(s);
        return builder;
      },
      in: () => builder,
      order: () => {
        call++;
        if (call === 1) return Promise.resolve({ data: null, error });
        return Promise.resolve({ data: fallbackRows, error: null });
      },
    };
    return builder;
  }
  return {
    from(_table: string) {
      return chain();
    },
  } as unknown as SupabaseClient<Database>;
}

const BASE_EVENT = {
  id: "ev1",
  area_step_id: "step1",
  status: "in_progress",
  note: "tukang datang besok",
  percent_complete: 30,
  occurred_at: "2026-06-20T10:00:00Z",
  created_at: "2026-06-20T10:00:00Z",
  staff: { full_name: "Budi Santoso" },
};

describe("getAreaStepEvents", () => {
  it("returns an empty map when stepIds is empty (no DB call)", async () => {
    const supa = fakeClient([]);
    const result = await getAreaStepEvents(supa, []);
    expect(result.size).toBe(0);
  });

  it("groups returned rows by area_step_id", async () => {
    const rows = [
      { ...BASE_EVENT, id: "ev1", area_step_id: "step1" },
      { ...BASE_EVENT, id: "ev2", area_step_id: "step1", note: "lanjut lagi" },
      { ...BASE_EVENT, id: "ev3", area_step_id: "step2", staff: null, note: null, percent_complete: null },
    ];
    const supa = fakeClient(rows);
    const result = await getAreaStepEvents(supa, ["step1", "step2"]);

    expect(result.size).toBe(2);
    expect(result.get("step1")).toHaveLength(2);
    expect(result.get("step2")).toHaveLength(1);
  });

  it("maps author_name from staff.full_name", async () => {
    const supa = fakeClient([BASE_EVENT]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    const events = result.get("step1")!;
    expect(events[0]!.author_name).toBe("Budi Santoso");
  });

  it("sets author_name to null when staff is null", async () => {
    const row = { ...BASE_EVENT, staff: null };
    const supa = fakeClient([row]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    expect(result.get("step1")![0]!.author_name).toBeNull();
  });

  it("coerces percent_complete to a number", async () => {
    // Supabase returns numeric columns as numbers, but guard against string coercion
    const row = { ...BASE_EVENT, percent_complete: 75.5 };
    const supa = fakeClient([row]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    expect(result.get("step1")![0]!.percent_complete).toBe(75.5);
  });

  it("returns percent_complete as null when absent", async () => {
    const row = { ...BASE_EVENT, percent_complete: null };
    const supa = fakeClient([row]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    expect(result.get("step1")![0]!.percent_complete).toBeNull();
  });

  it("uses occurred_at as the timestamp on the row", async () => {
    const supa = fakeClient([BASE_EVENT]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    expect(result.get("step1")![0]!.occurred_at).toBe("2026-06-20T10:00:00Z");
  });

  it("includes staff join in the select string", async () => {
    const captured: { value?: string } = {};
    const supa = fakeClient([], captured);
    await getAreaStepEvents(supa, ["step1"]);
    expect(captured.value).toContain("staff");
    expect(captured.value).toContain("full_name");
  });

  it("preserves all AreaStepEventRow fields on returned rows", async () => {
    const supa = fakeClient([BASE_EVENT]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    const row = result.get("step1")![0]!;
    expect(row).toMatchObject({
      id: "ev1",
      area_step_id: "step1",
      status: "in_progress",
      note: "tukang datang besok",
      percent_complete: 30,
      occurred_at: "2026-06-20T10:00:00Z",
      author_name: "Budi Santoso",
    });
  });

  it("defaults source to 'human' and confidence/card_link to null when a human row has no attribution fields", async () => {
    const supa = fakeClient([BASE_EVENT]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    const row = result.get("step1")![0]!;
    expect(row.source).toBe("human");
    expect(row.confidence).toBeNull();
    expect(row.card_event_id).toBeNull();
    expect(row.card_link).toBeNull();
  });

  it("maps source='ai' + confidence + resolves card_link from the nested card_events->cards->projects join", async () => {
    const aiRow = {
      ...BASE_EVENT,
      id: "ev-ai",
      source: "ai",
      confidence: 0.947,
      card_event_id: "cev1",
      card_events: {
        card_id: "card1",
        cards: { slug: "pasang-lantai", projects: { project_code: "BDG-H1" } },
      },
    };
    const supa = fakeClient([aiRow]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    const row = result.get("step1")![0]!;
    expect(row.source).toBe("ai");
    expect(row.confidence).toBeCloseTo(0.947);
    expect(row.card_event_id).toBe("cev1");
    expect(row.card_link).toEqual({ projectCode: "BDG-H1", cardSlug: "pasang-lantai" });
  });

  it("card_link is null when the AI event's card join can't be resolved (viewer can't read the card)", async () => {
    const aiRow = { ...BASE_EVENT, source: "ai", confidence: 0.8, card_event_id: "cev1", card_events: null };
    const supa = fakeClient([aiRow]);
    const result = await getAreaStepEvents(supa, ["step1"]);
    expect(result.get("step1")![0]!.card_link).toBeNull();
  });

  it("includes the attribution select (source, confidence, card_event_id, card_events join) on the first attempt", async () => {
    const captured: { value?: string } = {};
    const supa = fakeClient([], captured);
    await getAreaStepEvents(supa, ["step1"]);
    expect(captured.value).toContain("source");
    expect(captured.value).toContain("confidence");
    expect(captured.value).toContain("card_event_id");
    expect(captured.value).toContain("card_events");
  });

  it("degrades to the base select (no attribution) when the first attempt errors with a missing-column error", async () => {
    const selects: string[] = [];
    const supa = fakeDegradingClient([BASE_EVENT], { code: "42703", message: 'column "source" does not exist' }, selects);
    const result = await getAreaStepEvents(supa, ["step1"]);
    expect(selects[0]).toContain("source"); // first attempt was the attribution select
    expect(selects[1]).not.toContain("source"); // fallback select dropped attribution fields
    const row = result.get("step1")![0]!;
    expect(row.source).toBe("human");
    expect(row.card_link).toBeNull();
  });

  it("does not retry and rethrows non-missing-column errors", async () => {
    const selects: string[] = [];
    const supa = fakeDegradingClient([], { code: "PGRST301", message: "JWT expired" }, selects);
    await expect(getAreaStepEvents(supa, ["step1"])).rejects.toMatchObject({ code: "PGRST301" });
    expect(selects).toHaveLength(1);
  });
});

describe("isMissingColumnError", () => {
  it("detects Postgres undefined_column code 42703", () => {
    expect(isMissingColumnError({ code: "42703", message: null })).toBe(true);
  });
  it("detects a 'column ... does not exist' message without the code", () => {
    expect(isMissingColumnError({ code: null, message: 'column area_step_events.source does not exist' })).toBe(true);
  });
  it("returns false for unrelated errors", () => {
    expect(isMissingColumnError({ code: "23505", message: "duplicate key" })).toBe(false);
  });
  it("returns false for null", () => {
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe("mapAreaStepEventRow", () => {
  it("maps a plain human row (no attribution columns present) to source='human', confidence/card_link null", () => {
    const row = mapAreaStepEventRow({
      id: "e1", area_step_id: "s1", status: "done", note: null, percent_complete: null,
      occurred_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", staff: null,
    });
    expect(row.source).toBe("human");
    expect(row.confidence).toBeNull();
    expect(row.card_link).toBeNull();
  });

  it("maps an AI row with a resolvable card link", () => {
    const row = mapAreaStepEventRow({
      id: "e2", area_step_id: "s1", status: "in_progress", note: null, percent_complete: 50,
      occurred_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", staff: null,
      source: "ai", confidence: 0.72, card_event_id: "cev9",
      card_events: { card_id: "c1", cards: { slug: "atap-bocor", projects: { project_code: "PKW-PC1012" } } },
    });
    expect(row).toMatchObject({
      source: "ai",
      confidence: 0.72,
      card_event_id: "cev9",
      card_link: { projectCode: "PKW-PC1012", cardSlug: "atap-bocor" },
    });
  });

  it("card_link stays null when card_events resolves but the card's project is null", () => {
    const row = mapAreaStepEventRow({
      id: "e3", area_step_id: "s1", status: "done", note: null, percent_complete: null,
      occurred_at: "2026-07-01T00:00:00Z", created_at: "2026-07-01T00:00:00Z", staff: null,
      source: "ai", confidence: 0.5, card_event_id: "cev9",
      card_events: { card_id: "c1", cards: { slug: "atap-bocor", projects: null } },
    });
    expect(row.card_link).toBeNull();
  });
});
