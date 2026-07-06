import { describe, it, expect, vi } from "vitest";
import { UpdateProjectInput, updateProject } from "./update";

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe("UpdateProjectInput", () => {
  it("accepts a valid projectCode patch", () => {
    const result = UpdateProjectInput.safeParse({
      projectId:   "11111111-1111-1111-1111-111111111111",
      projectCode: "ARCH-GRAHA-FAMILI-XA-15",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a projectCode with lowercase letters", () => {
    const result = UpdateProjectInput.safeParse({
      projectId:   "11111111-1111-1111-1111-111111111111",
      projectCode: "arch-graha",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("projectCode");
    }
  });

  it("rejects a projectCode with spaces", () => {
    const result = UpdateProjectInput.safeParse({
      projectId:   "11111111-1111-1111-1111-111111111111",
      projectCode: "ARCH GRAHA",
    });
    expect(result.success).toBe(false);
  });

  it("allows omitting projectCode (patch semantics)", () => {
    const result = UpdateProjectInput.safeParse({
      projectId:   "11111111-1111-1111-1111-111111111111",
      projectName: "Only the name",
    });
    expect(result.success).toBe(true);
  });
});

// ─── updateProject mutation ───────────────────────────────────────────────────

function makeMockSupabase(updateError?: { code: string; message: string } | null) {
  const eq = vi.fn().mockResolvedValue({ error: updateError ?? null });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn((table: string) => {
    if (table === "projects") return { update };
    return {};
  });
  return {
    supabase: { from } as unknown as Parameters<typeof updateProject>[0],
    update,
  };
}

const projectId = "11111111-1111-1111-1111-111111111111";

describe("updateProject", () => {
  it("writes project_code when provided", async () => {
    const { supabase, update } = makeMockSupabase();
    const result = await updateProject(supabase, {
      projectId,
      projectCode: "ARCH-GRAHA-FAMILI-XA-15",
    });
    expect(result.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ project_code: "ARCH-GRAHA-FAMILI-XA-15" }),
    );
  });

  it("maps a 23505 collision on project_code to a friendly error", async () => {
    const { supabase } = makeMockSupabase({ code: "23505", message: "duplicate key value" });
    const result = await updateProject(supabase, {
      projectId,
      projectCode: "TAKEN-CODE",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("TAKEN-CODE");
      expect(result.error).toContain("sudah dipakai");
    }
  });

  it("does not include project_code in the patch when omitted", async () => {
    const { supabase, update } = makeMockSupabase();
    await updateProject(supabase, { projectId, projectName: "New name" });
    const patch = update.mock.calls[0][0];
    expect(patch).not.toHaveProperty("project_code");
    expect(patch).toHaveProperty("project_name", "New name");
  });

  it("returns ok:true immediately on an empty patch (no DB call)", async () => {
    const { supabase, update } = makeMockSupabase();
    const result = await updateProject(supabase, { projectId });
    expect(result.ok).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});
