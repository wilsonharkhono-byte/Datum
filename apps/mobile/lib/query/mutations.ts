import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import {
  keys,
  createCard,
  moveCard,
  createTopic,
  applyAddCard,
  applyMoveCard,
  type Board,
  // Card-detail write actions
  createCardEvent,
  resolveCardEvent,
  createComment,
  editComment,
  deleteComment,
  addCardMember,
  removeCardMember,
  linkCardToArea,
  unlinkCardFromArea,
  type CreateCardEventInputType,
  type ResolveEventInputType,
  type CardMemberRole,
  // Review queue
  approveCardEventDraft,
  rejectCardEventDraft,
  notifyDraftApproved,
  notifyDraftRejected,
  // Notifications
  markNotificationRead,
  markAllNotificationsRead,
  // Gates
  markGatePassed,
  setAreaTargetDate,
  type MarkGatePassedInput,
  type TargetInput,
} from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session/session";

// ─── useAddCard ───────────────────────────────────────────────────────────────

export function useAddCard(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      topicId,
      title,
    }: {
      projectId: string;
      topicId: string;
      title: string;
    }) => {
      const res = await createCard(supabase, { projectId, topicId, title });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async ({ topicId, title }: { projectId: string; topicId: string; title: string }) => {
      const optimisticId = `optimistic:${topicId}:${Crypto.randomUUID()}`;
      await qc.cancelQueries({ queryKey: keys.board(code) });
      const prev = qc.getQueryData<Board>(keys.board(code));
      if (prev) qc.setQueryData(keys.board(code), applyAddCard(prev, topicId, title, optimisticId));
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board(code), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}

// ─── useMoveCard ──────────────────────────────────────────────────────────────

export function useMoveCard(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      cardId,
      newTopicId,
      projectId,
    }: {
      cardId: string;
      newTopicId: string;
      projectId: string;
    }) => {
      const res = await moveCard(supabase, { cardId, newTopicId, projectId });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async ({ cardId, newTopicId }: { cardId: string; newTopicId: string; projectId: string }) => {
      await qc.cancelQueries({ queryKey: keys.board(code) });
      const prev = qc.getQueryData<Board>(keys.board(code));
      if (prev) qc.setQueryData(keys.board(code), applyMoveCard(prev, cardId, newTopicId));
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board(code), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}

// ─── useAddColumn ─────────────────────────────────────────────────────────────

export function useAddColumn(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, name }: { projectId: string; name: string }) => {
      const res = await createTopic(supabase, { projectId, name });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}

// ─── Card-detail: event mutations ─────────────────────────────────────────────

/**
 * Add a new event to a card. Invalidates the card query on settle.
 *
 * NOTE: Gate recompute and high-risk principal notifications are web-only side
 * effects. A mobile-created event won't fire those — acceptable per spec.
 */
export function useAddEvent(code: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCardEventInputType) => {
      const res = await createCardEvent(supabase, input);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.card(code, slug) }),
  });
}

/**
 * Resolve an open-loop event (decision, client_request).
 * Invalidates the card query on settle.
 */
export function useResolveEvent(code: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ResolveEventInputType) => {
      const res = await resolveCardEvent(supabase, input);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.card(code, slug) }),
  });
}

// ─── Card-detail: comment mutations ──────────────────────────────────────────

export function useAddComment(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      projectId: string;
      body: string;
      createdByStaffId: string;
    }) => {
      const res = await createComment(supabase, { cardId, ...args });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["card-comments", cardId] }),
  });
}

export function useEditComment(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { commentId: string; body: string }) => {
      const res = await editComment(supabase, args);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["card-comments", cardId] }),
  });
}

export function useDeleteComment(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const res = await deleteComment(supabase, commentId);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["card-comments", cardId] }),
  });
}

// ─── Review queue: draft approve / reject ─────────────────────────────────────

/**
 * Approve a pending AI draft.
 *
 * On success, best-effort fires notifyDraftApproved (wrapped in try/catch —
 * RLS may deny the approver inserting a notification for the author; that is
 * an open question and must NOT fail the approval itself).
 *
 * NOTE: recomputeProjectGates is web-only; mobile relies on cron/realtime.
 */
export function useApproveDraft() {
  const qc = useQueryClient();
  const { staff } = useSession();
  return useMutation({
    mutationFn: async ({ draftId }: { draftId: string; cardSlug: string | null; projectCode: string | null; cardId: string | null; draftAuthorId: string | null; eventKind: string }) => {
      const approverId = staff?.id;
      if (!approverId) throw new Error("Tidak ada sesi — silakan masuk kembali");
      const res = await approveCardEventDraft(supabase, { draftId, approverId });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: async (res, vars) => {
      if (!res.ok) return;
      // Best-effort notify — RLS may prevent inserting for a different author
      try {
        if (res.draftAuthorId && res.cardSlug && res.projectCode) {
          await notifyDraftApproved(supabase, {
            draftId:         vars.draftId,
            draftAuthorId:   res.draftAuthorId,
            approverActorId: staff!.id,
            projectId:       res.projectId,
            projectCode:     res.projectCode,
            cardId:          res.eventId,   // we use the new event's project+card as context
            cardSlug:        res.cardSlug,
            eventKind:       res.eventKind,
          });
        }
      } catch {
        // Swallow — RLS denial or network hiccup must not break the approve
      }
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: keys.reviewDrafts() });
      // Invalidate the affected card if we have the slug + code
      if (vars.projectCode && vars.cardSlug) {
        void qc.invalidateQueries({ queryKey: keys.card(vars.projectCode, vars.cardSlug) });
      }
    },
  });
}

/**
 * Reject a pending AI draft.
 *
 * On success, best-effort fires notifyDraftRejected (same try/catch rationale
 * as approve — see above).
 */
export function useRejectDraft() {
  const qc = useQueryClient();
  const { staff } = useSession();
  return useMutation({
    mutationFn: async ({ draftId, reason }: { draftId: string; reason?: string }) => {
      const rejectorId = staff?.id;
      if (!rejectorId) throw new Error("Tidak ada sesi — silakan masuk kembali");
      const res = await rejectCardEventDraft(supabase, { draftId, rejectorId, reason });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: async (res, vars) => {
      if (!res.ok) return;
      try {
        if (res.draftAuthorId) {
          await notifyDraftRejected(supabase, {
            draftId:         vars.draftId,
            draftAuthorId:   res.draftAuthorId,
            rejectorActorId: staff!.id,
            projectId:       res.projectId,
            reason:          vars.reason ?? null,
            eventKind:       res.eventKind,
          });
        }
      } catch {
        // Swallow — RLS denial or network hiccup must not break the reject
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.reviewDrafts() });
    },
  });
}

// ─── Card-detail: member mutations ────────────────────────────────────────────

export function useAddMember(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      staffId: string;
      role: CardMemberRole;
      addedByStaffId: string;
    }) => {
      const res = await addCardMember(supabase, { cardId, ...args });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["card-members", cardId] }),
  });
}

export function useRemoveMember(cardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { staffId: string; role: CardMemberRole }) => {
      const res = await removeCardMember(supabase, { cardId, ...args });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["card-members", cardId] }),
  });
}

// ─── Card-detail: area link mutations ────────────────────────────────────────

/**
 * Link a card to an area. Returns the AreaLinkResult (does NOT throw on a
 * business-logic failure — callers check res.ok) since CardAreas surfaces
 * the error message inline rather than via mutation.isError.
 * Invalidates card-areas + the project's areas (matrix reads off areas).
 */
export function useLinkCardArea(cardId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { areaId: string }) => linkCardToArea(supabase, { cardId, ...args }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["card-areas", cardId] });
      void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
    },
  });
}

/**
 * Unlink a card from an area. Same non-throwing result convention as
 * useLinkCardArea.
 */
export function useUnlinkCardArea(cardId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { areaId: string }) => unlinkCardFromArea(supabase, { cardId, ...args }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["card-areas", cardId] });
      void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
    },
  });
}

// ─── Notifications: mark read ─────────────────────────────────────────────────

/** Mark a single notification as read. Invalidates notifications + unread-count. */
export function useMarkRead(staffId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await markNotificationRead(supabase, notificationId);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications(staffId) });
      void qc.invalidateQueries({ queryKey: keys.unreadCount(staffId) });
    },
  });
}

/** Mark all unread notifications as read. Invalidates notifications + unread-count. */
export function useMarkAllRead(staffId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await markAllNotificationsRead(supabase);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.notifications(staffId) });
      void qc.invalidateQueries({ queryKey: keys.unreadCount(staffId) });
    },
  });
}

// ─── Gates: advance + area target ────────────────────────────────────────────

/**
 * Mark a gate as passed for an area.
 *
 * Invalidates matrix + schedule on success. recomputeProjectGates is web-only
 * (runs via cron/realtime on the server); mobile callers do NOT block on it —
 * the server-side cron will reconcile within ~1 min.
 *
 * REALTIME GAP: gate-status publication is not yet live; the matrix query
 * will pick up the change on next window focus or pull-to-refresh.
 */
export function useAdvanceGate(projectId: string) {
  const qc = useQueryClient();
  const { staff } = useSession();
  return useMutation({
    mutationFn: async (raw: Omit<MarkGatePassedInput, "projectId">) => {
      const staffId = staff?.id;
      if (!staffId) throw new Error("Tidak ada sesi — silakan masuk kembali");
      const res = await markGatePassed(supabase, staffId, { ...raw, projectId });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
      void qc.invalidateQueries({ queryKey: keys.schedule(projectId) });
    },
  });
}

/**
 * Set (or clear) the PM handover target date for an area.
 * Invalidates matrix + schedule so the accordion re-renders with fresh windows.
 */
export function useSetAreaTarget(projectId: string) {
  const qc = useQueryClient();
  const { staff } = useSession();
  return useMutation({
    mutationFn: async (input: Pick<TargetInput, "areaId" | "targetDate">) => {
      const staffId = staff?.id;
      if (!staffId) throw new Error("Tidak ada sesi — silakan masuk kembali");
      const res = await setAreaTargetDate(supabase, staffId, { ...input, projectId });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
      void qc.invalidateQueries({ queryKey: keys.schedule(projectId) });
    },
  });
}

// ─── Areas: CRUD + reorder + AI apply ────────────────────────────────────────

import {
  createArea,
  updateArea,
  deleteArea,
  reorderAreas,
  applyAreaProposal,
  type CreateAreaInputType,
  type UpdateAreaInputType,
  type DeleteAreaInputType,
  type ReorderAreasInputType,
  type ApplyAreaProposalInputType,
} from "@datum/core";

// ─── Project member mutations ─────────────────────────────────────────────────

import {
  addProjectMember,
  removeProjectMember,
  updateProject,
  type AddProjectMemberInputType,
  type RemoveProjectMemberInputType,
  type UpdateProjectInputType,
} from "@datum/core";

/**
 * Add an existing staff member to a project.
 * Invalidates projectMembers on settle.
 */
export function useAddProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<AddProjectMemberInputType, "projectId">) => {
      const res = await addProjectMember(supabase, { ...input, projectId });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.projectMembers(projectId) });
    },
  });
}

/**
 * Soft-remove a staff member from a project (sets active_until = today).
 * Invalidates projectMembers on settle.
 */
export function useRemoveProjectMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<RemoveProjectMemberInputType, "projectId">) => {
      const res = await removeProjectMember(supabase, { ...input, projectId });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.projectMembers(projectId) });
    },
  });
}

/**
 * Patch a project's editable fields (name, client, location, status, dates).
 * Invalidates projectSettings (slug) + projects list on settle.
 */
export function useUpdateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateProjectInputType) => {
      const res = await updateProject(supabase, input);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.projectSettings(slug) });
      void qc.invalidateQueries({ queryKey: keys.projects() });
    },
  });
}

/**
 * Create a new area. Invalidates areas + rooms + matrix on settle.
 */
export function useCreateArea(projectId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<CreateAreaInputType, "projectId">) => {
      const res = await createArea(supabase, { ...input, projectId });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
      void qc.invalidateQueries({ queryKey: keys.rooms(slug) });
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
    },
  });
}

/**
 * Update an existing area. Invalidates areas + rooms + matrix on settle.
 */
export function useUpdateArea(projectId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateAreaInputType) => {
      const res = await updateArea(supabase, input);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
      void qc.invalidateQueries({ queryKey: keys.rooms(slug) });
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
    },
  });
}

/**
 * Delete an area. RLS is the backstop — no canManage guard in core.
 * Invalidates areas + rooms + matrix on settle.
 */
export function useDeleteArea(projectId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteAreaInputType) => {
      const res = await deleteArea(supabase, input);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
      void qc.invalidateQueries({ queryKey: keys.rooms(slug) });
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
    },
  });
}

/**
 * Atomically reorder areas. Calls the reorder_project_areas RPC.
 * Invalidates areas + rooms + matrix on settle.
 */
export function useReorderAreas(projectId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReorderAreasInputType) => {
      const res = await reorderAreas(supabase, input);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
      void qc.invalidateQueries({ queryKey: keys.rooms(slug) });
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
    },
  });
}

/**
 * Apply an AI area proposal the user has reviewed.
 * Invalidates areas + rooms + matrix + areaProposal on settle.
 */
export function useApplyAreaProposal(projectId: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApplyAreaProposalInputType) => {
      const res = await applyAreaProposal(supabase, input);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.areas(projectId) });
      void qc.invalidateQueries({ queryKey: keys.rooms(slug) });
      void qc.invalidateQueries({ queryKey: keys.matrix(projectId) });
      void qc.invalidateQueries({ queryKey: keys.areaProposal(projectId) });
    },
  });
}
