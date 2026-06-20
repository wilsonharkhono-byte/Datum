import { describe, it, expect, vi } from "vitest";
import { getCurrentStaff, canManageAccess, type CurrentStaff } from "./current-staff";
import type { DatumClient } from "../client";

function clientWith(user: { id: string } | null, staffRow: Record<string, unknown> | null) {
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: staffRow, error: null }),
          single: async () => ({ data: staffRow, error: null }),
        }),
      }),
    })),
  } as unknown as DatumClient;
}

describe("getCurrentStaff", () => {
  it("returns null when unauthenticated", async () => {
    expect(await getCurrentStaff(clientWith(null, null))).toBeNull();
  });
  it("returns null when the auth user has no staff row (orphan)", async () => {
    expect(await getCurrentStaff(clientWith({ id: "u1" }, null))).toBeNull();
  });
  it("maps a trimmed CurrentStaff", async () => {
    const staff = await getCurrentStaff(
      clientWith({ id: "u1" }, { id: "u1", full_name: "Wilson", role: "principal", email: "w@x.co" }),
    );
    expect(staff).toEqual({ id: "u1", full_name: "Wilson", role: "principal", email: "w@x.co" });
  });
});

describe("canManageAccess", () => {
  const base: CurrentStaff = { id: "u1", full_name: "X", role: "designer", email: null };
  it("is true for principal and admin only", () => {
    expect(canManageAccess(null)).toBe(false);
    expect(canManageAccess({ ...base, role: "designer" })).toBe(false);
    expect(canManageAccess({ ...base, role: "pic" })).toBe(false);
    expect(canManageAccess({ ...base, role: "site_supervisor" })).toBe(false);
    expect(canManageAccess({ ...base, role: "estimator" })).toBe(false);
    expect(canManageAccess({ ...base, role: "principal" })).toBe(true);
    expect(canManageAccess({ ...base, role: "admin" })).toBe(true);
  });
});
