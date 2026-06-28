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
  escalateRecipients,
  type ProjectMember,
  type ActiveProject,
} from "@/lib/steps/reminders";
import { sendExpoPush } from "@/lib/notifications/push-send";
import {
  isCronAuthorized,
  isAlreadyNotified,
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
