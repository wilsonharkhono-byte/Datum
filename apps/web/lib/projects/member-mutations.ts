"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStaff, canManageAccess } from "@/lib/auth/require-role";
import {
  AddProjectMemberInput,
  addProjectMember as coreAdd,
  RemoveProjectMemberInput,
  removeProjectMember as coreRemove,
  UpdateProjectMemberInput,
  updateProjectMember as coreUpdate,
  type MemberMutationResult,
} from "@datum/core";

const NOT_AUTHORIZED: MemberMutationResult = {
  ok: false,
  error: "Hanya principal atau admin yang bisa mengelola anggota proyek",
};

export async function addProjectMember(formData: FormData): Promise<MemberMutationResult> {
  const parsed = AddProjectMemberInput.safeParse({
    projectId:     formData.get("projectId"),
    staffId:       formData.get("staffId"),
    roleOnProject: formData.get("roleOnProject"),
    costVisible:   formData.get("costVisible") === "true",
  });
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };

  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) return NOT_AUTHORIZED;

  const projectCode = String(formData.get("projectCode") ?? "");
  const supabase = await createSupabaseServerClient();

  // RLS on project_staff (INSERT/UPDATE) is scoped to
  // current_can_manage_projects() = role in ('principal','admin') — the same
  // gate as canManageAccess above, so this write goes through the session
  // client rather than the admin client. No auth-admin operation is involved
  // here (unlike staff creation), so the privileged admin-client path is not
  // needed; RLS is both necessary and sufficient authorization for this write.
  const res = await coreAdd(supabase, parsed.data);
  if (res.ok) {
    revalidatePath(`/project/${projectCode}/members`);
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}`);
  }
  return res;
}

export async function removeProjectMember(formData: FormData): Promise<MemberMutationResult> {
  const parsed = RemoveProjectMemberInput.safeParse({
    projectId:     formData.get("projectId"),
    staffId:       formData.get("staffId"),
    roleOnProject: formData.get("roleOnProject"),
  });
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };

  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) return NOT_AUTHORIZED;

  const projectCode = String(formData.get("projectCode") ?? "");
  const supabase = await createSupabaseServerClient();

  const res = await coreRemove(supabase, parsed.data);
  if (res.ok) {
    revalidatePath(`/project/${projectCode}/members`);
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}`);
  }
  return res;
}

export async function updateProjectMember(formData: FormData): Promise<MemberMutationResult> {
  const parsed = UpdateProjectMemberInput.safeParse({
    projectId:     formData.get("projectId"),
    staffId:       formData.get("staffId"),
    roleOnProject: formData.get("roleOnProject"),
    costVisible:   formData.get("costVisible") === "true",
  });
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };

  const caller = await getCurrentStaff();
  if (!canManageAccess(caller)) return NOT_AUTHORIZED;

  const projectCode = String(formData.get("projectCode") ?? "");
  const supabase = await createSupabaseServerClient();

  const res = await coreUpdate(supabase, parsed.data);
  if (res.ok) {
    revalidatePath(`/project/${projectCode}/members`);
    revalidatePath(`/project/${projectCode}/settings`);
    revalidatePath(`/project/${projectCode}`);
  }
  return res;
}
