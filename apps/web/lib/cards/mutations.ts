"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  EVENT_KINDS,
  EventPayloadSchemas,
  COST_VISIBLE_KINDS,
  type EventKind,
} from "@datum/types";
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

// ─── createCardEvent ──────────────────────────────────────────────────────────

const CreateCardEventInput = z.object({
  cardId:      z.string().uuid(),
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
  eventKind:   z.enum(EVENT_KINDS),
  occurredAt:  z.string().optional(),
});

export type CreateCardEventResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

function collectPayload(formData: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("payload_")) continue;
    const field = key.slice("payload_".length);
    const raw = typeof value === "string" ? value : "";
    if (raw.trim() === "") continue;
    // Heuristic: amount/percent_complete/quantity → number; attendees → string[]
    if (field === "amount" || field === "percent_complete" || field === "quantity") {
      const n = Number(raw);
      if (!Number.isNaN(n)) payload[field] = n;
    } else if (field === "attendees") {
      payload[field] = raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      payload[field] = raw;
    }
  }
  return payload;
}

export async function createCardEvent(formData: FormData): Promise<CreateCardEventResult> {
  let input;
  try {
    input = CreateCardEventInput.parse({
      cardId:      formData.get("cardId"),
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      eventKind:   formData.get("eventKind"),
      occurredAt:  formData.get("occurredAt") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const rawPayload = collectPayload(formData);
  const schema = EventPayloadSchemas[input.eventKind as EventKind];
  const parsed = schema.safeParse(rawPayload);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] && typeof issue.path[0] === "string") {
        fieldErrors[issue.path[0]] = issue.message;
      }
    }
    return { ok: false, error: "Isi data wajib", fieldErrors };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const occurred = input.occurredAt
    ? new Date(input.occurredAt).toISOString()
    : new Date().toISOString();

  const { error } = await supabase.from("card_events").insert({
    card_id:            input.cardId,
    project_id:         input.projectId,
    event_kind:         input.eventKind,
    payload:            parsed.data as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
    occurred_at:        occurred,
    logged_by_staff_id: user.id,
    source_kind:        "manual",
    cost_visible:       COST_VISIBLE_KINDS.has(input.eventKind),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}
