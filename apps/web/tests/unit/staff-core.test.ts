/**
 * staff-core.test.ts
 *
 * Unit tests for createStaffWithPasswordCore (the shared server-only module).
 * Mocks the admin client directly — no HTTP, no FormData, no auth/authz.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const { mockAdminAuth, mockAdminFrom, mockAdminClient } = vi.hoisted(() => {
  const mockAdminAuth = {
    createUser: vi.fn(),
    deleteUser: vi.fn(),
  };
  const mockAdminFrom = vi.fn();
  const mockAdminClient = {
    auth: { admin: mockAdminAuth },
    from: mockAdminFrom,
  };
  return { mockAdminAuth, mockAdminFrom, mockAdminClient };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn().mockReturnValue(mockAdminClient),
}));

import { createStaffWithPasswordCore } from "@/lib/projects/staff-core";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_INPUT = {
  email:       "baru@datum.com",
  fullName:    "Staf Baru",
  role:        "designer" as const,
  password:    "SecurePass123!",
};

function makeInsertChain(error: unknown = null) {
  return { insert: vi.fn().mockResolvedValue({ data: null, error }) };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockAdminAuth.createUser.mockResolvedValue({
    data: { user: { id: "new-user-uuid" } },
    error: null,
  });
  mockAdminAuth.deleteUser.mockResolvedValue({ error: null });
  mockAdminFrom.mockReturnValue(makeInsertChain());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("createStaffWithPasswordCore", () => {
  it("happy path — returns ok:true + staffId + email", async () => {
    const result = await createStaffWithPasswordCore(mockAdminClient as never, BASE_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.staffId).toBe("new-user-uuid");
    expect(result.email).toBe(BASE_INPUT.email);
  });

  it("happy path — calls createUser with email_confirm:true and full_name metadata", async () => {
    await createStaffWithPasswordCore(mockAdminClient as never, BASE_INPUT);

    expect(mockAdminAuth.createUser).toHaveBeenCalledWith({
      email:         BASE_INPUT.email,
      password:      BASE_INPUT.password,
      email_confirm: true,
      user_metadata: { full_name: BASE_INPUT.fullName },
    });
  });

  it("duplicate email from Supabase Auth → ok:false with sudah terdaftar message", async () => {
    mockAdminAuth.createUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered" },
    });

    const result = await createStaffWithPasswordCore(mockAdminClient as never, BASE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/sudah terdaftar/i);
  });

  it("staff insert fails → rolls back auth user + returns ok:false", async () => {
    mockAdminFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "constraint violation", code: "23503" },
      }),
    });

    const result = await createStaffWithPasswordCore(mockAdminClient as never, BASE_INPUT);

    expect(result.ok).toBe(false);
    expect(mockAdminAuth.deleteUser).toHaveBeenCalledWith("new-user-uuid");
  });

  it("staff insert fails with 23505 → ok:false with sudah terdaftar di tabel staf", async () => {
    mockAdminFrom.mockReturnValue({
      insert: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "duplicate key", code: "23505" },
      }),
    });

    const result = await createStaffWithPasswordCore(mockAdminClient as never, BASE_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/sudah terdaftar/i);
    expect(mockAdminAuth.deleteUser).toHaveBeenCalledWith("new-user-uuid");
  });

  it("with projectId + roleOnProject — inserts project_staff row", async () => {
    const inputWithProject = {
      ...BASE_INPUT,
      projectId:     "proj-uuid-001",
      roleOnProject: "pic",
    };

    // First call = staff insert (ok), second call = project_staff insert (ok)
    mockAdminFrom
      .mockReturnValueOnce(makeInsertChain())
      .mockReturnValueOnce(makeInsertChain());

    const result = await createStaffWithPasswordCore(mockAdminClient as never, inputWithProject);

    expect(result.ok).toBe(true);
    expect(mockAdminFrom).toHaveBeenCalledTimes(2);
    const secondCall = mockAdminFrom.mock.calls[1]?.[0];
    expect(secondCall).toBe("project_staff");
  });

  it("project_staff insert fails → ok:false with staf dibuat message", async () => {
    const inputWithProject = {
      ...BASE_INPUT,
      projectId:     "proj-uuid-001",
      roleOnProject: "pic",
    };

    mockAdminFrom
      .mockReturnValueOnce(makeInsertChain()) // staff OK
      .mockReturnValueOnce(makeInsertChain({ message: "fk violation" })); // project_staff fails

    const result = await createStaffWithPasswordCore(mockAdminClient as never, inputWithProject);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toMatch(/staf dibuat tapi gagal/i);
  });

  it("without projectId — only inserts staff row (no project_staff call)", async () => {
    await createStaffWithPasswordCore(mockAdminClient as never, BASE_INPUT);

    expect(mockAdminFrom).toHaveBeenCalledTimes(1);
    expect(mockAdminFrom.mock.calls[0]?.[0]).toBe("staff");
  });
});
