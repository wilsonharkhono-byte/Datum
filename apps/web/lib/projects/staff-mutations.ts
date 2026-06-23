"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { CreateStaffInput } from "@datum/core";
import type { z as zType } from "zod";
import {
  createStaffWithPasswordCore,
  type CreateStaffResult,
} from "@/lib/projects/staff-core";

export type { CreateStaffResult };

type CreateStaffInputType = zType.infer<typeof CreateStaffInput>;

/**
 * Admin-only flow: provisions a new auth.users + staff row in one shot.
 * Optionally assigns the new staff to the current project. The temp password
 * is returned in the result so the admin can copy it and share via WhatsApp —
 * the staff member can change it after first sign-in.
 *
 * Uses service-role admin client — stays web-only (never in @datum/core or mobile).
 * Validation schema (CreateStaffInput) is shared via @datum/core.
 * Core creation logic is in staff-core.ts (server-only, not "use server").
 */
export async function createStaffWithPassword(
  formData: FormData,
): Promise<CreateStaffResult> {
  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) {
    return { ok: false, error: "Hanya principal atau admin yang bisa membuat staf baru" };
  }

  let input: CreateStaffInputType;
  try {
    input = CreateStaffInput.parse({
      email:         formData.get("email"),
      fullName:      formData.get("fullName"),
      role:          formData.get("role"),
      password:      formData.get("password"),
      projectId:     formData.get("projectId") || undefined,
      roleOnProject: formData.get("roleOnProject") || undefined,
      costVisible:   formData.get("costVisible") === "true",
    });
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Form tidak valid";
    return { ok: false, error: msg ?? "Form tidak valid" };
  }

  // Only principals can mint other principals or admins.
  if ((input.role === "principal" || input.role === "admin") && caller!.role !== "principal") {
    return { ok: false, error: "Hanya principal yang bisa membuat akun principal atau admin" };
  }

  const admin = createSupabaseAdminClient();
  const result = await createStaffWithPasswordCore(admin, input);

  if (result.ok) {
    const projectCode = formData.get("projectCode") as string | null;
    if (projectCode) {
      revalidatePath(`/project/${projectCode}/settings`);
      revalidatePath(`/project/${projectCode}/members`);
      revalidatePath(`/project/${projectCode}`);
    }
  }

  return result;
}
