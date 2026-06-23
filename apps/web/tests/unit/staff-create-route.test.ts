/**
 * staff-create-route.test.ts
 *
 * Unit tests for POST /api/staff/create.
 *
 * Mocking strategy:
 *   - @/lib/supabase/from-request  → mockCreateSupabaseClientForRequest
 *   - @datum/core                  → mockGetCurrentStaff, mockCanManageAccess (keep schema real)
 *   - @/lib/supabase/admin         → mockCreateSupabaseAdminClient
 *   - server-only                  → aliased to empty stub (vitest config)
 *
 * We import and call the `POST` handler directly with a synthetic `Request`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const {
  mockCreateSupabaseClientForRequest,
  mockGetCurrentStaff,
  mockCanManageAccess,
  mockAdminClient,
  mockCreateSupabaseAdminClient,
} = vi.hoisted(() => {
  const mockAdminAuth = {
    createUser: vi.fn(),
    deleteUser: vi.fn(),
  };
  const mockAdminFrom = vi.fn();
  const mockAdminClient = {
    auth: { admin: mockAdminAuth },
    from: mockAdminFrom,
  };
  const mockCreateSupabaseAdminClient = vi.fn().mockReturnValue(mockAdminClient);

  const mockSupabaseClient = { auth: {} };
  const mockCreateSupabaseClientForRequest = vi.fn().mockResolvedValue(mockSupabaseClient);

  const mockGetCurrentStaff = vi.fn();
  const mockCanManageAccess = vi.fn();

  return {
    mockCreateSupabaseClientForRequest,
    mockGetCurrentStaff,
    mockCanManageAccess,
    mockAdminClient,
    mockCreateSupabaseAdminClient,
  };
});

vi.mock("@/lib/supabase/from-request", () => ({
  createSupabaseClientForRequest: mockCreateSupabaseClientForRequest,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mockCreateSupabaseAdminClient,
}));

vi.mock("@datum/core", async () => {
  // Keep the real validation schema, mock only the I/O helpers.
  const actual = await vi.importActual<typeof import("@datum/core")>("@datum/core");
  return {
    ...actual,
    getCurrentStaff: (...args: unknown[]) => mockGetCurrentStaff(...args),
    canManageAccess: (...args: unknown[]) => mockCanManageAccess(...args),
  };
});

// Import the handler AFTER mocks are registered.
import { POST } from "@/app/api/staff/create/route";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PRINCIPAL_STAFF = {
  id: "staff-principal-001",
  full_name: "Budi Santoso",
  role: "principal" as const,
  email: "budi@test.com",
};

const DESIGNER_STAFF = {
  id: "staff-designer-002",
  full_name: "Cici Marlina",
  role: "designer" as const,
  email: "cici@test.com",
};

const VALID_BODY = {
  email: "baru@datum.com",
  fullName: "Staf Baru",
  role: "designer",
  password: "SecurePass123!",
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/staff/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInsertChain(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ data: null, error }) };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: principal caller, canManage = true
  mockGetCurrentStaff.mockResolvedValue(PRINCIPAL_STAFF);
  mockCanManageAccess.mockReturnValue(true);

  // Admin client: createUser succeeds, insert succeeds
  mockAdminClient.auth.admin.createUser.mockResolvedValue({
    data: { user: { id: "new-user-uuid" } },
    error: null,
  });
  mockAdminClient.auth.admin.deleteUser.mockResolvedValue({ error: null });
  mockAdminClient.from.mockReturnValue(makeInsertChain());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/staff/create", () => {
  it("401 — no staff (unauthenticated)", async () => {
    mockGetCurrentStaff.mockResolvedValue(null);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/sesi/i);
  });

  it("403 — designer (no manage access)", async () => {
    mockGetCurrentStaff.mockResolvedValue(DESIGNER_STAFF);
    mockCanManageAccess.mockReturnValue(false);

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(403);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/principal atau admin/i);
  });

  it("400 — missing required field (email)", async () => {
    const badBody = { ...VALID_BODY, email: "not-an-email" };

    const res = await POST(makeRequest(badBody));

    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it("400 — password too short", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, password: "short" }));

    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/8/);
  });

  it("400 — invalid role value", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, role: "superuser" }));

    expect(res.status).toBe(400);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("403 — admin trying to create a principal", async () => {
    const adminStaff = { ...PRINCIPAL_STAFF, role: "admin" as const };
    mockGetCurrentStaff.mockResolvedValue(adminStaff);
    // canManageAccess returns true for admin, role-escalation guard fires after

    const res = await POST(makeRequest({ ...VALID_BODY, role: "principal" }));

    expect(res.status).toBe(403);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/hanya principal/i);
  });

  it("200 — principal + valid body → ok:true + staffId + tempPassword", async () => {
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; staffId: string; email: string; tempPassword: string };
    expect(body.ok).toBe(true);
    expect(body.staffId).toBe("new-user-uuid");
    expect(body.email).toBe(VALID_BODY.email);
    expect(body.tempPassword).toBe(VALID_BODY.password);
  });

  it("200 — principal creating another principal succeeds", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, role: "principal" }));

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("409 — duplicate email from auth layer", async () => {
    mockAdminClient.auth.admin.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(409);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/sudah terdaftar/i);
  });

  it("500 — staff insert fails → rolls back auth user", async () => {
    // First call (staff table insert) fails; admin.from('staff') returns error
    mockAdminClient.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: { message: "constraint violation" } }),
    });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    const body = await res.json() as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    // Rollback: deleteUser should have been called
    expect(mockAdminClient.auth.admin.deleteUser).toHaveBeenCalledWith("new-user-uuid");
  });

  it("calls createSupabaseAdminClient only AFTER auth check passes", async () => {
    mockGetCurrentStaff.mockResolvedValue(null);

    await POST(makeRequest(VALID_BODY));

    // Admin client should NOT be instantiated if caller is unauthenticated
    expect(mockCreateSupabaseAdminClient).not.toHaveBeenCalled();
  });
});
