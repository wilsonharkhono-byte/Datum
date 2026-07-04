"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recomputeProjectGatesSystem } from "@/lib/gates/recompute-system";
import { linkCardToArea as coreLinkCardToArea, unlinkCardFromArea as coreUnlinkCardFromArea } from "@datum/core";

export type { AreaLinkResult } from "@datum/core";

/** card↔area link changes mark the area's gate cells stale via DB trigger
    (20260601000013), but until now nothing recomputed them — the matrix
    silently drifted until someone pressed the manual button. Same after()
    pattern as createCardEvent. The card row supplies project_id (the link
    form only carries projectCode). */
function recomputeAfterLinkChange(cardId: string, projectCode: string) {
  after(async () => {
    try {
      const admin = createSupabaseAdminClient();
      const { data: card } = await admin
        .from("cards")
        .select("project_id")
        .eq("id", cardId)
        .maybeSingle();
      if (card?.project_id) {
        await recomputeProjectGatesSystem(card.project_id, projectCode);
      }
    } catch (e) {
      Sentry.captureException(e, { extra: { where: "areaLink.after.recompute", cardId } });
    }
  });
}

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
    recomputeAfterLinkChange(input.cardId, input.projectCode);
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
    recomputeAfterLinkChange(input.cardId, input.projectCode);
    revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
    revalidatePath(`/project/${input.projectCode}`);
  }
  return result;
}
