"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "./keys";
import { applyAddCard, applyMoveCard } from "@/lib/cards/optimisticBoard";
import { createCard, moveCard } from "@/lib/cards/mutations";
import type { Board } from "@/lib/cards/queries";

export function useAddCard(code: string) {
  const qc = useQueryClient();
  return useMutation({
    // Server actions resolve with { ok: false, error } instead of throwing, so
    // re-throw here to give onError a single rollback path.
    mutationFn: async (fd: FormData) => {
      const res = await createCard(fd);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (fd: FormData) => {
      const topicId = String(fd.get("topicId"));
      const title = String(fd.get("title"));
      const optimisticId = `optimistic:${topicId}:${crypto.randomUUID()}`;
      await qc.cancelQueries({ queryKey: keys.board(code) });
      const prev = qc.getQueryData<Board>(keys.board(code));
      if (prev) qc.setQueryData(keys.board(code), applyAddCard(prev, topicId, title, optimisticId));
      return { prev };
    },
    onError: (_e, _fd, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board(code), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}

export function useMoveCard(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (fd: FormData) => {
      const res = await moveCard(fd);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (fd: FormData) => {
      const cardId = String(fd.get("cardId"));
      const newTopicId = String(fd.get("newTopicId"));
      await qc.cancelQueries({ queryKey: keys.board(code) });
      const prev = qc.getQueryData<Board>(keys.board(code));
      if (prev) qc.setQueryData(keys.board(code), applyMoveCard(prev, cardId, newTopicId));
      return { prev };
    },
    onError: (_e, _fd, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board(code), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}
