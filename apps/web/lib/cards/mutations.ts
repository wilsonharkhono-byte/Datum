"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  CreateCardInput as CoreCreateCardInput,
  createCard as coreCreateCard,
  CreateTopicInput as CoreCreateTopicInput,
  createTopic as coreCreateTopic,
  MoveCardInput as CoreMoveCardInput,
  moveCard as coreMoveCard,
  createCardEvent as coreCreateCardEvent,
  collectPayloadFromEntries,
  resolveCardEvent as coreResolveCardEvent,
  attachToEvent as coreAttachToEvent,
  signAttachment as coreSignAttachment,
  reanalyzeAttachment as coreReanalyzeAttachment,
  createComment as coreCreateComment,
  editComment as coreEditComment,
  deleteComment as coreDeleteComment,
  addCardMember as coreAddCardMember,
  removeCardMember as coreRemoveCardMember,
  approveCardEventDraft as coreApproveCardEventDraft,
  rejectCardEventDraft as coreRejectCardEventDraft,
  linkCardToArea as coreLinkCardToArea,
  getProjectAreas,
} from "@datum/core";
import { suggestAreaForCard } from "@/lib/areas/match-hint";
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
import { sendExpoPush } from "@/lib/notifications/push-send";
import { recomputeProjectGatesSystem } from "@/lib/gates/recompute-system";
import { processPendingStepInference } from "@/lib/steps/run-inference";
import { INFERABLE_KINDS } from "@/lib/steps/infer";
import * as Sentry from "@sentry/nextjs";

// B4 fix: the DB trigger `card_events_mark_stale` (packages/db/supabase/
// migrations/20260601000013_area_gate_stale_trigger.sql) marks EVERY area
// linked to the card stale on ANY card_events insert/update — it does not
// filter by event kind at all. The old GATE_RELEVANT_KINDS allowlist here
// (work/material/decision/vendor/drawing/client_request/document) undercounted
// that: a `note` or `photo` event marks cells stale via the trigger but never
// triggered a recompute, so "N stale" cells piled up until someone clicked
// "Hitung ulang readiness" manually (live bug B4). recomputeProjectGates
// itself is safe to run unconditionally — it re-derives every (area, gate)
// cell for the project and clears `stale` regardless of which kinds moved the
// needle — so we fire it for every event kind now, mirroring the trigger
// exactly instead of maintaining a second allowlist that can drift out of
// sync with the SQL.

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

  // Card-create room inheritance: same deterministic matcher used at capture
  // time (Task 5) — if the topic name room-matches an area, auto-link it so
  // the card starts life on the readiness matrix. Never fails the create.
  try {
    const [{ data: topicRow }, areas] = await Promise.all([
      supabase.from("topics").select("name").eq("id", input.topicId).maybeSingle(),
      getProjectAreas(supabase, input.projectId),
    ]);
    const hint = suggestAreaForCard({
      cardTitle: input.title,
      topicName: topicRow?.name ?? null,
      areas,
    });
    if (hint) {
      await coreLinkCardToArea(supabase, { cardId: result.id, areaId: hint.area.id });
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { scope: "createCard.roomInheritance" } });
  }

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

// collectPayloadFromEntries is imported from @datum/core above.
// Web callers pass formData.entries() — DOM FormData stays in web layer only.

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
  const rawPayload = collectPayloadFromEntries(formData.entries());
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
    // Best-effort Expo push for watcher event — derive recipients same way producer does.
    void (async () => {
      const { data: members } = await supabase
        .from("card_members").select("staff_id")
        .eq("card_id", input.cardId).is("removed_at", null);
      const recipientIds = [...new Set(
        (members ?? []).map((m) => m.staff_id)
          .filter((id): id is string => typeof id === "string" && id !== user.id),
      )];
      await sendExpoPush(recipientIds, {
        title: `${input.eventKind} baru di "${cardRow.title}"`,
        body:  `${input.eventKind} baru di "${cardRow.title}"`,
        data:  { link: `/project/${input.projectCode}/cards/${cardRow.slug}` },
      });
    })().catch(console.warn);
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

  // B4 fix: this card_event just made the DB trigger mark its areas' gate
  // cells stale (packages/db/supabase/migrations/
  // 20260601000013_area_gate_stale_trigger.sql — every insert, no kind
  // filter). Self-heal in the same after() used for inference, unconditionally,
  // so stale cells never require the manual "Hitung ulang readiness" button.
  // processPendingStepInference recomputes internally for any project it
  // writes AI step progress to, but we still recompute again unconditionally
  // afterward here — this covers non-inferable kinds too (e.g. a plain
  // "note", which the trigger stales but inference never touches).
  after(async () => {
    try {
      if (INFERABLE_KINDS.has(input.eventKind)) {
        await processPendingStepInference(createSupabaseAdminClient(), 5);
      }
    } catch (e) {
      Sentry.captureException(e, { extra: { where: "createCardEvent.after.inference" } });
    }
    try {
      await recomputeProjectGatesSystem(input.projectId, input.projectCode);
    } catch (e) {
      Sentry.captureException(e, { extra: { where: "createCardEvent.after.recompute" } });
    }
  });

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

  const result = await coreCreateComment(supabase, {
    cardId:           input.cardId,
    projectId:        input.projectId,
    body:             input.body,
    createdByStaffId: user.id,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await notifyMentions(supabase, {
    mentionedStaffIds: result.mentions,
    actorId:           user.id,
    projectId:         input.projectId,
    cardId:            input.cardId,
    cardSlug:          input.cardSlug,
    cardComment:       { id: result.commentId, body: input.body },
    projectCode:       input.projectCode,
  });
  // Best-effort Expo push for mention — same recipient filter as producer.
  {
    const recipientIds = result.mentions.filter((id) => id !== user.id);
    const preview = input.body.length > 100 ? input.body.slice(0, 100) + "…" : input.body;
    void sendExpoPush(recipientIds, {
      title: "Anda disebut di komentar",
      body:  preview,
      data:  { link: `/project/${input.projectCode}/cards/${input.cardSlug}` },
    }).catch(console.warn);
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

  const result = await coreEditComment(supabase, {
    commentId: input.commentId,
    body:      input.body,
  });
  if (!result.ok) return { ok: false, error: result.error };

  await notifyMentions(supabase, {
    mentionedStaffIds: result.mentions,
    actorId:           user.id,
    projectId:         result.projectId,
    cardId:            result.cardId,
    cardSlug:          input.cardSlug,
    cardComment:       { id: input.commentId, body: input.body },
    projectCode:       input.projectCode,
  });
  // Best-effort Expo push for mention in edited comment.
  {
    const recipientIds = result.mentions.filter((id) => id !== user.id);
    const preview = input.body.length > 100 ? input.body.slice(0, 100) + "…" : input.body;
    void sendExpoPush(recipientIds, {
      title: "Anda disebut di komentar",
      body:  preview,
      data:  { link: `/project/${input.projectCode}/cards/${input.cardSlug}` },
    }).catch(console.warn);
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

  const result = await coreDeleteComment(supabase, input.commentId);
  if (!result.ok) return { ok: false, error: result.error };
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

  const result = await coreAddCardMember(supabase, {
    cardId:         input.cardId,
    staffId:        input.staffId,
    role:           input.role,
    addedByStaffId: user.id,
  });
  if (!result.ok) return result;

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
  const result = await coreRemoveCardMember(supabase, {
    cardId:  input.cardId,
    staffId: input.staffId,
    role:    input.role,
  });
  if (!result.ok) return result;
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
      // Best-effort Expo push for status change — same recipient derivation as producer.
      void (async () => {
        const { data: members } = await supabase
          .from("card_members").select("staff_id")
          .eq("card_id", input.cardId).is("removed_at", null);
        const recipientIds = [...new Set(
          (members ?? []).map((m) => m.staff_id)
            .filter((id): id is string => typeof id === "string" && id !== user.id),
        )];
        await sendExpoPush(recipientIds, {
          title: "Status kartu diperbarui",
          body:  `Status "${cardRow.title}" diubah ke ${input.status}`,
          data:  { link: `/project/${input.projectCode}/cards/${input.cardSlug}` },
        });
      })().catch(console.warn);
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

  const rawPayload = collectPayloadFromEntries(formData.entries());
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
    // Best-effort Expo push for draft pending — same principal query as producer.
    void (async () => {
      const { data: principals } = await supabase
        .from("staff").select("id").eq("active", true).eq("role", "principal");
      const recipientIds = (principals ?? [])
        .map((s) => s.id).filter((id) => id !== user.id);
      await sendExpoPush(recipientIds, {
        title: "Draft menunggu approval",
        body:  `Draft ${input.eventKind} baru menunggu approval untuk "${cardRow.title}"`,
        data:  { link: "/review" },
      });
    })().catch(console.warn);
  }

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  revalidatePath("/review");
  return { ok: true, draftId: data.id };
}

// ApproveDraftInput / RejectDraftInput now live in @datum/core (imported above
// via coreApproveCardEventDraft / coreRejectCardEventDraft).
// Web schemas remain local for FormData → args adaption only.
const WebApproveDraftInput = z.object({
  draftId: z.string().uuid(),
});

export type ApproveDraftResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string };

export async function approveCardEventDraft(formData: FormData): Promise<ApproveDraftResult> {
  let input;
  try {
    input = WebApproveDraftInput.parse({ draftId: formData.get("draftId") });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // Delegate DB logic + validation to @datum/core
  const result = await coreApproveCardEventDraft(supabase, {
    draftId: input.draftId,
    approverId: user.id,
  });
  if (!result.ok) return result;

  // Web-only side effects using metadata returned by core
  if (result.cardSlug && result.projectCode && result.draftAuthorId) {
    await notifyDraftApproved(supabase, {
      draftId: input.draftId,
      draftAuthorId: result.draftAuthorId,
      approverActorId: user.id,
      projectId: result.projectId,
      projectCode: result.projectCode,
      cardId: "", // not needed by notifyDraftApproved — it only needs slug
      cardSlug: result.cardSlug,
      eventKind: result.eventKind,
    });
    // Best-effort Expo push for draft approved — recipient is the draft author.
    if (result.draftAuthorId !== user.id) {
      void sendExpoPush([result.draftAuthorId], {
        title: "Draft Anda disetujui",
        body:  `Draft ${result.eventKind} Anda disetujui dan dicatat di kartu`,
        data:  { link: `/project/${result.projectCode}/cards/${result.cardSlug}` },
      }).catch(console.warn);
    }
  }

  // B4 fix: the approved draft's card_events insert fires the same
  // card_events_mark_stale trigger as createCardEvent — recompute
  // unconditionally in after() rather than gating on the old gateRelevant
  // allowlist (see comment near GATE_RELEVANT_KINDS above). This path
  // previously never fired the fix applied to createCardEvent, so approved
  // drafts left "N stale" cells behind exactly like the direct-log path did.
  if (result.projectCode) {
    const projectId = result.projectId;
    const projectCode = result.projectCode;
    const eventKind = result.eventKind;
    after(async () => {
      try {
        if (INFERABLE_KINDS.has(eventKind)) {
          await processPendingStepInference(createSupabaseAdminClient(), 5);
        }
      } catch (e) {
        Sentry.captureException(e, { extra: { where: "approveCardEventDraft.after.inference" } });
      }
      try {
        await recomputeProjectGatesSystem(projectId, projectCode);
      } catch (e) {
        Sentry.captureException(e, { extra: { where: "approveCardEventDraft.after.recompute" } });
      }
    });
  }

  revalidatePath("/review");
  return { ok: true, eventId: result.eventId };
}

const WebRejectDraftInput = z.object({
  draftId: z.string().uuid(),
  reason:  z.string().max(500).optional(),
});

export async function rejectCardEventDraft(formData: FormData): Promise<MemberResult> {
  let input;
  try {
    input = WebRejectDraftInput.parse({
      draftId: formData.get("draftId"),
      reason:  formData.get("reason") || undefined,
    });
  } catch {
    return { ok: false, error: "Form tidak valid" };
  }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sesi tidak ditemukan" };

  // Delegate DB logic to @datum/core
  const result = await coreRejectCardEventDraft(supabase, {
    draftId: input.draftId,
    rejectorId: user.id,
    reason: input.reason,
  });
  if (!result.ok) return result;

  // Web-only side effect: notify draft author
  if (result.draftAuthorId) {
    await notifyDraftRejected(supabase, {
      draftId: input.draftId,
      draftAuthorId: result.draftAuthorId,
      rejectorActorId: user.id,
      projectId: result.projectId,
      reason: input.reason ?? null,
      eventKind: result.eventKind,
    });
    // Best-effort Expo push for draft rejected — recipient is the draft author.
    if (result.draftAuthorId !== user.id) {
      const reasonText = input.reason ? ` — alasan: "${input.reason}"` : "";
      void sendExpoPush([result.draftAuthorId], {
        title: "Draft Anda ditolak",
        body:  `Draft ${result.eventKind} Anda ditolak${reasonText}`,
        data:  { link: "/review" },
      }).catch(console.warn);
    }
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
  // "Apa keputusannya?" — optional inline input on "Tandai diputuskan".
  outcome:     z.string().max(500).optional(),
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
      outcome:     formData.get("outcome") || undefined,
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
    outcome:   input.outcome,
  });
  if (!result.ok) return result;

  revalidatePath(`/project/${input.projectCode}/cards/${input.cardSlug}`);
  return { ok: true };
}
