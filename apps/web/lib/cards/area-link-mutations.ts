"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AreaLinkResult = { ok: true } | { ok: false; error: string };

const LinkInput = z.object({
  cardId:      z.string().uuid(),
  areaId:      z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export async function linkCardToArea(formData: FormData): Promise<AreaLinkResult> {
  let input;
  try {
    input = LinkInput.parse({
      cardId:      formData.get("cardId"),
      areaId:      formData.get("areaId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  // Same-project guard: card_areas has no FK constraint that the area belongs
  // to the same project as the card, so without this a cross-project areaId
  // would silently link and corrupt the gate×area matrix.
  const [cardRow, areaRow] = await Promise.all([
    supabase.from("cards").select("project_id").eq("id", input.cardId).maybeSingle(),
    supabase.from("areas").select("project_id").eq("id", input.areaId).maybeSingle(),
  ]);
  if (!cardRow.data || !areaRow.data) {
    return { ok: false, error: "Kartu atau area tidak ditemukan" };
  }
  if (cardRow.data.project_id !== areaRow.data.project_id) {
    return { ok: false, error: "Area dan kartu harus berasal dari proyek yang sama" };
  }

  const { error } = await supabase.from("card_areas").insert({
    card_id: input.cardId,
    area_id: input.areaId,
  });

  // Treat a PK conflict (already linked) as success.
  // Postgres unique_violation = 23505.
  if (error && error.code !== "23505") {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true };
}

export async function unlinkCardFromArea(formData: FormData): Promise<AreaLinkResult> {
  let input;
  try {
    input = LinkInput.parse({
      cardId:      formData.get("cardId"),
      areaId:      formData.get("areaId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const { error } = await supabase.from("card_areas")
    .delete()
    .eq("card_id", input.cardId)
    .eq("area_id", input.areaId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true };
}
