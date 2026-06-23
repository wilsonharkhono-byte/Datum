import { describe, it, expect, vi } from "vitest";
import { CreateProjectInput, createProject } from "./create";
import { canManageRole } from "../auth/current-staff";

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe("CreateProjectInput", () => {
  it("accepts a valid input", () => {
    const result = CreateProjectInput.safeParse({
      projectCode: "ABC-001",
      projectName: "Test Project",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectCode).toBe("ABC-001");
      expect(result.data.status).toBe("design"); // default
    }
  });

  it("accepts a full valid input with all optional fields", () => {
    const result = CreateProjectInput.safeParse({
      projectCode:    "PROJ-123",
      projectName:    "Full Project",
      clientName:     "PT Klien",
      location:       "Jakarta",
      status:         "construction",
      targetHandover: "2026-12-31",
      startDate:      "2026-01-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a projectCode with lowercase letters", () => {
    const result = CreateProjectInput.safeParse({
      projectCode: "abc-001",
      projectName: "Test",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.path[0]);
      expect(codes).toContain("projectCode");
    }
  });

  it("rejects a projectCode with spaces", () => {
    const result = CreateProjectInput.safeParse({
      projectCode: "ABC 001",
      projectName: "Test",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.path[0]);
      expect(codes).toContain("projectCode");
    }
  });

  it("rejects a projectCode that is too short (< 2 chars)", () => {
    const result = CreateProjectInput.safeParse({
      projectCode: "A",
      projectName: "Test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing projectName", () => {
    const result = CreateProjectInput.safeParse({
      projectCode: "ABC-001",
      projectName: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const codes = result.error.issues.map((i) => i.path[0]);
      expect(codes).toContain("projectName");
    }
  });

  it("rejects a missing projectCode", () => {
    const result = CreateProjectInput.safeParse({
      projectName: "Test",
    });
    expect(result.success).toBe(false);
  });
});

// ─── canManageRole truth table ────────────────────────────────────────────────

describe("canManageRole", () => {
  it("returns true for principal", () => {
    expect(canManageRole("principal")).toBe(true);
  });

  it("returns true for admin", () => {
    expect(canManageRole("admin")).toBe(true);
  });

  it("returns false for designer", () => {
    expect(canManageRole("designer")).toBe(false);
  });

  it("returns false for pic", () => {
    expect(canManageRole("pic")).toBe(false);
  });

  it("returns false for site_supervisor", () => {
    expect(canManageRole("site_supervisor")).toBe(false);
  });

  it("returns false for estimator", () => {
    expect(canManageRole("estimator")).toBe(false);
  });
});

// ─── createProject mutation ───────────────────────────────────────────────────

function makeMockSupabase(overrides?: {
  projectsInsertError?: { code: string; message: string } | null;
  projectsInsertData?: { id: string; project_code: string } | null;
  projectStaffInsertError?: { message: string } | null;
}) {
  const projectData = overrides?.projectsInsertData !== undefined
    ? overrides.projectsInsertData
    : { id: "proj-uuid-1", project_code: "ABC-001" };

  const projectError = overrides?.projectsInsertError !== undefined
    ? overrides.projectsInsertError
    : null;

  const staffError = overrides?.projectStaffInsertError !== undefined
    ? overrides.projectStaffInsertError
    : null;

  // Mock the chained builder returned by .from("projects").insert(...).select(...).single()
  const projectsSingle = vi.fn().mockResolvedValue({ data: projectData, error: projectError });
  const projectsSelect = vi.fn().mockReturnValue({ single: projectsSingle });
  const projectsInsert = vi.fn().mockReturnValue({ select: projectsSelect });

  // Mock the chained builder returned by .from("project_staff").insert(...)
  const staffInsert = vi.fn().mockResolvedValue({ data: null, error: staffError });

  const from = vi.fn((table: string) => {
    if (table === "projects") {
      return { insert: projectsInsert };
    }
    if (table === "project_staff") {
      return { insert: staffInsert };
    }
    return {};
  });

  return { from } as unknown as Parameters<typeof createProject>[0];
}

const validInput: Parameters<typeof createProject>[1] = {
  projectCode: "ABC-001",
  projectName: "Test Project",
  status:      "design",
};

describe("createProject", () => {
  it("returns forbidden result for a designer caller", async () => {
    const supabase = makeMockSupabase();
    const result = await createProject(supabase, validInput, { id: "user-1", role: "designer" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Hanya principal atau admin yang bisa membuat proyek baru");
    }
  });

  it("returns forbidden result for a pic caller", async () => {
    const supabase = makeMockSupabase();
    const result = await createProject(supabase, validInput, { id: "user-1", role: "pic" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("principal atau admin");
    }
  });

  it("returns forbidden result for a site_supervisor caller", async () => {
    const supabase = makeMockSupabase();
    const result = await createProject(supabase, validInput, {
      id:   "user-1",
      role: "site_supervisor",
    });
    expect(result.ok).toBe(false);
  });

  it("maps a 23505 insert error to 'sudah dipakai' with fieldErrors", async () => {
    const supabase = makeMockSupabase({
      projectsInsertError: { code: "23505", message: "duplicate key value" },
      projectsInsertData:  null,
    });
    const result = await createProject(supabase, validInput, { id: "user-1", role: "principal" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ABC-001");
      expect(result.error).toContain("sudah dipakai");
      expect(result.fieldErrors).toEqual({ projectCode: "Sudah ada" });
    }
  });

  it("returns ok: true with projectCode on success (principal)", async () => {
    const supabase = makeMockSupabase();
    const result = await createProject(supabase, validInput, { id: "user-1", role: "principal" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projectCode).toBe("ABC-001");
    }
  });

  it("returns ok: true on success (admin)", async () => {
    const supabase = makeMockSupabase();
    const result = await createProject(supabase, validInput, { id: "user-2", role: "admin" });
    expect(result.ok).toBe(true);
  });

  it("returns error when project_staff insert fails", async () => {
    const supabase = makeMockSupabase({
      projectStaffInsertError: { message: "FK constraint violation" },
    });
    const result = await createProject(supabase, validInput, { id: "user-1", role: "principal" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Proyek dibuat tapi gagal menambahkan Anda sebagai anggota");
    }
  });

  it("surfaces a non-23505 DB error verbatim", async () => {
    const supabase = makeMockSupabase({
      projectsInsertError: { code: "42501", message: "permission denied for table projects" },
      projectsInsertData:  null,
    });
    const result = await createProject(supabase, validInput, { id: "user-1", role: "admin" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("permission denied for table projects");
    }
  });
});
