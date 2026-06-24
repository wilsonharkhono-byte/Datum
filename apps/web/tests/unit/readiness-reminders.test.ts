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

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  tradeRoleToStaffRole,
  resolveRecipients,
  buildReadinessReminders,
  getActiveProjects,
  getProjectMembers,
  READINESS_REMINDER_KIND,
  type ProjectMember,
  type ActiveProject,
} from "@/lib/steps/reminders";
import {
  isCronAuthorized,
  isAlreadyNotified,
  jakartaToday,
  isMigrationPendingError,
  GET,
} from "@/app/api/cron/readiness-reminders/route";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Module-level mocks (hoisted) ────────────────────────────────────────────

// Mock server-only modules that the cron route imports. These must be declared
// before any imports that transitively pull in these modules.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/notifications/push-send", () => ({
  sendExpoPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

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

// ─── GET handler — sendExpoPush integration ───────────────────────────────────

describe("GET /api/cron/readiness-reminders — push integration", () => {
  // Import the mocked modules so we can control/assert them per-test.
  // vi.mock() is hoisted, so the push-send and supabase/admin mocks are active.
  // buildReadinessReminders is the real export; we spy on it per-test via vi.spyOn.
  let sendExpoPushMock: ReturnType<typeof vi.fn>;
  let createAdminMock: ReturnType<typeof vi.fn>;
  let buildRemindersSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const pushModule = await import("@/lib/notifications/push-send");
    sendExpoPushMock = pushModule.sendExpoPush as ReturnType<typeof vi.fn>;

    const adminModule = await import("@/lib/supabase/admin");
    createAdminMock = adminModule.createSupabaseAdminClient as ReturnType<typeof vi.fn>;

    // Spy on the real buildReadinessReminders so existing describe blocks
    // continue using the real implementation.
    const remindersModule = await import("@/lib/steps/reminders");
    buildRemindersSpy = vi.spyOn(remindersModule, "buildReadinessReminders");
  });

  /** Build a cron-authorised Request */
  function cronReq() {
    return new Request("http://localhost/api/cron/readiness-reminders", {
      headers: { authorization: "Bearer test-secret" },
    });
  }

  /** Minimal chainable Supabase mock for the cron route's dedup + insert calls */
  function makeAdmin(
    dedupData: unknown[] | null,
    dedupError: { message: string } | null,
    insertError: { message: string } | null,
  ) {
    let callCount = 0;
    const makeBuilder = (resp: { data: unknown[] | null; error: typeof dedupError }) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        is: () => b,
        gte: () => b,
        limit: () => b,
        insert: () => Promise.resolve({ error: insertError }),
        then: (resolve: (v: any) => void) => resolve(resp),
      };
      return b;
    };

    return {
      from(_table: string) {
        // First call = dedup query, second call = insert
        callCount++;
        if (callCount === 1) return makeBuilder({ data: dedupData, error: dedupError });
        return makeBuilder({ data: [], error: insertError });
      },
    };
  }

  const INTENT_A = {
    recipientStaffId: "staff-A",
    kind: READINESS_REMINDER_KIND,
    message: "Kamar Mandi A: Screed terlambat",
    link: "/project/BDG-H1/schedule",
    projectId: "proj-1",
    dedupeKey: "staff-A|proj-1|area-1|B4|behind_plan",
  };

  it("calls sendExpoPush for a written intent with correct payload", async () => {
    process.env.CRON_SECRET = "test-secret";

    buildRemindersSpy.mockResolvedValue({
      intents: [INTENT_A],
      projectsScanned: 1,
      signalsFound: 1,
    });

    // dedup returns empty (not yet notified) → will insert
    createAdminMock.mockReturnValue(makeAdmin([], null, null));

    const res = await GET(cronReq());
    const body = await res.json();

    expect(body.written).toBe(1);
    expect(body.pushed).toBe(1);
    expect(sendExpoPushMock).toHaveBeenCalledOnce();
    expect(sendExpoPushMock).toHaveBeenCalledWith(
      ["staff-A"],
      {
        title: "Pengingat kesiapan",
        body: INTENT_A.message,
        data: { link: INTENT_A.link },
      },
    );
  });

  it("does NOT call sendExpoPush for a deduped (skipped) intent", async () => {
    process.env.CRON_SECRET = "test-secret";

    buildRemindersSpy.mockResolvedValue({
      intents: [INTENT_A],
      projectsScanned: 1,
      signalsFound: 1,
    });

    // dedup returns a row → already notified → skip insert
    createAdminMock.mockReturnValue(makeAdmin([{ id: "existing-notif" }], null, null));

    const res = await GET(cronReq());
    const body = await res.json();

    expect(body.skippedDup).toBe(1);
    expect(body.written).toBe(0);
    expect(body.pushed).toBe(0);
    expect(sendExpoPushMock).not.toHaveBeenCalled();
  });

  it("does not throw and still returns success when sendExpoPush rejects", async () => {
    process.env.CRON_SECRET = "test-secret";

    buildRemindersSpy.mockResolvedValue({
      intents: [INTENT_A],
      projectsScanned: 1,
      signalsFound: 1,
    });

    // Insert succeeds
    createAdminMock.mockReturnValue(makeAdmin([], null, null));

    // Push explodes
    sendExpoPushMock.mockRejectedValueOnce(new Error("Expo push failed"));

    const res = await GET(cronReq());
    expect(res.status).toBe(200);

    const body = await res.json();
    // written = 1 (insert succeeded), pushed = 0 (push threw, caught)
    expect(body.written).toBe(1);
    expect(body.pushed).toBe(0);
    expect(body.failed).toBe(0);
  });
});
