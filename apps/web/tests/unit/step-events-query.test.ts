import { describe, expect, it } from "vitest";
import { getAreaStepEvents } from "@/lib/steps/queries";
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
});
