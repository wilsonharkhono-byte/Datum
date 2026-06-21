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
