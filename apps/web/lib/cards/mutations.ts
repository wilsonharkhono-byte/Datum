"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CreateCardInput as CoreCreateCardInput,
  createCard as coreCreateCard,
  CreateTopicInput as CoreCreateTopicInput,
  createTopic as coreCreateTopic,
  MoveCardInput as CoreMoveCardInput,
  moveCard as coreMoveCard,
  createCardEvent as coreCreateCardEvent,
  collectPayload,
  resolveCardEvent as coreResolveCardEvent,
  attachToEvent as coreAttachToEvent,
  signAttachment as coreSignAttachment,
  reanalyzeAttachment as coreReanalyzeAttachment,
} from "@datum/core";
import {
  EVENT_KINDS,
  EventPayloadSchemas,
  COST_VISIBLE_KINDS,
  HIGH_RISK_KINDS,
  type EventKind,
} from "@datum/types";
import type { Database } from "@datum/db";
import {
  notifyMentions,
  notifyWatchersOfEvent,
  notifyCardStatusChange,
  notifyDraftApproved,
  notifyDraftRejected,
  notifyDraftPending,
  notifyPrincipalsOfHighRiskEvent,
} from "@/lib/notifications/producers";
import { recomputeProjectGates } from "@/lib/gates/recompute";

// Union of RELEVANT_KINDS in lib/gates/readiness-rules.ts — the kinds that can
// move an (area, gate) cell. note and photo never affect readiness, so their
// inserts skip the recompute trigger.
const GATE_RELEVANT_KINDS: ReadonlySet<EventKind> = new Set([
  "work", "material", "decision", "vendor", "drawing", "client_request", "document",
]);

// Re-export core type so web callers that import CreateCardResult from here still work.
export type CreateCardResult =
  | { ok: true; slug: string; id: string }
  | { ok: false; error: string };

// Web-only schema includes projectCode (needed for revalidatePath only).
const WebCreateCardInput = z.object({
  projectId:   z.string().uuid(),
  topicId:     z.string().uuid(),
  projectCode: z.string().min(1),
  title:       z.string().min(1).max(120),
});

export async function createCard(formData: FormData): Promise<CreateCardResult> {
  let input;
  try {
    input = WebCreateCardInput.parse({
      projectId:   formData.get("projectId"),
      topicId:     formData.get("topicId"),
      projectCode: formData.get("projectCode"),
      title:       formData.get("title"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const result = await coreCreateCard(supabase, {
    projectId: input.projectId,
    topicId:   input.topicId,
    title:     input.title,
  });
  if (!result.ok) return result;

  revalidatePath(`/project/${input.projectCode}`);
  return result;
}

// ─── createTopic ──────────────────────────────────────────────────────────────

export type CreateTopicResult =
  | { ok: true; topicId: string }
  | { ok: false; error: string };

// Web-only schema includes projectCode (needed for revalidatePath only).
const WebCreateTopicInput = z.object({
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  name:        z.string().min(1).max(120),
});

export async function createTopic(formData: FormData): Promise<CreateTopicResult> {
  let input;
  try {
    input = WebCreateTopicInput.parse({
      projectId:   formData.get("projectId"),
      projectCode: formData.get("projectCode"),
      name:        formData.get("name"),
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const result = await coreCreateTopic(supabase, {
    projectId: input.projectId,
    name:      input.name,
  });
  if (!result.ok) return result;

  revalidatePath(`/project/${input.projectCode}`);
  return result;
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

// collectPayload is now exported from @datum/core; re-exported above.
// The local function has been removed — callers in this file use the imported one.

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

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  // Delegate the DB insert + payload validation to core.
  const rawPayload = collectPayload(formData);
  const result = await coreCreateCardEvent(supabase, {
    cardId:          input.cardId,
    projectId:       input.projectId,
    eventKind:       input.eventKind,
    payload:         rawPayload,
    occurredAt:      input.occurredAt,
    loggedByStaffId: user.id,
  });
  if (!result.ok) return result;

  // ── Web-only side effects ─────────────────────────────────────────────────
  // Gate matrix cells depend on this event — recompute best-effort,
  // fire-and-forget so the save never waits on it.
  if (GATE_RELEVANT_KINDS.has(input.eventKind)) {
    void recomputeProjectGates(input.projectId, input.projectCode).catch(console.warn);
  }

  // Re-parse the payload so notification helpers have a typed value.
  const schema = EventPayloadSchemas[input.eventKind as EventKind];
  const parsedPayload = schema.parse(rawPayload) as Record<string, unknown>;

  const { data: cardRow } = await supabase
    .from("cards").select("title, slug").eq("id", input.cardId).maybeSingle();
  if (cardRow) {
    await notifyWatchersOfEvent(supabase, {
      eventId: result.eventId,
      eventKind: input.eventKind,
      payload: parsedPayload,
      actorId: user.id,
      projectId: input.projectId,
      projectCode: input.projectCode,
      cardId: input.cardId,
      cardSlug: cardRow.slug,
      cardTitle: cardRow.title,
    });
    if (HIGH_RISK_KINDS.has(input.eventKind)) {
      const preview = pickPreview(parsedPayload);
      // notifyPrincipalsOfHighRiskEvent uses the service-role admin client —
      // kept here (web-only, NOT in @datum/core).
      await notifyPrincipalsOfHighRiskEvent(supabase, {
        eventId: result.eventId,
        eventKind: input.eventKind,
        actorId: user.id,
        projectId: input.projectId,
        projectCode: input.projectCode,
        cardId: input.cardId,
        cardSlug: cardRow.slug,
        cardTitle: cardRow.title,
        preview,
      });
    }
  }

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true, eventId: result.eventId };
}

function pickPreview(payload: Record<string, unknown>): string | null {
  // The first non-empty textual field — good enough for a notification preview.
  // Order covers every high-risk kind: client_request (request_text), decision
  // (proposed_spec / topic), vendor (vendor_name + amount or notes), work
  // (description), and the generic note/document/photo bodies.
  const order = [
    "request_text",            // client_request
    "proposed_spec", "topic",  // decision
    "vendor_name",             // vendor — combined with amount below if both present
    "description",             // work / drawing
    "body", "notes", "title", "caption",
  ];
  for (const k of order) {
    const v = payload[k];
    if (typeof v === "string" && v.trim().length > 0) {
      // For vendor events surface "Vendor X · Rp 500.000" when amount is present
      if (k === "vendor_name" && typeof payload.amount === "number") {
        return `${v} · Rp ${payload.amount.toLocaleString("id-ID")}`;
      }
      return v;
    }
  }
  return null;
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

  const { data: inserted, error } = await supabase.from("card_comments").insert({
    card_id:             input.cardId,
    project_id:          input.projectId,
    body:                input.body,
    mentions:            mentionedStaffIds,
    created_by_staff_id: user.id,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };

  if (inserted?.id) {
    await notifyMentions(supabase, {
      mentionedStaffIds,
      actorId: user.id,
      projectId: input.projectId,
      cardId: input.cardId,
      cardSlug: input.cardSlug,
      cardComment: { id: inserted.id, body: input.body },
      projectCode: input.projectCode,
    });
  }

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

  const { data: updatedComment, error } = await supabase.from("card_comments")
    .update({ body: input.body, edited_at: new Date().toISOString(), mentions: mentionedStaffIds })
    .eq("id", input.commentId)
    .select("id, card_id, project_id")
    .single();
  if (error) return { ok: false, error: error.message };

  if (updatedComment?.id && updatedComment.card_id && updatedComment.project_id) {
    await notifyMentions(supabase, {
      mentionedStaffIds,
      actorId: user.id,
      projectId: updatedComment.project_id,
      cardId: updatedComment.card_id,
      cardSlug: input.cardSlug,
      cardComment: { id: updatedComment.id, body: input.body },
      projectCode: input.projectCode,
    });
  }

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

  const result = await coreAttachToEvent(supabase, {
    cardEventId: input.cardEventId,
    storagePath: input.storagePath,
    mimeType:    input.mimeType,
  });
  if (!result.ok) return result;

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
  return coreSignAttachment(supabase, input.storagePath);
}

// ─── reanalyzeAttachment ──────────────────────────────────────────────────────
// Reset a failed/skipped attachment back to the work queue. The cron runner
// picks it up on the next tick; ai_attempts resets so the 3-try guard restarts.

const ReanalyzeInput = z.object({
  attachmentId: z.string().uuid(),
  projectCode:  z.string().min(1),
  cardSlug:     z.string().min(1),
});

export type ReanalyzeResult = { ok: true } | { ok: false; error: string };

export async function reanalyzeAttachment(formData: FormData): Promise<ReanalyzeResult> {
  let input;
  try {
    input = ReanalyzeInput.parse({
      attachmentId: formData.get("attachmentId"),
      projectCode:  formData.get("projectCode"),
      cardSlug:     formData.get("cardSlug"),
    });
  } catch {
    return { ok: false, error: "Permintaan tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // RLS gates this update to attachments whose parent event is in an accessible
  // project, so a user can only re-queue attachments they may write.
  const result = await coreReanalyzeAttachment(supabase, input.attachmentId);
  if (!result.ok) return result;

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
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

  if (input.status !== undefined) {
    const { data: cardRow } = await supabase
      .from("cards").select("title").eq("id", input.cardId).maybeSingle();
    if (cardRow) {
      await notifyCardStatusChange(supabase, {
        cardId: input.cardId,
        cardTitle: cardRow.title,
        cardSlug: input.cardSlug,
        projectId: input.projectId,
        projectCode: input.projectCode,
        newStatus: input.status,
        actorId: user.id,
      });
    }
  }

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath(`/project/${input.projectCode}`);
  return { ok: true };
}

// ─── moveCard — Slice 1.2b ────────────────────────────────────────────────────

export type MoveCardResult = { ok: true } | { ok: false; error: string };

// Web-only schema includes projectCode + cardSlug for revalidatePath.
const WebMoveCardInput = z.object({
  cardId:      z.string().uuid(),
  newTopicId:  z.string().uuid(),
  projectId:   z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
});

export async function moveCard(formData: FormData): Promise<MoveCardResult> {
  let input;
  try {
    input = WebMoveCardInput.parse({
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
  const result = await coreMoveCard(supabase, {
    cardId:     input.cardId,
    newTopicId: input.newTopicId,
    projectId:  input.projectId,
  });
  if (!result.ok) return result;

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath(`/project/${input.projectCode}`);
  return result;
}

// ─── Slice 1.2d — draft/approval flow for high-risk chat captures ─────────────

const CreateCardEventDraftInput = z.object({
  cardId:       z.string().uuid(),
  projectId:    z.string().uuid(),
  projectCode:  z.string().min(1),
  cardSlug:     z.string().min(1),
  eventKind:    z.enum(EVENT_KINDS),
  occurredAt:   z.string().optional(),
  rationale:    z.string().optional(),
  originalText: z.string().max(4000).optional(),
});

export type CreateDraftResult =
  | { ok: true; draftId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function createCardEventDraft(formData: FormData): Promise<CreateDraftResult> {
  let input;
  try {
    input = CreateCardEventDraftInput.parse({
      cardId:       formData.get("cardId"),
      projectId:    formData.get("projectId"),
      projectCode:  formData.get("projectCode"),
      cardSlug:     formData.get("cardSlug"),
      eventKind:    formData.get("eventKind"),
      occurredAt:   formData.get("occurredAt") || undefined,
      rationale:    formData.get("rationale") || undefined,
      originalText: formData.get("originalText") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const rawPayload = collectPayload(formData);
  const schema = EventPayloadSchemas[input.eventKind];
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
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const proposed = {
    kind:        input.eventKind,
    payload:     parsed.data,
    card_id:     input.cardId,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    rationale:   input.rationale ?? null,
  };

  const { data, error } = await supabase.from("data_drafts").insert({
    project_id:          input.projectId,
    draft_type:          "card_event",
    proposed_payload:    proposed as unknown as Database["public"]["Tables"]["data_drafts"]["Insert"]["proposed_payload"],
    risk_level:          HIGH_RISK_KINDS.has(input.eventKind) ? "high" : "medium",
    source_type:         "assistant_chat",
    original_input_text: input.originalText ?? null,
    created_by_staff_id: user.id,
  }).select("id").single();
  if (error) return { ok: false, error: error.message };

  const { data: cardRow } = await supabase
    .from("cards").select("title").eq("id", input.cardId).maybeSingle();
  if (cardRow) {
    await notifyDraftPending(supabase, {
      draftId: data.id,
      actorId: user.id,
      projectId: input.projectId,
      eventKind: input.eventKind,
      cardTitle: cardRow.title,
      cardId: input.cardId,
    });
  }

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath("/review");
  return { ok: true, draftId: data.id };
}

const ApproveDraftInput = z.object({
  draftId: z.string().uuid(),
});

export type ApproveDraftResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string };

export async function approveCardEventDraft(formData: FormData): Promise<ApproveDraftResult> {
  let input;
  try {
    input = ApproveDraftInput.parse({ draftId: formData.get("draftId") });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // Load the draft
  const { data: draft, error: dErr } = await supabase
    .from("data_drafts").select("*").eq("id", input.draftId).maybeSingle();
  if (dErr || !draft) return { ok: false, error: "Draft tidak ditemukan" };
  if (draft.status !== "draft") return { ok: false, error: `Draft sudah ${draft.status}` };
  if (draft.draft_type !== "card_event") return { ok: false, error: "Draft bukan card_event" };

  const proposed = draft.proposed_payload as {
    kind: string;
    payload: Record<string, unknown>;
    card_id: string;
    occurred_at: string;
  };

  // Re-validate the payload defensively
  const schema = EventPayloadSchemas[proposed.kind as keyof typeof EventPayloadSchemas];
  if (!schema) return { ok: false, error: `Kind tidak valid: ${proposed.kind}` };
  const recheck = schema.safeParse(proposed.payload);
  if (!recheck.success) return { ok: false, error: "Payload tidak lolos validasi ulang" };

  // Insert the card_event
  const { data: ev, error: evErr } = await supabase.from("card_events").insert({
    card_id:            proposed.card_id,
    project_id:         draft.project_id,
    event_kind:         proposed.kind as Database["public"]["Enums"]["card_event_kind"],
    payload:            proposed.payload as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
    occurred_at:        proposed.occurred_at,
    logged_by_staff_id: draft.created_by_staff_id,
    source_kind:        "chat",
    cost_visible:       COST_VISIBLE_KINDS.has(proposed.kind as EventKind),
    draft_id:           draft.id,
  }).select("id").single();
  if (evErr) return { ok: false, error: evErr.message };

  // Mark the draft approved + record promotion
  await supabase.from("data_drafts").update({
    status:               "approved",
    approved_by_staff_id: user.id,
    approved_at:          new Date().toISOString(),
    promoted_record_type: "card_events",
    promoted_record_id:   ev.id,
  }).eq("id", draft.id);

  const { data: cardRow } = await supabase
    .from("cards").select("slug").eq("id", proposed.card_id).maybeSingle();
  const { data: projRow } = await supabase
    .from("projects").select("project_code").eq("id", draft.project_id).maybeSingle();
  if (projRow && GATE_RELEVANT_KINDS.has(proposed.kind as EventKind)) {
    void recomputeProjectGates(draft.project_id, projRow.project_code).catch(console.warn);
  }
  if (cardRow && projRow && draft.created_by_staff_id) {
    await notifyDraftApproved(supabase, {
      draftId: draft.id,
      draftAuthorId: draft.created_by_staff_id,
      approverActorId: user.id,
      projectId: draft.project_id,
      projectCode: projRow.project_code,
      cardId: proposed.card_id,
      cardSlug: cardRow.slug,
      eventKind: proposed.kind,
    });
  }

  revalidatePath("/review");
  return { ok: true, eventId: ev.id };
}

const RejectDraftInput = z.object({
  draftId: z.string().uuid(),
  reason:  z.string().max(500).optional(),
});

export async function rejectCardEventDraft(formData: FormData): Promise<MemberResult> {
  let input;
  try {
    input = RejectDraftInput.parse({
      draftId: formData.get("draftId"),
      reason:  formData.get("reason") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  const { error } = await supabase.from("data_drafts").update({
    status:               "rejected",
    rejected_by_staff_id: user.id,
    rejected_at:          new Date().toISOString(),
    rejection_reason:     input.reason ?? null,
  }).eq("id", input.draftId).eq("status", "draft");
  if (error) return { ok: false, error: error.message };

  const { data: draft } = await supabase
    .from("data_drafts").select("project_id, created_by_staff_id, proposed_payload").eq("id", input.draftId).maybeSingle();
  if (draft && draft.created_by_staff_id) {
    const kind = (draft.proposed_payload as { kind?: string })?.kind ?? "card_event";
    await notifyDraftRejected(supabase, {
      draftId: input.draftId,
      draftAuthorId: draft.created_by_staff_id,
      rejectorActorId: user.id,
      projectId: draft.project_id ?? "",
      reason: input.reason ?? null,
      eventKind: kind,
    });
  }

  revalidatePath("/review");
  return { ok: true };
}

// ─── resolveCardEvent ─────────────────────────────────────────────────────────
// Mark an open-loop event resolved (decision → decided/superseded,
// client_request → answered). Goes through the resolve_card_event RPC so the
// payload update and the record_revisions audit row commit atomically.

const ResolveEventInput = z.object({
  eventId:     z.string().uuid(),
  projectCode: z.string().min(1),
  cardSlug:    z.string().min(1),
  newStatus:   z.enum(["needs_decision", "decided", "superseded", "open", "answered"]),
  reason:      z.string().max(500).optional(),
});

export type ResolveEventResult = { ok: true } | { ok: false; error: string };

export async function resolveCardEvent(formData: FormData): Promise<ResolveEventResult> {
  let input;
  try {
    input = ResolveEventInput.parse({
      eventId:     formData.get("eventId"),
      projectCode: formData.get("projectCode"),
      cardSlug:    formData.get("cardSlug"),
      newStatus:   formData.get("newStatus"),
      reason:      formData.get("reason") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan, silakan login ulang" };

  const result = await coreResolveCardEvent(supabase, {
    eventId:   input.eventId,
    newStatus: input.newStatus,
    reason:    input.reason,
  });
  if (!result.ok) return result;

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}
