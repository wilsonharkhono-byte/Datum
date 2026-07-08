import { describe, it, expect, vi } from "vitest";
import {
  AddProjectMemberInput,
  RemoveProjectMemberInput,
  UpdateProjectMemberInput,
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
} from "./member-write";
import { UpdateProjectInput, updateProject } from "./update";
import { CreateStaffInput, STAFF_ROLES } from "../validation/staff";

// ─── Schema tests: AddProjectMemberInput ─────────────────────────────────────

describe("AddProjectMemberInput", () => {
  it("accepts a valid input", () => {
    const r = AddProjectMemberInput.safeParse({
      projectId:     "00000000-0000-0000-0000-000000000001",
      staffId:       "00000000-0000-0000-0000-000000000002",
      roleOnProject: "designer",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-uuid projectId", () => {
    const r = AddProjectMemberInput.safeParse({
      projectId:     "not-a-uuid",
      staffId:       "00000000-0000-0000-0000-000000000002",
      roleOnProject: "designer",
    });
    expect(r.success).toBe(false);
  });

  it("accepts an optional costVisible flag", () => {
    const r = AddProjectMemberInput.safeParse({
      projectId:     "00000000-0000-0000-0000-000000000001",
      staffId:       "00000000-0000-0000-0000-000000000002",
      roleOnProject: "site supervisor",
      costVisible:   true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty roleOnProject", () => {
    const r = AddProjectMemberInput.safeParse({
      projectId:     "00000000-0000-0000-0000-000000000001",
      staffId:       "00000000-0000-0000-0000-000000000002",
      roleOnProject: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("RemoveProjectMemberInput", () => {
  it("accepts a valid input", () => {
    const r = RemoveProjectMemberInput.safeParse({
      projectId:     "00000000-0000-0000-0000-000000000001",
      staffId:       "00000000-0000-0000-0000-000000000002",
      roleOnProject: "pic",
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing staffId", () => {
    const r = RemoveProjectMemberInput.safeParse({
      projectId:     "00000000-0000-0000-0000-000000000001",
      roleOnProject: "pic",
    });
    expect(r.success).toBe(false);
  });
});

// ─── addProjectMember ────────────────────────────────────────────────────────

const PROJ_ID  = "00000000-0000-0000-0000-000000000001";
const STAFF_ID = "00000000-0000-0000-0000-000000000002";
const ROLE     = "designer";

function makeAddSupabase(opts: {
  existingRow?: { active_until: string | null } | null;
  updateError?: { message: string } | null;
  insertError?: { message: string } | null;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: opts.existingRow !== undefined ? opts.existingRow : null,
    error: null,
  });
  const selectChain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle,
  };

  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    mockResult: { error: opts.updateError ?? null },
  };
  // Make .eq().eq().eq() return a thenable
  (updateChain.eq as ReturnType<typeof vi.fn>).mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: opts.updateError ?? null }),
    }),
  });
  const update = vi.fn().mockReturnValue(updateChain);

  const insertResult = { error: opts.insertError ?? null };
  const insert = vi.fn().mockResolvedValue(insertResult);

  const from = vi.fn((table: string) => {
    if (table === "project_staff") {
      return {
        select: vi.fn().mockReturnValue(selectChain),
        update,
        insert,
      };
    }
    return {};
  });

  return { from } as unknown as Parameters<typeof addProjectMember>[0];
}

describe("addProjectMember", () => {
  const input = { projectId: PROJ_ID, staffId: STAFF_ID, roleOnProject: ROLE };

  it("returns 'Anggota sudah aktif' when existing active row exists", async () => {
    const supabase = makeAddSupabase({ existingRow: { active_until: null } });
    const r = await addProjectMember(supabase, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Anggota sudah aktif dengan peran ini");
  });

  it("calls update (un-remove) when existing soft-deleted row exists", async () => {
    const supabase = makeAddSupabase({ existingRow: { active_until: "2026-01-01" } });
    const r = await addProjectMember(supabase, input);
    expect(r.ok).toBe(true);
  });

  it("calls insert when no existing row", async () => {
    const supabase = makeAddSupabase({ existingRow: null });
    const r = await addProjectMember(supabase, input);
    expect(r.ok).toBe(true);
  });

  it("surfaces insert error", async () => {
    const supabase = makeAddSupabase({
      existingRow: null,
      insertError: { message: "FK violation" },
    });
    const r = await addProjectMember(supabase, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("FK violation");
  });

  it("defaults cost_visible to false on insert when omitted", async () => {
    const supabase = makeAddSupabase({ existingRow: null });
    await addProjectMember(supabase, input);
    const fromFn = supabase.from as unknown as ReturnType<typeof vi.fn>;
    const insertFn = fromFn.mock.results[0]!.value.insert as ReturnType<typeof vi.fn>;
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({ cost_visible: false }));
  });

  it("passes cost_visible: true through to insert when provided", async () => {
    const supabase = makeAddSupabase({ existingRow: null });
    await addProjectMember(supabase, { ...input, costVisible: true });
    const fromFn = supabase.from as unknown as ReturnType<typeof vi.fn>;
    const insertFn = fromFn.mock.results[0]!.value.insert as ReturnType<typeof vi.fn>;
    expect(insertFn).toHaveBeenCalledWith(expect.objectContaining({ cost_visible: true }));
  });
});

// ─── removeProjectMember ─────────────────────────────────────────────────────

function makeRemoveSupabase(opts: { updateError?: { message: string } | null } = {}) {
  // .from("project_staff").update(...).eq().eq().eq().is()  → result
  const isChain = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const eqChain = { eq: vi.fn().mockReturnThis(), is: isChain };
  (eqChain.eq as ReturnType<typeof vi.fn>).mockReturnValue(eqChain);
  const update = vi.fn().mockReturnValue(eqChain);

  const from = vi.fn().mockReturnValue({ update });
  return { from } as unknown as Parameters<typeof removeProjectMember>[0];
}

describe("removeProjectMember", () => {
  const input = { projectId: PROJ_ID, staffId: STAFF_ID, roleOnProject: ROLE };

  it("returns ok: true on success", async () => {
    const supabase = makeRemoveSupabase();
    const r = await removeProjectMember(supabase, input);
    expect(r.ok).toBe(true);
  });

  it("returns error on DB failure", async () => {
    const supabase = makeRemoveSupabase({ updateError: { message: "RLS denied" } });
    const r = await removeProjectMember(supabase, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("RLS denied");
  });
});

// ─── UpdateProjectMemberInput schema ─────────────────────────────────────────

describe("UpdateProjectMemberInput", () => {
  it("accepts a valid input", () => {
    const r = UpdateProjectMemberInput.safeParse({
      projectId:     PROJ_ID,
      staffId:       STAFF_ID,
      roleOnProject: "site supervisor",
      costVisible:   true,
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing costVisible", () => {
    const r = UpdateProjectMemberInput.safeParse({
      projectId:     PROJ_ID,
      staffId:       STAFF_ID,
      roleOnProject: "site supervisor",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty roleOnProject", () => {
    const r = UpdateProjectMemberInput.safeParse({
      projectId:     PROJ_ID,
      staffId:       STAFF_ID,
      roleOnProject: "",
      costVisible:   false,
    });
    expect(r.success).toBe(false);
  });
});

// ─── updateProjectMember ──────────────────────────────────────────────────────

function makeUpdateMemberSupabase(opts: { updateError?: { message: string } | null } = {}) {
  // .from("project_staff").update(...).eq().eq().is()  → result
  const isChain = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const eqChain = { eq: vi.fn().mockReturnThis(), is: isChain };
  (eqChain.eq as ReturnType<typeof vi.fn>).mockReturnValue(eqChain);
  const update = vi.fn().mockReturnValue(eqChain);

  const from = vi.fn().mockReturnValue({ update });
  return { from } as unknown as Parameters<typeof updateProjectMember>[0];
}

describe("updateProjectMember", () => {
  const input = { projectId: PROJ_ID, staffId: STAFF_ID, roleOnProject: "site supervisor", costVisible: true };

  it("returns ok: true on success", async () => {
    const supabase = makeUpdateMemberSupabase();
    const r = await updateProjectMember(supabase, input);
    expect(r.ok).toBe(true);
  });

  it("returns error on DB failure", async () => {
    const supabase = makeUpdateMemberSupabase({ updateError: { message: "RLS denied" } });
    const r = await updateProjectMember(supabase, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("RLS denied");
  });

  it("passes role_on_project and cost_visible to the update payload", async () => {
    const supabase = makeUpdateMemberSupabase();
    await updateProjectMember(supabase, input);
    const fromFn = supabase.from as unknown as ReturnType<typeof vi.fn>;
    const updateFn = fromFn.mock.results[0]!.value.update as ReturnType<typeof vi.fn>;
    expect(updateFn).toHaveBeenCalledWith({ role_on_project: "site supervisor", cost_visible: true });
  });
});

// ─── UpdateProjectInput schema ────────────────────────────────────────────────

describe("UpdateProjectInput", () => {
  it("accepts a minimal patch (just projectId)", () => {
    const r = UpdateProjectInput.safeParse({
      projectId: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.success).toBe(true);
  });

  it("accepts null for nullable fields", () => {
    const r = UpdateProjectInput.safeParse({
      projectId:  "00000000-0000-0000-0000-000000000001",
      clientName: null,
      location:   null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const r = UpdateProjectInput.safeParse({
      projectId: "00000000-0000-0000-0000-000000000001",
      status:    "unknown",
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-uuid projectId", () => {
    const r = UpdateProjectInput.safeParse({ projectId: "bad" });
    expect(r.success).toBe(false);
  });
});

// ─── updateProject ────────────────────────────────────────────────────────────

function makeUpdateSupabase(opts: {
  updateError?: { message: string } | null;
  devFound?: { id: string } | null;
  devInsertData?: { id: string } | null;
  devInsertError?: { message: string } | null;
} = {}) {
  // For developments lookup
  const devMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.devFound !== undefined ? opts.devFound : null,
    error: null,
  });
  const devSelectChain = {
    ilike: vi.fn().mockReturnValue({ maybeSingle: devMaybeSingle }),
  };
  const devInsertSingle = vi.fn().mockResolvedValue({
    data: opts.devInsertData ?? { id: "dev-uuid-1" },
    error: opts.devInsertError ?? null,
  });
  const devInsertChain = { select: vi.fn().mockReturnValue({ single: devInsertSingle }) };

  // For projects update
  const projUpdateEq = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
  const projUpdate = vi.fn().mockReturnValue({ eq: projUpdateEq });

  const from = vi.fn((table: string) => {
    if (table === "developments") {
      return { select: vi.fn().mockReturnValue(devSelectChain), insert: vi.fn().mockReturnValue(devInsertChain) };
    }
    if (table === "projects") {
      return { update: projUpdate };
    }
    return {};
  });

  return { from } as unknown as Parameters<typeof updateProject>[0];
}

describe("updateProject", () => {
  const BASE = { projectId: "00000000-0000-0000-0000-000000000001" };

  it("returns ok: true for an empty patch", async () => {
    const supabase = makeUpdateSupabase();
    const r = await updateProject(supabase, BASE);
    expect(r.ok).toBe(true);
    // No DB call should be made for an empty patch
    expect((supabase.from as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("returns ok: true when updating projectName", async () => {
    const supabase = makeUpdateSupabase();
    const r = await updateProject(supabase, { ...BASE, projectName: "New Name" });
    expect(r.ok).toBe(true);
  });

  it("surfaces DB error", async () => {
    const supabase = makeUpdateSupabase({ updateError: { message: "permission denied" } });
    const r = await updateProject(supabase, { ...BASE, projectName: "X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("permission denied");
  });

  it("resolves existing developmentName → sets development_id", async () => {
    const supabase = makeUpdateSupabase({ devFound: { id: "dev-uuid-existing" } });
    const r = await updateProject(supabase, { ...BASE, developmentName: "Citra Garden" });
    expect(r.ok).toBe(true);
  });

  it("creates a new development if not found", async () => {
    const supabase = makeUpdateSupabase({ devFound: null, devInsertData: { id: "dev-uuid-new" } });
    const r = await updateProject(supabase, { ...BASE, developmentName: "New Dev" });
    expect(r.ok).toBe(true);
  });

  it("clears development_id when developmentName is null", async () => {
    const supabase = makeUpdateSupabase();
    const r = await updateProject(supabase, { ...BASE, developmentName: null });
    expect(r.ok).toBe(true);
  });
});

// ─── CreateStaffInput schema ──────────────────────────────────────────────────

describe("CreateStaffInput", () => {
  const VALID = {
    email:    "staff@example.com",
    fullName: "Budi Santoso",
    role:     "designer",
    password: "password123",
  };

  it("accepts a minimal valid input", () => {
    expect(CreateStaffInput.safeParse(VALID).success).toBe(true);
  });

  it("rejects invalid email", () => {
    const r = CreateStaffInput.safeParse({ ...VALID, email: "not-an-email" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs).toContain("Email tidak valid");
    }
  });

  it("rejects fullName shorter than 2 chars", () => {
    const r = CreateStaffInput.safeParse({ ...VALID, fullName: "A" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs).toContain("Nama minimal 2 huruf");
    }
  });

  it("rejects password shorter than 8 chars", () => {
    const r = CreateStaffInput.safeParse({ ...VALID, password: "short" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs).toContain("Password minimal 8 karakter");
    }
  });

  it("rejects an invalid role", () => {
    const r = CreateStaffInput.safeParse({ ...VALID, role: "superuser" });
    expect(r.success).toBe(false);
  });
});

describe("STAFF_ROLES", () => {
  it("contains the six expected roles", () => {
    expect(STAFF_ROLES).toEqual([
      "principal",
      "designer",
      "pic",
      "site_supervisor",
      "admin",
      "estimator",
    ]);
  });

  it("has exactly 6 roles", () => {
    expect(STAFF_ROLES.length).toBe(6);
  });
});
