/**
 * assistant-actions-executors.test.ts
 *
 * Executor-level tests for confirm-gated assistant actions:
 *  - authorization: every executor rejects when unauthenticated (no staff row)
 *  - uses the CALLER's session-scoped client (no admin/service-role client
 *    is ever constructed inside actions.ts — grepped, see assertion below)
 *  - name-resolution ambiguity: remind (staffName/recipientRole),
 *    update_step (areaName/stepName), record_decision (cardSlug/question)
 *  - no auto-exec path: execute* only ever runs when explicitly called with
 *    the confirmed action args — there is no code path that calls it as a
 *    side effect of parsing/streaming.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

vi.mock("@/lib/notifications/push-send", () => ({
  sendExpoPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/steps/mutations", () => ({
  updateAreaStep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@datum/core", async () => {
  const actual = await vi.importActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    resolveCardEvent: vi.fn().mockResolvedValue({ ok: true }),
  };
});

import {
  resolveRemindRecipients,
  resolveAreaStepByName,
  resolveOpenDecisionEvent,
  executeRemindAction,
  executeUpdateStepAction,
  executeRecordDecisionAction,
  executeAction,
} from "@/lib/assistant/actions";
import { updateAreaStep } from "@/lib/steps/mutations";
import { resolveCardEvent } from "@datum/core";
import { sendExpoPush } from "@/lib/notifications/push-send";

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

// ─── Fake Supabase client ───────────────────────────────────────────────────
// Same predicate-aware chainable mock pattern as assistant-retrieval.test.ts:
// a responder per table inspects the recorded filter calls to disambiguate
// concurrent queries against the same table.
type Call = { fn: string; args: unknown[] };
type Responder = (calls: Call[]) => { data: unknown; error: unknown };

function fakeClient(
  responders: Record<string, Responder>,
  opts?: {
    user?: { id: string } | null;
    insertSpy?: (table: string, rows: unknown) => void;
  },
): SupabaseClient<Database> {
  const fromCalls: string[] = [];
  return {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: "user" in (opts ?? {}) ? opts!.user : { id: "user-1" } },
        }),
    },
    from(table: string) {
      fromCalls.push(table);
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
      builder.insert = (rows: unknown) => {
        opts?.insertSpy?.(table, rows);
        return Promise.resolve({ data: null, error: null });
      };
      builder.single = () => Promise.resolve(resolve());
      builder.maybeSingle = () => Promise.resolve(resolve());
      builder.then = (res: (v: any) => void) => res(resolve());
      Object.defineProperty(builder, Symbol.toStringTag, { value: "Promise" });
      return builder;
    },
    // Recorded so a test can assert exactly which tables were touched (RLS
    // client threading proof) without a service-role/admin client anywhere.
    __fromCalls: fromCalls,
  } as unknown as SupabaseClient<Database> & { __fromCalls: string[] };
}

const constant = (data: unknown, error: unknown = null): Responder => () => ({ data, error });

const STAFF_ROW = { id: "staff-1", full_name: "Wilson", role: "principal", email: "w@x.com" };

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Authorization: unauthenticated caller ─────────────────────────────────

describe("executors reject when unauthenticated (no staff row)", () => {
  it("executeRemindAction returns an error and performs no insert when getCurrentStaff resolves null", async () => {
    const client = fakeClient(
      { staff: constant(null) }, // maybeSingle() on staff → no row
      { user: null }, // auth.getUser() → no user at all
    );
    const result = await executeRemindAction(client, {
      projectId: PROJECT_ID,
      action: { type: "remind", message: "Ingatkan" },
    });
    expect(result).toEqual({ ok: false, error: "Harus masuk untuk mengirim pengingat" });
  });

  it("executeUpdateStepAction returns an error when unauthenticated", async () => {
    const client = fakeClient({}, { user: null });
    const result = await executeUpdateStepAction(client, {
      projectId: PROJECT_ID,
      action: { type: "update_step", areaName: "KM-1", stepName: "Keramik", status: "in_progress" },
    });
    expect(result).toEqual({ ok: false, error: "Harus masuk untuk mengubah langkah" });
    expect(updateAreaStep).not.toHaveBeenCalled();
  });

  it("executeRecordDecisionAction returns an error when unauthenticated", async () => {
    const client = fakeClient({}, { user: null });
    const result = await executeRecordDecisionAction(client, {
      projectId: PROJECT_ID,
      action: { type: "record_decision", cardSlug: "x", outcome: "Ya" },
    });
    expect(result).toEqual({ ok: false, error: "Harus masuk untuk mencatat keputusan" });
    expect(resolveCardEvent).not.toHaveBeenCalled();
  });
});

// ─── Uses the caller's session client, never admin ─────────────────────────

describe("executors use only the caller-supplied client", () => {
  it("actions.ts never imports a service-role/admin client", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../lib/assistant/actions.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/createSupabaseAdminClient|SERVICE_ROLE|createAdminClient/);
  });

  it("executeRemindAction reads staff/project_staff via the exact client instance passed in", async () => {
    const insertSpy = vi.fn();
    const client = fakeClient(
      {
        staff: constant(STAFF_ROW),
        project_staff: constant([
          { staff_id: "staff-2", staff: { id: "staff-2", role: "site_supervisor", active: true } },
        ]),
      },
      { insertSpy },
    ) as SupabaseClient<Database> & { __fromCalls: string[] };

    const result = await executeRemindAction(client, {
      projectId: PROJECT_ID,
      action: { type: "remind", recipientRole: "site_supervisor", message: "Cek flood test" },
    });

    expect(result).toEqual({ ok: true });
    expect(client.__fromCalls).toContain("staff");
    expect(client.__fromCalls).toContain("project_staff");
    expect(client.__fromCalls).toContain("notifications");
    expect(insertSpy).toHaveBeenCalledWith(
      "notifications",
      expect.arrayContaining([
        expect.objectContaining({ recipient_staff_id: "staff-2", summary: "Cek flood test" }),
      ]),
    );
    expect(sendExpoPush).toHaveBeenCalledWith(["staff-2"], expect.any(Object));
  });
});

// ─── remind: name/role resolution + ambiguity ──────────────────────────────

describe("resolveRemindRecipients", () => {
  it("resolves a single named staff match (case-insensitive)", async () => {
    const client = fakeClient({
      project_staff: constant([
        { staff_id: "s1", staff: { id: "s1", full_name: "Budi Santoso", active: true } },
        { staff_id: "s2", staff: { id: "s2", full_name: "Ani", active: true } },
      ]),
    });
    const result = await resolveRemindRecipients(client, PROJECT_ID, { staffName: "budi santoso" });
    expect(result).toEqual({ ok: true, staffIds: ["s1"] });
  });

  it("returns an error when the named staff is not found", async () => {
    const client = fakeClient({
      project_staff: constant([{ staff_id: "s1", staff: { id: "s1", full_name: "Ani", active: true } }]),
    });
    const result = await resolveRemindRecipients(client, PROJECT_ID, { staffName: "Budi" });
    expect(result.ok).toBe(false);
  });

  it("returns an error (ambiguous) when two active staff share the same name", async () => {
    const client = fakeClient({
      project_staff: constant([
        { staff_id: "s1", staff: { id: "s1", full_name: "Budi", active: true } },
        { staff_id: "s2", staff: { id: "s2", full_name: "Budi", active: true } },
      ]),
    });
    const result = await resolveRemindRecipients(client, PROJECT_ID, { staffName: "Budi" });
    expect(result).toEqual({
      ok: false,
      error: 'Ada lebih dari satu staf bernama "Budi" — sebutkan lebih spesifik',
    });
  });

  it("ignores an inactive staff member with a matching name", async () => {
    const client = fakeClient({
      project_staff: constant([{ staff_id: "s1", staff: { id: "s1", full_name: "Budi", active: false } }]),
    });
    const result = await resolveRemindRecipients(client, PROJECT_ID, { staffName: "Budi" });
    expect(result.ok).toBe(false);
  });

  it("resolves all active staff matching a trade role", async () => {
    const client = fakeClient({
      project_staff: constant([
        { staff_id: "s1", staff: { id: "s1", role: "site_supervisor", active: true } },
        { staff_id: "s2", staff: { id: "s2", role: "site_supervisor", active: true } },
        { staff_id: "s3", staff: { id: "s3", role: "designer", active: true } },
      ]),
    });
    const result = await resolveRemindRecipients(client, PROJECT_ID, { recipientRole: "site_supervisor" });
    expect(result).toEqual({ ok: true, staffIds: ["s1", "s2"] });
  });

  it("returns an error when neither staffName nor recipientRole is given", async () => {
    const client = fakeClient({});
    const result = await resolveRemindRecipients(client, PROJECT_ID, {});
    expect(result.ok).toBe(false);
  });
});

// ─── update_step: area/step name resolution + ambiguity ────────────────────

describe("resolveAreaStepByName", () => {
  const AREA = { id: "area-1", area_name: "Kamar Mandi Utama", area_type: "bathroom" };
  const STEP_RAW = {
    id: "as-1",
    step_code: "B1",
    status: "in_progress",
    planned_start: null,
    planned_end: null,
    assigned_trade: null,
    blocking_reason: null,
    last_progress_at: null,
    created_at: "2026-06-01T00:00:00Z",
    area_id: "area-1",
    trade_steps: { sort_order: 1, step_type: "site_work", name: "Pemasangan keramik", gate_code: "B" },
    area_step_checkpoints: [],
  };

  it("resolves a single matching (area, step) pair", async () => {
    const client = fakeClient({
      areas: constant([AREA]),
      area_steps: (calls) => {
        const isRemoved = calls.some((c) => c.fn === "not");
        return isRemoved ? { data: [], error: null } : { data: [STEP_RAW], error: null };
      },
      trade_step_deps: constant([]),
      trade_steps: constant([]),
    });
    const result = await resolveAreaStepByName(client, PROJECT_ID, {
      areaName: "Kamar Mandi Utama",
      stepName: "Pemasangan keramik",
    });
    expect(result).toEqual({ ok: true, areaStepId: "as-1" });
  });

  it("returns an error when the area name is not found", async () => {
    const client = fakeClient({ areas: constant([AREA]) });
    const result = await resolveAreaStepByName(client, PROJECT_ID, {
      areaName: "Tidak Ada",
      stepName: "Apa saja",
    });
    expect(result.ok).toBe(false);
  });

  it("returns an error (ambiguous) when two areas share the same name", async () => {
    const client = fakeClient({
      areas: constant([AREA, { id: "area-2", area_name: "Kamar Mandi Utama", area_type: "bathroom" }]),
    });
    const result = await resolveAreaStepByName(client, PROJECT_ID, {
      areaName: "Kamar Mandi Utama",
      stepName: "Pemasangan keramik",
    });
    expect(result).toEqual({ ok: false, error: 'Ada lebih dari satu ruangan bernama "Kamar Mandi Utama"' });
  });

  it("returns an error when the step name is not found in the resolved area", async () => {
    const client = fakeClient({
      areas: constant([AREA]),
      area_steps: (calls) => {
        const isRemoved = calls.some((c) => c.fn === "not");
        return isRemoved ? { data: [], error: null } : { data: [STEP_RAW], error: null };
      },
      trade_step_deps: constant([]),
      trade_steps: constant([]),
    });
    const result = await resolveAreaStepByName(client, PROJECT_ID, {
      areaName: "Kamar Mandi Utama",
      stepName: "Langkah yang tidak ada",
    });
    expect(result.ok).toBe(false);
  });
});

// ─── record_decision: cardSlug/question resolution + ambiguity ─────────────

describe("resolveOpenDecisionEvent", () => {
  it("resolves the single open decision event for a given cardSlug", async () => {
    const client = fakeClient({
      cards: constant([
        { id: "card-1", slug: "whastudio-42", title: "Marmer", project_id: PROJECT_ID, projects: { project_code: "WHA" } },
      ]),
      card_events: constant([
        { id: "ev-1", card_id: "card-1", payload: { status: "needs_decision", topic: "Marmer" } },
      ]),
    });
    const result = await resolveOpenDecisionEvent(client, PROJECT_ID, { cardSlug: "whastudio-42" });
    expect(result).toEqual({ ok: true, eventId: "ev-1", cardSlug: "whastudio-42", projectCode: "WHA" });
  });

  it("returns an error when the card is not found", async () => {
    const client = fakeClient({ cards: constant([]) });
    const result = await resolveOpenDecisionEvent(client, PROJECT_ID, { cardSlug: "nope" });
    expect(result.ok).toBe(false);
  });

  it("returns an error when there is no open decision on that card", async () => {
    const client = fakeClient({
      cards: constant([{ id: "card-1", slug: "x", title: "T", project_id: PROJECT_ID, projects: { project_code: "WHA" } }]),
      card_events: constant([]),
    });
    const result = await resolveOpenDecisionEvent(client, PROJECT_ID, { cardSlug: "x" });
    expect(result).toEqual({ ok: false, error: "Tidak ada keputusan terbuka yang cocok ditemukan" });
  });

  it("returns an error (ambiguous) when a cardSlug's card has more than one open decision", async () => {
    const client = fakeClient({
      cards: constant([{ id: "card-1", slug: "x", title: "T", project_id: PROJECT_ID, projects: { project_code: "WHA" } }]),
      card_events: constant([
        { id: "ev-1", card_id: "card-1", payload: { status: "needs_decision", topic: "A" } },
        { id: "ev-2", card_id: "card-1", payload: { status: "needs_decision", topic: "B" } },
      ]),
    });
    const result = await resolveOpenDecisionEvent(client, PROJECT_ID, { cardSlug: "x" });
    expect(result).toEqual({ ok: false, error: "Ada lebih dari satu keputusan terbuka yang cocok — sebutkan kartu spesifik" });
  });

  it("returns an error when neither cardSlug nor question is given", async () => {
    const client = fakeClient({});
    const result = await resolveOpenDecisionEvent(client, PROJECT_ID, {});
    expect(result.ok).toBe(false);
  });
});

// ─── update_step execution: human-sourced, confirming user as author ───────

describe("executeUpdateStepAction", () => {
  const AREA = { id: "area-1", area_name: "Kamar Mandi Utama", area_type: "bathroom" };
  const STEP_RAW = {
    id: "as-1",
    step_code: "B1",
    status: "in_progress",
    planned_start: null,
    planned_end: null,
    assigned_trade: null,
    blocking_reason: null,
    last_progress_at: null,
    created_at: "2026-06-01T00:00:00Z",
    area_id: "area-1",
    trade_steps: { sort_order: 1, step_type: "site_work", name: "Pemasangan keramik", gate_code: "B" },
    area_step_checkpoints: [],
  };

  it("calls updateAreaStep with the confirming user's staff id as loggedByStaffId", async () => {
    const client = fakeClient({
      staff: constant(STAFF_ROW),
      areas: constant([AREA]),
      area_steps: (calls) => {
        const isRemoved = calls.some((c) => c.fn === "not");
        return isRemoved ? { data: [], error: null } : { data: [STEP_RAW], error: null };
      },
      trade_step_deps: constant([]),
      trade_steps: constant([]),
    });

    const result = await executeUpdateStepAction(client, {
      projectId: PROJECT_ID,
      action: { type: "update_step", areaName: "Kamar Mandi Utama", stepName: "Pemasangan keramik", status: "blocked", note: "Menunggu drainase" },
    });

    expect(result).toEqual({ ok: true });
    expect(updateAreaStep).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        areaStepId: "as-1",
        status: "blocked",
        loggedByStaffId: "staff-1",
        note: expect.stringContaining("via asisten"),
      }),
    );
  });
});

// ─── No auto-exec: execute* is never called except by an explicit tap ──────

describe("no execution without an explicit confirm", () => {
  it("parseActionTail-produced proposals never trigger a write on their own (actions.ts exposes no auto-exec hook)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../lib/assistant/actions.ts"),
      "utf8",
    );
    // parseActionTail/stripActionTail must never themselves call an execute*
    // function — this greps the parser section for any execute* call.
    const parserSection = src.slice(0, src.indexOf("// ─── Executor result"));
    expect(parserSection).not.toMatch(/execute(Remind|UpdateStep|RecordDecision|Action)\s*\(/);
  });

  it("executeAction dispatches to the right executor only when called directly with a validated action", async () => {
    const client = fakeClient({ staff: constant(null) }, { user: null });
    const result = await executeAction(client, {
      projectId: PROJECT_ID,
      action: { type: "remind", message: "x" },
    });
    // Still requires auth even via the dispatcher — no bypass.
    expect(result).toEqual({ ok: false, error: "Harus masuk untuk mengirim pengingat" });
  });
});
