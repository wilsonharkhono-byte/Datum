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
  | { ok: true; eventId: string }
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

  const { data, error } = await supabase.from("card_events").insert({
    card_id:            input.cardId,
    project_id:         input.projectId,
    event_kind:         input.eventKind,
    payload:            parsed.data as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
    occurred_at:        occurred,
    logged_by_staff_id: user.id,
    source_kind:        "manual",
    cost_visible:       COST_VISIBLE_KINDS.has(input.eventKind),
  }).select("id").single();
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true, eventId: data.id };
}

// ─── createComment ────────────────────────────────────────────────────────────

const CreateCommentInput = z.object({
  cardId:      z.string().uuid(),
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
  body:        z.string().min(1).max(4000),
});

export type CreateCommentResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createComment(formData: FormData): Promise<CreateCommentResult> {
  let input;
  try {
    input = CreateCommentInput.parse({
      cardId:      formData.get("cardId"),
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      body:        formData.get("body"),
    });
  } catch {
    return { ok: false, error: "Komentar tidak boleh kosong" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  // Parse @mentions — extract @<first-name-token>, resolve to active staff by case-insensitive first-name match
  const mentionTokens = Array.from(new Set(
    (input.body.match(/@([a-zA-Z][a-zA-Z0-9_-]{1,30})/g) ?? [])
      .map((m) => m.slice(1).toLowerCase())
  ));

  let mentionedStaffIds: string[] = [];
  if (mentionTokens.length > 0) {
    const { data: candidates } = await supabase
      .from("staff").select("id, full_name").eq("active", true);
    const ids = new Set<string>();
    for (const cand of candidates ?? []) {
      const first = (cand.full_name ?? "").split(/\s+/)[0]?.toLowerCase();
      if (first && mentionTokens.includes(first)) ids.add(cand.id);
    }
    mentionedStaffIds = Array.from(ids);
  }

  const { error } = await supabase.from("card_comments").insert({
    card_id:             input.cardId,
    project_id:          input.projectId,
    body:                input.body,
    mentions:            mentionedStaffIds,
    created_by_staff_id: user.id,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

// ─── editComment ──────────────────────────────────────────────────────────────

const EditCommentInput = z.object({
  commentId:   z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
  body:        z.string().min(1).max(4000),
});

export async function editComment(formData: FormData): Promise<CreateCommentResult> {
  let input;
  try {
    input = EditCommentInput.parse({
      commentId:   formData.get("commentId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      body:        formData.get("body"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // Re-extract mentions from the edited body
  const mentionTokens = Array.from(new Set(
    (input.body.match(/@([a-zA-Z][a-zA-Z0-9_-]{1,30})/g) ?? [])
      .map((m) => m.slice(1).toLowerCase())
  ));
  let mentionedStaffIds: string[] = [];
  if (mentionTokens.length > 0) {
    const { data: candidates } = await supabase
      .from("staff").select("id, full_name").eq("active", true);
    const ids = new Set<string>();
    for (const cand of candidates ?? []) {
      const first = (cand.full_name ?? "").split(/\s+/)[0]?.toLowerCase();
      if (first && mentionTokens.includes(first)) ids.add(cand.id);
    }
    mentionedStaffIds = Array.from(ids);
  }

  const { error } = await supabase.from("card_comments")
    .update({ body: input.body, edited_at: new Date().toISOString(), mentions: mentionedStaffIds })
    .eq("id", input.commentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

// ─── deleteComment ────────────────────────────────────────────────────────────

const DeleteCommentInput = z.object({
  commentId:   z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export async function deleteComment(formData: FormData): Promise<CreateCommentResult> {
  let input;
  try {
    input = DeleteCommentInput.parse({
      commentId:   formData.get("commentId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const { error } = await supabase.from("card_comments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.commentId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

// ─── attachToEvent ────────────────────────────────────────────────────────────

const AttachToEventInput = z.object({
  cardEventId: z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
  storagePath: z.string().min(1),
  mimeType:    z.string().min(1),
});

export type AttachToEventResult =
  | { ok: true }
  | { ok: false; error: string };

export async function attachToEvent(formData: FormData): Promise<AttachToEventResult> {
  let input;
  try {
    input = AttachToEventInput.parse({
      cardEventId: formData.get("cardEventId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      storagePath: formData.get("storagePath"),
      mimeType:    formData.get("mimeType"),
    });
  } catch {
    return { ok: false, error: "Lampiran tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const { error } = await supabase.from("card_attachments").insert({
    card_event_id: input.cardEventId,
    storage_path:  input.storagePath,
    mime_type:     input.mimeType,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

// ─── signAttachment ───────────────────────────────────────────────────────────

const SignAttachmentInput = z.object({
  storagePath: z.string().min(1),
});

export type SignAttachmentResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

export async function signAttachment(formData: FormData): Promise<SignAttachmentResult> {
  let input;
  try {
    input = SignAttachmentInput.parse({
      storagePath: formData.get("storagePath"),
    });
  } catch {
    return { ok: false, error: "Lampiran tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from("card-attachments")
    .createSignedUrl(input.storagePath, 60 * 10); // 10 minutes
  if (error || !data) return { ok: false, error: error?.message ?? "Gagal membuat URL" };

  return { ok: true, url: data.signedUrl };
}

// ─── Slice 1.2a — card members ────────────────────────────────────────────────

const AddMemberInput = z.object({
  cardId:      z.string().uuid(),
  staffId:     z.string().uuid(),
  role:        z.enum(["owner","watcher","assignee"]).default("watcher"),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export type MemberResult = { ok: true } | { ok: false; error: string };

export async function addCardMember(formData: FormData): Promise<MemberResult> {
  let input;
  try {
    input = AddMemberInput.parse({
      cardId:      formData.get("cardId"),
      staffId:     formData.get("staffId"),
      role:        formData.get("role") || "watcher",
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // Upsert pattern: if a soft-removed row exists, un-remove it; otherwise insert.
  const { data: existing } = await supabase.from("card_members")
    .select("removed_at")
    .eq("card_id", input.cardId).eq("staff_id", input.staffId).eq("role", input.role)
    .maybeSingle();

  let dbErr;
  if (existing) {
    const { error } = await supabase.from("card_members")
      .update({ removed_at: null, added_at: new Date().toISOString(), added_by_staff_id: user.id })
      .eq("card_id", input.cardId).eq("staff_id", input.staffId).eq("role", input.role);
    dbErr = error;
  } else {
    const { error } = await supabase.from("card_members").insert({
      card_id:           input.cardId,
      staff_id:          input.staffId,
      role:              input.role,
      added_by_staff_id: user.id,
    });
    dbErr = error;
  }
  if (dbErr) return { ok: false, error: dbErr.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

const RemoveMemberInput = z.object({
  cardId:      z.string().uuid(),
  staffId:     z.string().uuid(),
  role:        z.enum(["owner","watcher","assignee"]),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export async function removeCardMember(formData: FormData): Promise<MemberResult> {
  let input;
  try {
    input = RemoveMemberInput.parse({
      cardId:      formData.get("cardId"),
      staffId:     formData.get("staffId"),
      role:        formData.get("role"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("card_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("card_id", input.cardId).eq("staff_id", input.staffId).eq("role", input.role)
    .is("removed_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}

// ─── updateCard ───────────────────────────────────────────────────────────────

const UpdateCardInput = z.object({
  cardId:         z.string().uuid(),
  projectId:      z.string().uuid(),
  projectCode:    z.string().min(1),
  cardSlug:       z.string().min(1),
  title:          z.string().min(1).max(120).optional(),
  currentSummary: z.string().max(2000).nullable().optional(),
  status:         z.enum(["active", "dormant", "closed"]).optional(),
});

export type UpdateCardResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateCard(formData: FormData): Promise<UpdateCardResult> {
  let input;
  try {
    const rawSummary = formData.get("currentSummary");
    input = UpdateCardInput.parse({
      cardId:      formData.get("cardId"),
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      title:       formData.get("title") || undefined,
      // empty string → null (clear summary); not present → leave alone
      currentSummary: rawSummary === null ? undefined : (rawSummary === "" ? null : rawSummary),
      status:      formData.get("status") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const patch: Database["public"]["Tables"]["cards"]["Update"] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.currentSummary !== undefined) patch.current_summary = input.currentSummary;
  if (input.status !== undefined) patch.status = input.status;

  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from("cards").update(patch).eq("id", input.cardId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true };
}

// ─── moveCard — Slice 1.2b ────────────────────────────────────────────────────

const MoveCardInput = z.object({
  cardId:       z.string().uuid(),
  newTopicId:   z.string().uuid(),
  projectId:    z.string().uuid(),
  projectCode:  z.string().min(1),
  cardSlug:     z.string().min(1),
});

export type MoveCardResult = { ok: true } | { ok: false; error: string };

export async function moveCard(formData: FormData): Promise<MoveCardResult> {
  let input;
  try {
    input = MoveCardInput.parse({
      cardId:      formData.get("cardId"),
      newTopicId:  formData.get("newTopicId"),
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // Sanity: the target topic must belong to the same project
  const { data: topic } = await supabase
    .from("topics").select("id, project_id")
    .eq("id", input.newTopicId).maybeSingle();
  if (!topic) return { ok: false, error: "Kolom tujuan tidak ditemukan" };
  if (topic.project_id !== input.projectId) {
    return { ok: false, error: "Kolom tujuan ada di proyek lain" };
  }

  const { error } = await supabase.from("cards")
    .update({ topic_id: input.newTopicId })
    .eq("id", input.cardId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true };
}
