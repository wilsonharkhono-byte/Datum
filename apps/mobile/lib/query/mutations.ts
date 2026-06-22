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
  type CreateCardEventInputType,
  type ResolveEventInputType,
  type CardMemberRole,
} from "@datum/core";
import { supabase } from "@/lib/supabase/client";

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
