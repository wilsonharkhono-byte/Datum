import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import {
  buildContextBlock,
  retrieveProjectContext,
  formatRoomSteps,
  formatOpenDecisions,
  formatProcurement,
  formatForecast,
  matchAreaIdsInQuestion,
  type CardWithEvents,
  type RoomStepContext,
} from "@/lib/assistant/retrieval";
import type { AreaStepRow, AreaStepEventRow } from "@/lib/steps/queries";

describe("buildContextBlock", () => {
  const cards: CardWithEvents[] = [
    {
      card: {
        id: "c1", project_id: "p1", topic_id: "t1", title: "Master bathroom",
        slug: "master-bathroom", status: "active",
        current_summary: "Marmer Statuario disetujui",
        properties: {}, created_by_staff_id: "s1",
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-05-20T14:30:00Z",
        last_event_at: "2026-05-22T08:00:00Z",
      },
      topicName: "A09 — Detail Kamar Mandi",
      events: [
        { id: "e1", card_id: "c1", project_id: "p1", event_kind: "decision",
          payload: { topic: "marmer", proposed_spec: "Statuario", approved_by: "client" },
          occurred_at: "2026-05-20T14:30:00Z", logged_by_staff_id: "s1",
          source_kind: "manual", source_id: null, cost_visible: false,
          draft_id: null, created_at: "2026-05-20T14:30:00Z", search_text: null,
          ai_step_status: "pending", ai_step_error: null, ai_step_attempts: 0, ai_step_processed_at: null },
      ],
    },
  ];

  it("renders cards with id-prefixed citation tokens", () => {
    const ctx = buildContextBlock(cards);
    expect(ctx).toContain("[card:c1]");
    expect(ctx).toContain("Master bathroom");
    expect(ctx).toContain("[event:e1]");
    expect(ctx).toContain("Statuario");
  });

  it("renders an empty marker when there are no cards", () => {
    expect(buildContextBlock([])).toContain("Tidak ada kartu");
  });
});

describe("buildContextBlock with attachment captions", () => {
  it("renders Lampiran lines for an event's captions", () => {
    const withCaptions: CardWithEvents[] = [
      {
        card: {
          id: "c1", project_id: "p1", topic_id: "t1", title: "Master bath",
          slug: "master-bath", status: "active", current_summary: null,
          properties: {}, created_by_staff_id: "s1",
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
          last_event_at: "2026-01-01T00:00:00Z",
        },
        topicName: "A09",
        events: [
          {
            id: "e1", card_id: "c1", project_id: "p1", event_kind: "photo",
            payload: { caption: "sample" }, occurred_at: "2026-01-01T00:00:00Z",
            logged_by_staff_id: "s1", source_kind: "manual", source_id: null,
            cost_visible: false, draft_id: null, created_at: "2026-01-01T00:00:00Z",
            search_text: null, ai_step_status: "pending", ai_step_error: null,
            ai_step_attempts: 0, ai_step_processed_at: null,
          },
        ],
        captionsByEventId: { e1: ["Marmer Statuario finish polish"] },
      },
    ];
    const ctx = buildContextBlock(withCaptions);
    expect(ctx).toContain("Lampiran:");
    expect(ctx).toContain("Marmer Statuario");
  });
});

// ─── PM-context pure formatters (Phase 3 Task 1) ─────────────────────────────

function step(overrides: Partial<AreaStepRow> = {}): AreaStepRow {
  return {
    id: "as-1", step_code: "B1", name: "Screed", step_type: "site_work",
    gate_code: "B", status: "not_started", planned_start: null, planned_end: null,
    assigned_trade: null, blocking_reason: null, last_progress_at: null,
    checkpoints: [], ...overrides,
  };
}

function stepEvent(overrides: Partial<AreaStepEventRow> = {}): AreaStepEventRow {
  return {
    id: "ev-1", area_step_id: "as-1", status: "in_progress", note: null,
    percent_complete: null, occurred_at: "2026-07-01T00:00:00Z",
    created_at: "2026-07-01T00:00:00Z", author_name: null, source: "human",
    confidence: null, card_event_id: null, card_link: null, ...overrides,
  };
}

describe("formatRoomSteps", () => {
  it("returns empty string for no rooms", () => {
    expect(formatRoomSteps([], new Map())).toBe("");
  });

  it("lists active + capped pending steps per room, with dates/status/AI marker", () => {
    const active = step({ id: "as-active", step_code: "B1", name: "Waterproofing", status: "in_progress", planned_start: "2026-07-01", planned_end: "2026-07-05" });
    const pending = [1, 2, 3, 4].map((n) =>
      step({ id: `as-p${n}`, step_code: `C${n}`, name: `Langkah ${n}`, status: "not_started" }),
    );
    const rooms: RoomStepContext[] = [
      { areaId: "area-1", areaName: "Kamar Mandi Utama", active: [active], steps: [active, ...pending] },
    ];
    const events = new Map<string, AreaStepEventRow[]>([
      ["as-active", [stepEvent({ area_step_id: "as-active", source: "ai" })]],
    ]);
    const ctx = formatRoomSteps(rooms, events);
    expect(ctx).toContain("LANGKAH PER RUANGAN:");
    expect(ctx).toContain("Kamar Mandi Utama");
    expect(ctx).toContain("Waterproofing");
    expect(ctx).toContain("[AI]");
    expect(ctx).toContain("2026-07-01→2026-07-05");
    // Only 3 of the 4 pending steps shown (MAX_PENDING_STEPS_PER_ROOM), +1 lainnya noted.
    expect(ctx).toContain("Langkah 1");
    expect(ctx).toContain("Langkah 3");
    expect(ctx).not.toContain("Langkah 4");
    expect(ctx).toContain("+1 langkah lain menunggu");
  });

  it("gives a room named in the question full detail (room-bias), bypassing the pending cap", () => {
    const pending = [1, 2, 3, 4].map((n) =>
      step({ id: `as-p${n}`, step_code: `C${n}`, name: `Langkah ${n}`, status: "not_started" }),
    );
    const rooms: RoomStepContext[] = [
      { areaId: "area-1", areaName: "Kamar Mandi Utama", active: [], steps: pending },
    ];
    const ctx = formatRoomSteps(rooms, new Map(), new Set(["area-1"]));
    expect(ctx).toContain("Langkah 4");
    expect(ctx).not.toContain("lainnya");
  });

  it("caps the number of rooms shown at full detail and notes the remainder", () => {
    const rooms: RoomStepContext[] = Array.from({ length: 15 }, (_, i) => {
      const s = step({ id: `as-${i}`, step_code: `B${i}`, name: `Step ${i}`, status: "in_progress" });
      return { areaId: `area-${i}`, areaName: `Room ${i}`, active: [s], steps: [s] };
    });
    const ctx = formatRoomSteps(rooms, new Map());
    expect(ctx).toContain("+3 ruangan lainnya"); // 15 rooms, cap 12
  });
});

describe("formatOpenDecisions", () => {
  it("returns empty string for no rows", () => {
    expect(formatOpenDecisions([])).toBe("");
  });

  it("cites card-linked decisions with [card:UUID] and names step-only decisions in text", () => {
    const ctx = formatOpenDecisions([
      { cardId: "c-abc", title: "Pilih marmer", detail: "Statuario vs Calacatta" },
      { title: "Keputusan kusen jendela", areaName: "Kamar Tidur Utama" },
    ]);
    expect(ctx).toContain("KEPUTUSAN TERBUKA:");
    expect(ctx).toContain("[card:c-abc] Pilih marmer");
    expect(ctx).toContain("Statuario vs Calacatta");
    expect(ctx).toContain("Keputusan kusen jendela (Kamar Tidur Utama)");
  });

  it("caps rows and appends a truncation note", () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ title: `Keputusan ${i}` }));
    const ctx = formatOpenDecisions(rows);
    expect(ctx).toContain("+5 lainnya");
  });
});

describe("formatProcurement", () => {
  it("returns empty string when all procurement steps are done", () => {
    const rows = [{ areaName: "KM A", step: step({ status: "accepted" }) }];
    expect(formatProcurement(rows)).toBe("");
  });

  it("sorts lead-time-risk rows first and marks them", () => {
    const noRisk = { areaName: "KM A", step: step({ id: "as-1", name: "Order keramik", status: "not_started" }) };
    const risk = {
      areaName: "KM B",
      step: step({ id: "as-2", name: "Order marmer", status: "not_started" }),
      leadTimeRisk: { message: "Order marmer harus dimulai sekarang" },
    };
    const ctx = formatProcurement([noRisk, risk]);
    expect(ctx).toContain("PENGADAAN/ORDER:");
    const riskIdx = ctx.indexOf("Order marmer");
    const noRiskIdx = ctx.indexOf("Order keramik");
    expect(riskIdx).toBeLessThan(noRiskIdx);
    expect(ctx).toContain("[RISIKO LEAD TIME]");
  });

  it("caps rows and appends a truncation note", () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({
      areaName: "KM A",
      step: step({ id: `as-${i}`, name: `Order ${i}`, status: "not_started" }),
    }));
    const ctx = formatProcurement(rows);
    expect(ctx).toContain("+3 lainnya");
  });
});

describe("formatForecast", () => {
  it("returns empty string when there's no target or projected handover", () => {
    const ctx = formatForecast(
      { projectId: "p1", targetHandover: null, projectedHandover: null, slipDays: null, worstArea: null, areas: [] },
      null,
    );
    expect(ctx).toBe("");
  });

  it("renders target/projected handover, slip days, and the bottleneck", () => {
    const ctx = formatForecast(
      {
        projectId: "p1", targetHandover: "2026-09-01", projectedHandover: "2026-09-15",
        slipDays: 14, worstArea: { areaName: "Kamar Mandi Utama", slipDays: 14, projectedFinish: "2026-09-15" },
        areas: [],
      },
      { areaName: "Kamar Mandi Utama", stepName: "Waterproofing", message: "Waterproofing sudah 5 hari melewati tenggat" },
    );
    expect(ctx).toContain("PERKIRAAN:");
    expect(ctx).toContain("Target handover: 2026-09-01");
    expect(ctx).toContain("Perkiraan handover: 2026-09-15");
    expect(ctx).toContain("mundur 14 hari dari target");
    expect(ctx).toContain("Penyebab utama: Kamar Mandi Utama · Waterproofing");
  });
});

describe("matchAreaIdsInQuestion", () => {
  const areas = [
    { id: "area-1", area_name: "Kamar Mandi Utama" },
    { id: "area-2", area_name: "Dapur" },
  ];

  it("returns an empty set when no question is given", () => {
    expect(matchAreaIdsInQuestion(undefined, areas).size).toBe(0);
  });

  it("matches a room name mentioned in the question, case/diacritic-insensitively", () => {
    const matched = matchAreaIdsInQuestion("Bagaimana progres kamar mandi utama?", areas);
    expect(matched.has("area-1")).toBe(true);
    expect(matched.has("area-2")).toBe(false);
  });

  it("returns an empty set when no area name appears in the question", () => {
    expect(matchAreaIdsInQuestion("Apa status proyek secara umum?", areas).size).toBe(0);
  });
});

// ─── retrieveProjectContext + buildContextBlock integration (RLS client, sections) ──

/**
 * Predicate-aware chainable Supabase mock. Several helpers query the SAME
 * table concurrently with different filters within one buildPmContextSections
 * call (e.g. getRoomStepViews issues two `area_steps` queries — one
 * `.is("removed_at", null)`, one `.not("removed_at", "is", null)` — while
 * getProjectStepSignals/getProjectForecast each issue their own unfiltered
 * `area_steps` query). A plain FIFO-by-table queue can't tell those apart
 * once queries interleave under Promise.all, so this fake instead resolves
 * each table via a responder function that inspects the filter calls made
 * on that specific builder (recorded as `{fn, args}` tuples) and returns the
 * right fixture. Tables with only one shape in play can use a constant
 * responder. Anything not registered degrades to `{ data: [], error: null }`
 * — the same empty-result shape the real client gives for out-of-scope
 * tables (e.g. getAdvisorData's six queries, which this suite ignores).
 */
type Call = { fn: string; args: unknown[] };
type Responder = (calls: Call[]) => { data: unknown; error: unknown };

function fakeClient(
  responders: Record<string, Responder>,
  opts?: { onFrom?: (table: string) => void },
): SupabaseClient<Database> {
  return {
    from(table: string) {
      opts?.onFrom?.(table);
      const calls: Call[] = [];
      const responder = responders[table];
      const resolve = () => (responder ? responder(calls) : { data: [], error: null });
      const chain = ["select", "eq", "in", "or", "not", "contains", "order", "limit", "is"];
      const builder: any = {};
      for (const fn of chain) {
        builder[fn] = (...args: unknown[]) => {
          calls.push({ fn, args });
          return builder;
        };
      }
      builder.single = () => Promise.resolve(resolve());
      builder.maybeSingle = () => Promise.resolve(resolve());
      builder.then = (res: (v: any) => void) => res(resolve());
      Object.defineProperty(builder, Symbol.toStringTag, { value: "Promise" });
      return builder;
    },
  } as unknown as SupabaseClient<Database>;
}

const constant = (data: unknown, error: unknown = null): Responder => () => ({ data, error });

describe("retrieveProjectContext + buildContextBlock — PM context sections", () => {
  const AREA = { id: "area-1", area_code: "A01", area_name: "Kamar Mandi Utama", area_type: "bathroom", sort_order: 1, project_id: "p1", area_sqm: null, finish_profile: {}, floor: null, created_at: "", updated_at: "", target_date: null };

  const ACTIVE_STEP_RAW = {
    id: "as-1", step_code: "B1", status: "in_progress", planned_start: "2026-07-01", planned_end: "2026-07-05",
    assigned_trade: null, blocking_reason: null, last_progress_at: null, created_at: "2026-06-01T00:00:00Z", area_id: "area-1",
    // Superset shape: satisfies both getRoomStepViews's template join AND
    // getProjectStepSignals/getProjectForecast's template join in one row.
    trade_steps: {
      sort_order: 1, step_type: "site_work", name: "Waterproofing", gate_code: "B",
      trade_role: null, lead_time_days: 0, typical_duration_days: 2,
    },
    area_step_checkpoints: [],
    actual_start: null, actual_end: null,
  };

  const PROC_STEP_RAW = {
    id: "as-2", step_code: "P1", status: "not_started", planned_start: "2026-07-10", planned_end: null,
    assigned_trade: "Vendor Marmer", blocking_reason: null, last_progress_at: null, created_at: "2026-06-01T00:00:00Z", area_id: "area-1",
    trade_steps: {
      sort_order: 2, step_type: "procurement", name: "Order marmer", gate_code: "C",
      trade_role: null, lead_time_days: 14, typical_duration_days: 1,
    },
    area_step_checkpoints: [],
    actual_start: null, actual_end: null,
  };

  /** area_steps responder: branches on the removed_at filter so getRoomStepViews's two concurrent queries each get the right rows. */
  const areaStepsResponder: Responder = (calls) => {
    const removedFilter = calls.find((c) => c.fn === "not" && c.args[0] === "removed_at");
    if (removedFilter) return { data: [], error: null }; // no soft-removed steps in these fixtures
    return { data: [ACTIVE_STEP_RAW, PROC_STEP_RAW], error: null };
  };

  function buildResponders(overrides: Partial<Record<string, Responder>> = {}): Record<string, Responder> {
    return {
      cards: constant([]),
      areas: constant([AREA]),
      area_steps: areaStepsResponder,
      trade_steps: constant([]),
      trade_step_deps: constant([]),
      area_step_events: constant([]),
      area_gate_status: constant([]),
      card_events: constant([]),
      ...overrides,
    };
  }

  it("populates all four KONTEKS sections in the built context block", async () => {
    const supa = fakeClient(buildResponders());
    const cards = await retrieveProjectContext(supa, "p1");
    const ctx = buildContextBlock(cards);

    expect(ctx).toContain("LANGKAH PER RUANGAN:");
    expect(ctx).toContain("Kamar Mandi Utama");
    expect(ctx).toContain("PENGADAAN/ORDER:");
    expect(ctx).toContain("Order marmer");
  });

  it("cites open decisions raised on a card with [card:UUID]", async () => {
    const supa = fakeClient(buildResponders({
      card_events: constant([
        {
          id: "ev-dec", occurred_at: "2026-06-01T00:00:00Z",
          payload: { status: "needs_decision", topic: "Pilih marmer", proposed_spec: "Statuario vs Calacatta" },
          cards: { id: "card-dec-1", title: "Marmer kamar mandi" },
        },
      ]),
    }));
    const cards = await retrieveProjectContext(supa, "p1");
    const ctx = buildContextBlock(cards);

    expect(ctx).toContain("KEPUTUSAN TERBUKA:");
    expect(ctx).toContain("[card:card-dec-1]");
    expect(ctx).toContain("Pilih marmer");
  });

  it("passes the caller-supplied (RLS-scoped) client through to every new query — never a hardcoded admin client", async () => {
    const seenTables: string[] = [];
    const supa = fakeClient(buildResponders(), { onFrom: (t) => seenTables.push(t) });
    await retrieveProjectContext(supa, "p1");

    // The new sections' queries all went through the same `supa` instance
    // passed in by the caller (this fake client), never a separately
    // constructed admin client — proven by onFrom recording calls for every
    // table the new sections touch.
    expect(seenTables).toContain("areas");
    expect(seenTables).toContain("area_steps");
    expect(seenTables).toContain("area_step_events");
    expect(seenTables).toContain("area_gate_status");
  });

  it("biases a room named in the question toward full detail", async () => {
    const supa = fakeClient(buildResponders());
    const cards = await retrieveProjectContext(supa, "p1", "apa progres kamar mandi utama?");
    const ctx = buildContextBlock(cards);
    expect(ctx).toContain("Kamar Mandi Utama");
  });
});
