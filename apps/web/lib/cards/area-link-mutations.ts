"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { linkCardToArea as coreLinkCardToArea, unlinkCardFromArea as coreUnlinkCardFromArea } from "@datum/core";

export type { AreaLinkResult } from "@datum/core";

const LinkInput = z.object({
  cardId:      z.string().uuid(),
  areaId:      z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export async function linkCardToArea(formData: FormData) {
  let input;
  try {
    input = LinkInput.parse({
      cardId:      formData.get("cardId"),
      areaId:      formData.get("areaId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false as const, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Sesi tidak ditemukan, silakan login ulang" };

  const result = await coreLinkCardToArea(supabase, { cardId: input.cardId, areaId: input.areaId });

  if (result.ok) {
    revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
    revalidatePath(`/project/${input.projectCode}`);
  }
  return result;
}

export async function unlinkCardFromArea(formData: FormData) {
  let input;
  try {
    input = LinkInput.parse({
      cardId:      formData.get("cardId"),
      areaId:      formData.get("areaId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false as const, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Sesi tidak ditemukan, silakan login ulang" };

  const result = await coreUnlinkCardFromArea(supabase, { cardId: input.cardId, areaId: input.areaId });

  if (result.ok) {
    revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
    revalidatePath(`/project/${input.projectCode}`);
  }
  return result;
}
