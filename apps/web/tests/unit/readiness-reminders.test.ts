/**
 * Tests for the readiness-reminder builder + cron helpers.
 *
 * Covers:
 * - tradeRoleToStaffRole mapping
 * - resolveRecipients: trade-role match, principal fallback, project-row fallback
 * - buildReadinessReminders: correct intents, dedupeKey determinism, message shape
 * - isAlreadyNotified: dedup logic (skip when unread match found)
 * - isCronAuthorized: bearer validation
 * - jakartaToday: returns a YYYY-MM-DD string
 */

import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";

// Mock sendExpoPush so unit tests don't attempt real Expo HTTP calls.
// The mock is verified in the "sendExpoPush integration" describe block below.
vi.mock("@/lib/notifications/push-send", () => ({
  sendExpoPush: vi.fn().mockResolvedValue(undefined),
}));
import {
  tradeRoleToStaffRole,
  resolveRecipients,
  buildReadinessReminders,
  getActiveProjects,
  getProjectMembers,
  READINESS_REMINDER_KIND,
  DAILY_BRIEF_KIND,
  escalateRecipients,
  groupIntentsByRecipient,
  resolveUnconfirmedBlockRecipients,
  buildUnconfirmedBlockIntents,
  loadUnconfirmedBlockIntents,
  isUnconfirmedBlockAlreadyNotified,
  notifyUnconfirmedAiBlock,
  UNCONFIRMED_BLOCK_KIND,
  type ProjectMember,
  type ActiveProject,
  type UnconfirmedBlockContext,
  type ReminderIntent,
} from "@/lib/steps/reminders";
import { sendExpoPush } from "@/lib/notifications/push-send";
import {
  isCronAuthorized,
  isAlreadyNotified,
  isDigestAlreadySentToday,
  jakartaToday,
  isMigrationPendingError,
} from "@/app/api/cron/readiness-reminders/route";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Fake Supabase builder ────────────────────────────────────────────────────

/**
 * Minimal chainable mock. Each `.from()` call consumes the next response in the queue.
 */
function fakeClient(
  responses: Array<{ data: unknown[] | null; error: null | { message: string; code?: string } }>,
): SupabaseClient<Database> {
  let idx = 0;

  const makeBuilder = (resp: (typeof responses)[0]) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      neq: () => builder,
      in: () => builder,
      is: () => builder,
      gte: () => builder,
      limit: () => builder,
      insert: () => Promise.resolve(resp),
      // Callers that .maybeSingle()/.single() expect a single object (or
      // null), not an array — unwrap the fixture's `data` array's first
      // element if it's an array, otherwise pass it through as-is.
      maybeSingle: () => Promise.resolve({ ...resp, data: Array.isArray(resp.data) ? (resp.data[0] ?? null) : resp.data }),
      single: () => Promise.resolve({ ...resp, data: Array.isArray(resp.data) ? (resp.data[0] ?? null) : resp.data }),
      then: (resolve: (v: any) => void) => resolve(resp),
    };
    return builder;
  };

  return {
    from(_table: string) {
      const resp = responses[idx++] ?? { data: [], error: null };
      return makeBuilder(resp);
    },
  } as unknown as SupabaseClient<Database>;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = "2026-07-10";
const NOW = "2026-07-10T01:00:00Z";

const PROJECT: ActiveProject = {
  id: "proj-1",
  project_code: "BDG-H1",
  project_name: "Test Project",
  principal_id: "staff-principal",
  pic_id: "staff-pic",
};

const MEMBERS: ProjectMember[] = [
  { staff_id: "staff-supervisor", role_on_project: "site", staff_role: "site_supervisor" },
  { staff_id: "staff-principal", role_on_project: "principal", staff_role: "principal" },
  { staff_id: "staff-designer", role_on_project: "designer", staff_role: "designer" },
];

// ─── tradeRoleToStaffRole ─────────────────────────────────────────────────────

describe("tradeRoleToStaffRole", () => {
  it("returns null for null input", () => {
    expect(tradeRoleToStaffRole(null)).toBeNull();
  });

  it("returns known exact matches as-is", () => {
    expect(tradeRoleToStaffRole("site_supervisor")).toBe("site_supervisor");
    expect(tradeRoleToStaffRole("designer")).toBe("designer");
    expect(tradeRoleToStaffRole("principal")).toBe("principal");
    expect(tradeRoleToStaffRole("estimator")).toBe("estimator");
    expect(tradeRoleToStaffRole("pic")).toBe("pic");
    expect(tradeRoleToStaffRole("admin")).toBe("admin");
  });

  it("handles heuristic partial matches", () => {
    expect(tradeRoleToStaffRole("site supervisor")).toBe("site_supervisor");
    expect(tradeRoleToStaffRole("Supervisor")).toBe("site_supervisor");
    expect(tradeRoleToStaffRole("designer interior")).toBe("designer");
    expect(tradeRoleToStaffRole("estimation")).toBe("estimator");
  });

  it("returns null for unrecognised role", () => {
    expect(tradeRoleToStaffRole("carpenter")).toBeNull();
  });
});

// ─── resolveRecipients ────────────────────────────────────────────────────────

describe("resolveRecipients", () => {
  it("matches project members by trade role (primary path)", () => {
    const result = resolveRecipients("site_supervisor", MEMBERS, PROJECT);
    expect(result).toEqual(["staff-supervisor"]);
  });

  it("falls back to principal/admin members when no trade-role match", () => {
    const result = resolveRecipients("estimator", MEMBERS, PROJECT);
    // No estimator in MEMBERS → fallback to principal
    expect(result).toEqual(["staff-principal"]);
  });

  it("uses project.principal_id as final fallback when no matching members", () => {
    const result = resolveRecipients("estimator", [], PROJECT);
    expect(result).toContain("staff-principal");
  });

  it("includes project.pic_id in final fallback when principal_id absent", () => {
    const projectNoPrincipal: ActiveProject = { ...PROJECT, principal_id: null };
    const result = resolveRecipients("estimator", [], projectNoPrincipal);
    expect(result).toContain("staff-pic");
  });

  it("deduplicates recipients", () => {
    const duped: ProjectMember[] = [
      { staff_id: "staff-supervisor", role_on_project: "a", staff_role: "site_supervisor" },
      { staff_id: "staff-supervisor", role_on_project: "b", staff_role: "site_supervisor" },
    ];
    const result = resolveRecipients("site_supervisor", duped, PROJECT);
    expect(result).toEqual(["staff-supervisor"]);
  });

  it("returns empty array when project has no principal_id or pic_id and no members", () => {
    const bare: ActiveProject = { ...PROJECT, principal_id: null, pic_id: null };
    const result = resolveRecipients(null, [], bare);
    expect(result).toHaveLength(0);
  });
});

// ─── buildReadinessReminders ──────────────────────────────────────────────────

describe("buildReadinessReminders", () => {
  it("returns empty intents when no active projects exist", async () => {
    const supa = fakeClient([
      { data: [], error: null }, // projects
    ]);
    const result = await buildReadinessReminders(supa, TODAY, NOW);
    expect(result.intents).toHaveLength(0);
    expect(result.projectsScanned).toBe(0);
  });

  it("returns empty intents when project has no signals", async () => {
    const supa = fakeClient([
      { data: [PROJECT], error: null },         // projects
      { data: [], error: null },                 // area_steps (no steps → no signals)
      { data: [], error: null },                 // trade_step_deps
      { data: [], error: null },                 // areas
      // getProjectMembers not called since signals.length === 0
    ]);
    const result = await buildReadinessReminders(supa, TODAY, NOW);
    expect(result.intents).toHaveLength(0);
    expect(result.projectsScanned).toBe(1);
    expect(result.signalsFound).toBe(0);
  });

  it("produces an intent with correct shape when a signal exists", async () => {
    // Provide a step that is past its planned_end → behind_plan (high)
    const stepRow = {
      id: "as-1",
      step_code: "B4",
      status: "in_progress",
      planned_start: "2026-07-01",
      planned_end: "2026-07-05", // past TODAY
      actual_start: "2026-07-01",
      actual_end: null,
      blocking_reason: null,
      last_progress_at: null,
      area_id: "area-1",
      trade_steps: {
        name: "Screed",
        step_type: "site_work",
        trade_role: "site_supervisor",
        lead_time_days: 0,
        typical_duration_days: 3,
      },
    };
    const memberRow = {
      staff_id: "staff-supervisor",
      role_on_project: "site",
      staff: { role: "site_supervisor", active: true },
    };

    const supa = fakeClient([
      { data: [PROJECT], error: null },                              // projects
      { data: [stepRow], error: null },                              // area_steps
      { data: [], error: null },                                     // trade_step_deps
      { data: [{ id: "area-1", area_name: "Kamar Mandi A" }], error: null }, // areas
      { data: [memberRow], error: null },                            // project_staff
    ]);

    const result = await buildReadinessReminders(supa, TODAY, NOW);

    expect(result.projectsScanned).toBe(1);
    expect(result.signalsFound).toBeGreaterThan(0);
    expect(result.intents.length).toBeGreaterThan(0);

    const intent = result.intents[0]!;
    expect(intent.recipientStaffId).toBe("staff-supervisor");
    expect(intent.kind).toBe(READINESS_REMINDER_KIND);
    expect(intent.link).toBe("/project/BDG-H1/schedule");
    expect(intent.message).toContain("Kamar Mandi A");
    expect(intent.message).toContain("Screed");
    expect(intent.severity).toBeDefined();
    expect(Array.isArray(intent.escalatedRoles)).toBe(true);
    expect(intent.projectId).toBe("proj-1");
  });

  it("dedupeKey is deterministic for same (recipient, project, area, step, signalKind)", async () => {
    // Build the same scenario twice and compare dedupeKeys
    const stepRow = {
      id: "as-1",
      step_code: "B4",
      status: "in_progress",
      planned_start: "2026-07-01",
      planned_end: "2026-07-05",
      actual_start: null,
      actual_end: null,
      blocking_reason: null,
      last_progress_at: null,
      area_id: "area-1",
      trade_steps: {
        name: "Screed",
        step_type: "site_work",
        trade_role: null,
        lead_time_days: 0,
        typical_duration_days: 3,
      },
    };
    const memberRow = {
      staff_id: "staff-principal",
      role_on_project: "principal",
      staff: { role: "principal", active: true },
    };

    const makeClient = () =>
      fakeClient([
        { data: [PROJECT], error: null },
        { data: [stepRow], error: null },
        { data: [], error: null },
        { data: [{ id: "area-1", area_name: "KM A" }], error: null },
        { data: [memberRow], error: null },
      ]);

    const run1 = await buildReadinessReminders(makeClient(), TODAY, NOW);
    const run2 = await buildReadinessReminders(makeClient(), TODAY, NOW);

    expect(run1.intents.length).toBeGreaterThan(0);
    expect(run1.intents[0]!.dedupeKey).toBe(run2.intents[0]!.dedupeKey);
  });

  it("falls back to principal when no trade-role match in members", async () => {
    const stepRow = {
      id: "as-1",
      step_code: "B4",
      status: "in_progress",
      planned_start: "2026-07-01",
      planned_end: "2026-07-05",
      actual_start: null,
      actual_end: null,
      blocking_reason: null,
      last_progress_at: null,
      area_id: "area-1",
      trade_steps: {
        name: "Screed",
        step_type: "site_work",
        trade_role: "estimator", // no estimator on project
        lead_time_days: 0,
        typical_duration_days: 3,
      },
    };
    const memberRow = {
      staff_id: "staff-principal",
      role_on_project: "principal",
      staff: { role: "principal", active: true },
    };

    const supa = fakeClient([
      { data: [PROJECT], error: null },
      { data: [stepRow], error: null },
      { data: [], error: null },
      { data: [{ id: "area-1", area_name: "KM A" }], error: null },
      { data: [memberRow], error: null },
    ]);

    const result = await buildReadinessReminders(supa, TODAY, NOW);
    const intent = result.intents.find((i) => i.recipientStaffId === "staff-principal");
    expect(intent).toBeDefined();
  });
});

// ─── groupIntentsByRecipient (Task 4: daily brief digest) ────────────────────

describe("groupIntentsByRecipient", () => {
  const TODAY_LOCAL = "2026-07-10";

  function makeIntent(overrides: Partial<ReminderIntent>): ReminderIntent {
    return {
      recipientStaffId: "staff-1",
      kind: READINESS_REMINDER_KIND,
      message: "Signal message",
      link: "/project/BDG-H1/schedule",
      projectId: "proj-1",
      dedupeKey: "dedupe-1",
      severity: "warning",
      escalatedRoles: [],
      ...overrides,
    };
  }

  it("returns no digest for a recipient with exactly one item (single-item policy)", () => {
    const intents = [makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k1" })];
    const result = groupIntentsByRecipient(intents, new Map([["staff-1", "Rani"]]), TODAY_LOCAL);
    expect(result).toEqual([]);
  });

  it("groups a recipient with 2+ items into ONE digest intent", () => {
    const intents = [
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k1", message: "Item A", severity: "warning" }),
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k2", message: "Item B", severity: "high" }),
    ];
    const result = groupIntentsByRecipient(intents, new Map([["staff-1", "Rani"]]), TODAY_LOCAL);
    expect(result).toHaveLength(1);
    const digest = result[0]!;
    expect(digest.recipientStaffId).toBe("staff-1");
    expect(digest.kind).toBe(DAILY_BRIEF_KIND);
    expect(digest.link).toBe("/brief");
    expect(digest.itemCount).toBe(2);
    expect(digest.message).toContain("Pagi Rani");
    expect(digest.message).toContain("2 hal hari ini");
  });

  it("digest dedup key is (recipient, date)", () => {
    const intents = [
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k1" }),
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k2" }),
    ];
    const result = groupIntentsByRecipient(intents, new Map([["staff-1", "Rani"]]), TODAY_LOCAL);
    expect(result[0]!.dedupeKey).toBe("staff-1|2026-07-10");
  });

  it("digest dedup key changes with the date (rolls over daily)", () => {
    const intents = [
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k1" }),
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k2" }),
    ];
    const day1 = groupIntentsByRecipient(intents, new Map([["staff-1", "Rani"]]), "2026-07-10");
    const day2 = groupIntentsByRecipient(intents, new Map([["staff-1", "Rani"]]), "2026-07-11");
    expect(day1[0]!.dedupeKey).not.toBe(day2[0]!.dedupeKey);
  });

  it("orders items by severity (critical first) before composing", () => {
    const intents = [
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k1", message: "Warning item", severity: "warning" }),
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k2", message: "Critical item", severity: "critical" }),
    ];
    const result = groupIntentsByRecipient(intents, new Map([["staff-1", "Rani"]]), TODAY_LOCAL);
    const msg = result[0]!.message;
    expect(msg.indexOf("Critical item")).toBeLessThan(msg.indexOf("Warning item"));
  });

  it("uses the highest-severity item's escalatedRoles for the 'juga dikirim ke' line", () => {
    const intents = [
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k1", severity: "warning", escalatedRoles: ["designer"] }),
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k2", severity: "critical", escalatedRoles: ["principal", "pic"] }),
    ];
    const result = groupIntentsByRecipient(intents, new Map([["staff-1", "Rani"]]), TODAY_LOCAL);
    expect(result[0]!.message).toContain("Juga dikirim ke: principal, PIC.");
    expect(result[0]!.message).not.toContain("designer");
  });

  it("falls back to a generic name when the recipient isn't in staffNames", () => {
    const intents = [
      makeIntent({ recipientStaffId: "staff-unknown", dedupeKey: "k1" }),
      makeIntent({ recipientStaffId: "staff-unknown", dedupeKey: "k2" }),
    ];
    const result = groupIntentsByRecipient(intents, new Map(), TODAY_LOCAL);
    expect(result[0]!.message).toContain("Pagi Tim");
  });

  it("handles multiple recipients independently — mixes digest and single-item skip", () => {
    const intents = [
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k1" }),
      makeIntent({ recipientStaffId: "staff-1", dedupeKey: "k2" }),
      makeIntent({ recipientStaffId: "staff-2", dedupeKey: "k3" }), // single item — no digest
    ];
    const result = groupIntentsByRecipient(
      intents,
      new Map([["staff-1", "Rani"], ["staff-2", "Budi"]]),
      TODAY_LOCAL,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.recipientStaffId).toBe("staff-1");
  });

  it("returns an empty array for an empty intents list", () => {
    expect(groupIntentsByRecipient([], new Map(), TODAY_LOCAL)).toEqual([]);
  });
});

// ─── isAlreadyNotified ────────────────────────────────────────────────────────

describe("isAlreadyNotified", () => {
  const SEVEN_DAYS_AGO = new Date(
    new Date("2026-07-10T00:00:00Z").getTime() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const INTENT = {
    recipientStaffId: "staff-1",
    link: "/project/BDG-H1/schedule",
    kind: READINESS_REMINDER_KIND,
  };

  it("returns true (skip) when an unread matching notification exists", async () => {
    // The mock returns a row → already notified
    const supa = fakeClient([{ data: [{ id: "notif-1" }], error: null }]);
    const result = await isAlreadyNotified(supa as any, INTENT, SEVEN_DAYS_AGO);
    expect(result).toBe(true);
  });

  it("returns false (proceed) when no matching unread notification exists", async () => {
    const supa = fakeClient([{ data: [], error: null }]);
    const result = await isAlreadyNotified(supa as any, INTENT, SEVEN_DAYS_AGO);
    expect(result).toBe(false);
  });

  it("returns true (skip) when the dedup query itself errors", async () => {
    const supa = fakeClient([{ data: null, error: { message: "db error" } }]);
    const result = await isAlreadyNotified(supa as any, INTENT, SEVEN_DAYS_AGO);
    expect(result).toBe(true); // err on the side of not duplicating
  });
});

// ─── isDigestAlreadySentToday (Task 4: digest dedup) ──────────────────────────

describe("isDigestAlreadySentToday", () => {
  const TODAY_START_ISO = "2026-07-10T00:00:00+07:00";

  const DIGEST_INTENT = {
    recipientStaffId: "staff-1",
    link: "/brief",
    kind: DAILY_BRIEF_KIND,
  };

  it("returns true (skip) when a digest was already sent today", async () => {
    const supa = fakeClient([{ data: [{ id: "notif-1" }], error: null }]);
    const result = await isDigestAlreadySentToday(supa as any, DIGEST_INTENT, TODAY_START_ISO);
    expect(result).toBe(true);
  });

  it("returns false (proceed) when no digest has been sent today, regardless of read state", async () => {
    const supa = fakeClient([{ data: [], error: null }]);
    const result = await isDigestAlreadySentToday(supa as any, DIGEST_INTENT, TODAY_START_ISO);
    expect(result).toBe(false);
  });

  it("returns true (skip) when the dedup query itself errors", async () => {
    const supa = fakeClient([{ data: null, error: { message: "db error" } }]);
    const result = await isDigestAlreadySentToday(supa as any, DIGEST_INTENT, TODAY_START_ISO);
    expect(result).toBe(true); // err on the side of not duplicating
  });

  it("filters on recipient, link, kind, and created_at >= start of today (no read_at filter)", async () => {
    const eqCalls: Array<[string, unknown]> = [];
    let gteCall: [string, unknown] | null = null;
    const supa = {
      from(_table: string) {
        const builder: any = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return builder;
          },
          gte: (col: string, val: unknown) => {
            gteCall = [col, val];
            return builder;
          },
          limit: () => Promise.resolve({ data: [], error: null }),
        };
        return builder;
      },
    } as any;

    await isDigestAlreadySentToday(supa, DIGEST_INTENT, TODAY_START_ISO);

    expect(eqCalls).toContainEqual(["recipient_staff_id", "staff-1"]);
    expect(eqCalls).toContainEqual(["link", "/brief"]);
    expect(eqCalls).toContainEqual(["kind", DAILY_BRIEF_KIND]);
    expect(gteCall).toEqual(["created_at", TODAY_START_ISO]);
  });
});

// ─── isCronAuthorized ─────────────────────────────────────────────────────────

describe("isCronAuthorized", () => {
  it("returns true for matching Bearer token", () => {
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer secret123" },
    });
    expect(isCronAuthorized(req, "secret123")).toBe(true);
  });

  it("returns false for wrong token", () => {
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(isCronAuthorized(req, "secret123")).toBe(false);
  });

  it("returns false when secret is undefined", () => {
    const req = new Request("http://localhost", {
      headers: { authorization: "Bearer secret123" },
    });
    expect(isCronAuthorized(req, undefined)).toBe(false);
  });
});

// ─── isMigrationPendingError ──────────────────────────────────────────────────

describe("isMigrationPendingError", () => {
  it("detects PGRST202 code", () => {
    expect(isMigrationPendingError({ code: "PGRST202", message: "not found" })).toBe(true);
  });

  it("detects 'does not exist' in message", () => {
    expect(isMigrationPendingError({ message: "relation area_steps does not exist" })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isMigrationPendingError(null)).toBe(false);
  });

  it("returns false for normal errors", () => {
    expect(isMigrationPendingError({ message: "permission denied" })).toBe(false);
  });
});

// ─── jakartaToday ─────────────────────────────────────────────────────────────

describe("jakartaToday", () => {
  it("returns a YYYY-MM-DD string", () => {
    const today = jakartaToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── escalateRecipients ───────────────────────────────────────────────────────

describe("escalateRecipients", () => {
  const members = [
    { staff_id: "trade1", role_on_project: "x", staff_role: "site_supervisor" },
    { staff_id: "pic1", role_on_project: "x", staff_role: "pic" },
    { staff_id: "prin1", role_on_project: "x", staff_role: "principal" },
  ];
  const project = { principal_id: "prinP", pic_id: "picP" };

  it("info/warning → base unchanged", () => {
    expect(escalateRecipients("info", ["base1"], members, project)).toEqual(["base1"]);
    expect(escalateRecipients("warning", ["base1"], members, project)).toEqual(["base1"]);
  });
  it("high → base + supervision tier (site_supervisor, pic) + project.pic_id, deduped", () => {
    expect(escalateRecipients("high", ["trade1"], members, project)).toEqual(["trade1", "pic1", "picP"]);
  });
  it("critical → also principal members + project.principal_id", () => {
    expect(escalateRecipients("critical", ["base1"], members, project)).toEqual(["base1", "trade1", "pic1", "picP", "prin1", "prinP"]);
  });
  it("skips null project ids", () => {
    expect(escalateRecipients("critical", ["b"], [], { principal_id: null, pic_id: null })).toEqual(["b"]);
  });
});

// ─── sendExpoPush wiring (mock verification) ──────────────────────────────────
//
// The cron route GET handler calls createSupabaseAdminClient() at module init,
// making it not unit-testable in isolation without a full Next.js environment.
// Coverage approach: verify the mock is in place (so tests above do not make
// real Expo HTTP calls) and document that push delivery is verified via:
//   1. The cron route integration test (manual trigger on prod / Vercel cron).
//   2. The `sendExpoPush` unit tests in push-send.test.ts (if present).
// The vi.mock at the top of this file ensures sendExpoPush is inert in all
// readiness-reminders unit tests.

describe("sendExpoPush mock", () => {
  it("is mocked — never throws and resolves immediately", async () => {
    // Verifies the vi.mock wiring is active for this test file.
    await expect(
      sendExpoPush(["staff-1"], { title: "t", body: "b" }),
    ).resolves.toBeUndefined();
    expect(sendExpoPush).toBeDefined();
  });
});

// ─── Unconfirmed AI block notification (Task 3: confirm-gate) ────────────────

describe("resolveUnconfirmedBlockRecipients", () => {
  it("unions trade-role recipients with card watchers, deduped", () => {
    const result = resolveUnconfirmedBlockRecipients(
      "site_supervisor",
      MEMBERS,
      PROJECT,
      ["staff-watcher", "staff-supervisor"], // staff-supervisor also resolves via trade role
    );
    expect(result).toEqual(["staff-supervisor", "staff-watcher"]);
  });

  it("falls back to principal/pic when no trade-role match, still includes watchers", () => {
    const result = resolveUnconfirmedBlockRecipients("estimator", MEMBERS, PROJECT, ["staff-watcher"]);
    expect(result).toContain("staff-principal");
    expect(result).toContain("staff-watcher");
  });

  it("returns just watchers when there are no members and no project fallback", () => {
    const bare: ActiveProject = { ...PROJECT, principal_id: null, pic_id: null };
    const result = resolveUnconfirmedBlockRecipients(null, [], bare, ["staff-watcher"]);
    expect(result).toEqual(["staff-watcher"]);
  });
});

describe("buildUnconfirmedBlockIntents", () => {
  const ctx: UnconfirmedBlockContext = {
    areaStepId: "as-1",
    cardEventId: "ce-1",
    projectId: "proj-1",
    projectCode: "BDG-H1",
    stepName: "Waterproofing",
    stepTradeRole: "site_supervisor",
    areaName: "Kamar Mandi A",
  };

  it("builds one intent per recipient with the expected message, link, and kind", () => {
    const intents = buildUnconfirmedBlockIntents(ctx, ["staff-1", "staff-2"]);
    expect(intents).toHaveLength(2);
    expect(intents[0]!.message).toBe(
      "AI mendeteksi kemungkinan terblokir: Waterproofing (Kamar Mandi A) — buka untuk konfirmasi",
    );
    expect(intents[0]!.link).toBe("/project/BDG-H1/rooms?areaStep=as-1");
    expect(intents[0]!.kind).toBe(UNCONFIRMED_BLOCK_KIND);
    expect(intents[0]!.projectId).toBe("proj-1");
    expect(intents[0]!.cardEventId).toBe("ce-1");
    expect(intents[0]!.areaStepId).toBe("as-1");
  });

  it("dedupeKey is deterministic per (recipient, areaStep, cardEvent)", () => {
    const [a] = buildUnconfirmedBlockIntents(ctx, ["staff-1"]);
    const [b] = buildUnconfirmedBlockIntents(ctx, ["staff-1"]);
    expect(a!.dedupeKey).toBe(b!.dedupeKey);
    expect(a!.dedupeKey).toBe("staff-1|as-1|ce-1");
  });

  it("returns an empty array for an empty recipient list", () => {
    expect(buildUnconfirmedBlockIntents(ctx, [])).toEqual([]);
  });
});

describe("loadUnconfirmedBlockIntents", () => {
  it("returns [] when the area_step can't be resolved", async () => {
    const supa = fakeClient([
      { data: null, error: null }, // area_steps.maybeSingle -> null
      { data: null, error: null }, // card_events
      { data: [PROJECT], error: null }, // projects — never reached in practice but keep queue happy
    ]);
    const intents = await loadUnconfirmedBlockIntents(supa, {
      areaStepId: "as-missing",
      cardEventId: "ce-1",
      projectId: "proj-1",
    });
    expect(intents).toEqual([]);
  });

  it("resolves step/area/project context and builds intents for trade-role + watcher recipients", async () => {
    const stepData = {
      area_id: "area-1",
      trade_steps: { name: "Waterproofing", trade_role: "site_supervisor" },
      areas: { area_name: "Kamar Mandi A" },
    };
    const memberRow = {
      staff_id: "staff-supervisor",
      role_on_project: "site",
      staff: { role: "site_supervisor", active: true },
    };

    // Order matches Promise.all([area_steps, card_events, projects]) then
    // Promise.all([getProjectMembers -> project_staff, card_members]).
    // maybeSingle() unwraps a one-element array fixture to its single object.
    const supa = fakeClient([
      { data: [stepData], error: null }, // area_steps
      { data: [{ card_id: "card-1" }], error: null }, // card_events
      { data: [PROJECT], error: null }, // projects
      { data: [memberRow], error: null }, // project_staff (getProjectMembers)
      { data: [{ staff_id: "staff-watcher" }], error: null }, // card_members
    ]);

    const intents = await loadUnconfirmedBlockIntents(supa, {
      areaStepId: "as-1",
      cardEventId: "ce-1",
      projectId: "proj-1",
    });

    const recipients = intents.map((i) => i.recipientStaffId).sort();
    expect(recipients).toEqual(["staff-supervisor", "staff-watcher"]);
    expect(intents[0]!.message).toContain("Waterproofing");
    expect(intents[0]!.message).toContain("Kamar Mandi A");
  });
});

describe("isUnconfirmedBlockAlreadyNotified", () => {
  const INTENT = {
    recipientStaffId: "staff-1",
    areaStepId: "as-1",
    cardEventId: "ce-1",
    kind: UNCONFIRMED_BLOCK_KIND,
    link: "/project/BDG-H1/rooms?areaStep=as-1",
  };

  it("returns true (skip) when a matching notification already exists for this card_event", async () => {
    const supa = fakeClient([{ data: [{ id: "notif-1" }], error: null }]);
    const result = await isUnconfirmedBlockAlreadyNotified(supa, INTENT);
    expect(result).toBe(true);
  });

  it("returns false (proceed) when no matching notification exists", async () => {
    const supa = fakeClient([{ data: [], error: null }]);
    const result = await isUnconfirmedBlockAlreadyNotified(supa, INTENT);
    expect(result).toBe(false);
  });

  it("returns true (skip) on a dedup query error — err on the side of not duplicating", async () => {
    const supa = fakeClient([{ data: null, error: { message: "db error" } }]);
    const result = await isUnconfirmedBlockAlreadyNotified(supa, INTENT);
    expect(result).toBe(true);
  });

  it("filters on link (which carries area_step_id) in addition to recipient/card_event_id/kind", async () => {
    // Regression for the review finding: the old query only filtered on
    // (recipient_staff_id, card_event_id, kind) — omitting area_step_id (via
    // link) meant a card event blocking TWO area_steps for the same recipient
    // would look like a dup of itself and drop the second notification.
    const eqCalls: Array<[string, unknown]> = [];
    const supa = {
      from(_table: string) {
        const builder: any = {
          select: () => builder,
          eq: (col: string, val: unknown) => {
            eqCalls.push([col, val]);
            return builder;
          },
          limit: () => Promise.resolve({ data: [], error: null }),
        };
        return builder;
      },
    } as any;

    await isUnconfirmedBlockAlreadyNotified(supa, INTENT);

    expect(eqCalls).toContainEqual(["recipient_staff_id", "staff-1"]);
    expect(eqCalls).toContainEqual(["card_event_id", "ce-1"]);
    expect(eqCalls).toContainEqual(["link", "/project/BDG-H1/rooms?areaStep=as-1"]);
    expect(eqCalls).toContainEqual(["kind", UNCONFIRMED_BLOCK_KIND]);
  });
});

describe("notifyUnconfirmedAiBlock", () => {
  it("inserts exactly once per recipient and skips already-notified ones (dedup on card_event_id)", async () => {
    const stepData = {
      area_id: "area-1",
      trade_steps: { name: "Waterproofing", trade_role: "site_supervisor" },
      areas: { area_name: "Kamar Mandi A" },
    };
    const memberRow = {
      staff_id: "staff-supervisor",
      role_on_project: "site",
      staff: { role: "site_supervisor", active: true },
    };

    const inserted: any[] = [];
    let idx = 0;
    const responses = [
      { data: stepData, error: null }, // area_steps
      { data: { card_id: "card-1" }, error: null }, // card_events
      { data: PROJECT, error: null }, // projects
      { data: [memberRow], error: null }, // project_staff
      { data: [{ staff_id: "staff-watcher" }], error: null }, // card_members
      // dedup check for the first recipient: already notified
      { data: [{ id: "notif-existing" }], error: null },
      // dedup check for the second recipient: not yet notified
      { data: [], error: null },
    ];
    const supa = {
      from(table: string) {
        if (table === "notifications" && responses[idx]?.data !== undefined && idx >= 5) {
          // dedup-check calls land here too; handled generically below
        }
        const resp = responses[idx++] ?? { data: [], error: null };
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          in: () => builder,
          is: () => builder,
          limit: () => builder,
          maybeSingle: () => Promise.resolve(resp),
          insert: (row: any) => {
            inserted.push(row);
            return Promise.resolve({ error: null });
          },
          then: (resolve: (v: any) => void) => resolve(resp),
        };
        return builder;
      },
    } as any;

    await notifyUnconfirmedAiBlock(supa, {
      areaStepId: "as-1",
      cardEventId: "ce-1",
      projectId: "proj-1",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      kind: UNCONFIRMED_BLOCK_KIND,
      project_id: "proj-1",
      card_event_id: "ce-1",
      link: "/project/BDG-H1/rooms?areaStep=as-1",
    });
  });

  it("regression: one card event blocking TWO area_steps for the same recipient writes TWO notifications, and a re-run doesn't duplicate either", async () => {
    // Reproduces the review finding directly: a single card note can match
    // more than one area_step (e.g. "kamar mandi A & B kena rembes air" blocks
    // both bathrooms' waterproofing steps). Both intents share the same
    // recipient + card_event_id + kind — only `link` (area_step-specific)
    // tells them apart. Model this by calling notifyUnconfirmedAiBlock twice
    // (once per area_step, as applyStepInference does per matched step) against
    // a shared notifications store, then a third "re-run" pass over both.
    const notificationsStore: any[] = [];

    function makeSupaFor(areaStepId: string, stepName: string) {
      const stepData = {
        area_id: "area-1",
        trade_steps: { name: stepName, trade_role: "site_supervisor" },
        areas: { area_name: "Kamar Mandi" },
      };
      const memberRow = {
        staff_id: "staff-supervisor",
        role_on_project: "site",
        staff: { role: "site_supervisor", active: true },
      };
      let idx = 0;
      const responses = [
        { data: stepData, error: null }, // area_steps
        { data: { card_id: "card-1" }, error: null }, // card_events
        { data: PROJECT, error: null }, // projects
        { data: [memberRow], error: null }, // project_staff
        { data: [], error: null }, // card_members (no extra watchers)
      ];
      return {
        from(table: string) {
          if (table === "notifications") {
            const builder: any = {
              select: () => builder,
              eq(this: any, col: string, val: unknown) {
                this._filters = { ...(this._filters ?? {}), [col]: val };
                return builder;
              },
              limit: () =>
                Promise.resolve({
                  data: notificationsStore.filter(
                    (n) =>
                      n.recipient_staff_id === builder._filters.recipient_staff_id &&
                      n.card_event_id === builder._filters.card_event_id &&
                      n.link === builder._filters.link &&
                      n.kind === builder._filters.kind,
                  ),
                  error: null,
                }),
              insert: (row: any) => {
                notificationsStore.push(row);
                return Promise.resolve({ error: null });
              },
            };
            return builder;
          }
          const resp = responses[idx++] ?? { data: [], error: null };
          const builder: any = {
            select: () => builder,
            eq: () => builder,
            in: () => builder,
            is: () => builder,
            maybeSingle: () => Promise.resolve(resp),
            then: (resolve: (v: any) => void) => resolve(resp),
          };
          return builder;
        },
      } as any;
    }

    // First pass: card event "ce-shared" blocks two distinct area_steps for
    // the same recipient (staff-supervisor resolves via trade role both times).
    await notifyUnconfirmedAiBlock(makeSupaFor("as-1", "Waterproofing"), {
      areaStepId: "as-1",
      cardEventId: "ce-shared",
      projectId: "proj-1",
    });
    await notifyUnconfirmedAiBlock(makeSupaFor("as-2", "Waterproofing"), {
      areaStepId: "as-2",
      cardEventId: "ce-shared",
      projectId: "proj-1",
    });

    expect(notificationsStore).toHaveLength(2);
    expect(new Set(notificationsStore.map((n) => n.link))).toEqual(
      new Set(["/project/BDG-H1/rooms?areaStep=as-1", "/project/BDG-H1/rooms?areaStep=as-2"]),
    );
    expect(notificationsStore.every((n) => n.recipient_staff_id === "staff-supervisor")).toBe(true);
    expect(notificationsStore.every((n) => n.card_event_id === "ce-shared")).toBe(true);

    // Re-run: same two (areaStep, cardEvent) pairs again — must not duplicate either.
    await notifyUnconfirmedAiBlock(makeSupaFor("as-1", "Waterproofing"), {
      areaStepId: "as-1",
      cardEventId: "ce-shared",
      projectId: "proj-1",
    });
    await notifyUnconfirmedAiBlock(makeSupaFor("as-2", "Waterproofing"), {
      areaStepId: "as-2",
      cardEventId: "ce-shared",
      projectId: "proj-1",
    });

    expect(notificationsStore).toHaveLength(2);
  });

  it("never throws even when the underlying client errors", async () => {
    const supa = {
      from() {
        throw new Error("boom");
      },
    } as any;
    await expect(
      notifyUnconfirmedAiBlock(supa, { areaStepId: "as-1", cardEventId: "ce-1", projectId: "proj-1" }),
    ).resolves.toBeUndefined();
  });
});
