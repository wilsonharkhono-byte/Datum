"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CreateCardInput = z.object({
  projectId:   z.string().uuid(),
  topicId:     z.string().uuid(),
  projectCode: z.string().min(1),
  title:       z.string().min(1).max(120),
});

function toSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "kartu"
  );
}

export type CreateCardResult =
  | { ok: true; slug: string }
  | { ok: false; error: string };

export async function createCard(formData: FormData): Promise<CreateCardResult> {
  let input;
  try {
    input = CreateCardInput.parse({
      projectId:   formData.get("projectId"),
      topicId:     formData.get("topicId"),
      projectCode: formData.get("projectCode"),
      title:       formData.get("title"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const base = toSlug(input.title);
  let slug = base;
  for (let i = 2; i < 100; i++) {
    const { data: existing } = await supabase
      .from("cards")
      .select("id")
      .eq("project_id", input.projectId)
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) break;
    slug = `${base}-${i}`;
  }

  const { error } = await supabase.from("cards").insert({
    project_id:          input.projectId,
    topic_id:            input.topicId,
    title:               input.title,
    slug,
    created_by_staff_id: user.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true, slug };
}
