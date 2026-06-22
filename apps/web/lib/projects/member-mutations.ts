"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AddProjectMemberInput,
  addProjectMember as coreAdd,
  RemoveProjectMemberInput,
  removeProjectMember as coreRemove,
  type MemberMutationResult,
} from "@datum/core";

export type { MemberMutationResult };

export async function addProjectMember(formData: FormData): Promise<MemberMutationResult> {
  const parsed = AddProjectMemberInput.safeParse({
    projectId:     formData.get("projectId"),
    staffId:       formData.get("staffId"),
    roleOnProject: formData.get("roleOnProject"),
  });
  if (!parsed.success) return { ok: false, error: "Form tidak valid" };

  const projectCode = String(formData.get("projectCode") ?? "");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const res = await coreAdd(supabase, parsed.data);
  if (res.ok) {
    revalidatePath(`/project/${projectCode}/members`);
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

  const projectCode = String(formData.get("projectCode") ?? "");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const res = await coreRemove(supabase, parsed.data);
  if (res.ok) {
    revalidatePath(`/project/${projectCode}/members`);
    revalidatePath(`/project/${projectCode}`);
  }
  return res;
}
