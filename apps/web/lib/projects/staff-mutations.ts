"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import { CreateStaffInput } from "@datum/core";

export type CreateStaffResult =
  | { ok: true; staffId: string; email: string }
  | { ok: false; error: string };

/**
 * Admin-only flow: provisions a new auth.users + staff row in one shot.
 * Optionally assigns the new staff to the current project. The temp password
 * is returned in the result so the admin can copy it and share via WhatsApp —
 * the staff member can change it after first sign-in.
 *
 * Uses service-role admin client — stays web-only (never in @datum/core or mobile).
 * Validation schema (CreateStaffInput) is shared via @datum/core.
 */
export async function createStaffWithPassword(
  formData: FormData,
): Promise<CreateStaffResult> {
  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) {
    return { ok: false, error: "Hanya principal atau admin yang bisa membuat staf baru" };
  }

  let input;
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

  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
  });
  if (authErr || !authData.user) {
    if (authErr?.message?.includes("already")) {
      return { ok: false, error: "Email ini sudah terdaftar di Supabase Auth" };
    }
    return { ok: false, error: authErr?.message ?? "Gagal membuat akun auth" };
  }

  const newUserId = authData.user.id;

  const { error: staffErr } = await admin.from("staff").insert({
    id:           newUserId,
    full_name:    input.fullName,
    role:         input.role,
    email:        input.email,
    cost_visible: input.costVisible ?? false,
    active:       true,
  });
  if (staffErr) {
    // Roll back the auth user so we don't leave an orphan
    await admin.auth.admin.deleteUser(newUserId);
    return { ok: false, error: `Gagal membuat staf: ${staffErr.message}` };
  }

  if (input.projectId && input.roleOnProject) {
    const today = new Date().toISOString().slice(0, 10);
    const { error: psErr } = await admin.from("project_staff").insert({
      project_id:      input.projectId,
      staff_id:        newUserId,
      role_on_project: input.roleOnProject,
      cost_visible:    input.costVisible ?? false,
      active_from:     today,
    });
    if (psErr) {
      return {
        ok: false,
        error: `Staf dibuat tapi gagal ditambahkan ke proyek: ${psErr.message}`,
      };
    }
  }

  const projectCode = formData.get("projectCode") as string | null;
  if (projectCode) {
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}/members`);
    revalidatePath(`/project/${projectCode}`);
  }

  return {
    ok: true,
    staffId: newUserId,
    email: input.email,
  };
}
