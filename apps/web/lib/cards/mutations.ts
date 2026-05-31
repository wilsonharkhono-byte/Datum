"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EventPayloadSchemas } from "@datum/types";
import type { Database } from "@datum/db";

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

// ─── createCardNote ───────────────────────────────────────────────────────────

const CreateCardNoteInput = z.object({
  cardId:      z.string().uuid(),
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
  body:        z.string().min(1).max(4000),
  occurredAt:  z.string().optional(), // ISO date or datetime; defaults to now
});

export type CreateCardNoteResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createCardNote(formData: FormData): Promise<CreateCardNoteResult> {
  let input;
  try {
    input = CreateCardNoteInput.parse({
      cardId:      formData.get("cardId"),
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      body:        formData.get("body"),
      occurredAt:  formData.get("occurredAt") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  // Validate the note payload shape using the canonical Zod schema
  const payloadCheck = EventPayloadSchemas.note.safeParse({ body: input.body });
  if (!payloadCheck.success) {
    return { ok: false, error: "Catatan tidak boleh kosong" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const occurred = input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString();

  const { error } = await supabase.from("card_events").insert({
    card_id:            input.cardId,
    project_id:         input.projectId,
    event_kind:         "note",
    payload:            payloadCheck.data as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
    occurred_at:        occurred,
    logged_by_staff_id: user.id,
    source_kind:        "manual",
    cost_visible:       false,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}
