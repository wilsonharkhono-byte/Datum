"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { keys } from "./keys";
import { applyAddCard, applyMoveCard, removeCardById } from "@/lib/cards/optimisticBoard";
import { createCard, moveCard, createComment } from "@/lib/cards/mutations";
import type { Board } from "@/lib/cards/queries";
import type { CardPayload } from "@/app/api/card/[code]/[slug]/route";
import type { CardComment } from "@datum/db";

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
      return { optimisticId };
    },
    // Surgical rollback: remove only this mutation's ghost from the *current*
    // cache. Restoring a whole onMutate snapshot would clobber sibling
    // optimistic updates that landed after this one started.
    onError: (_e, _fd, ctx) => {
      if (!ctx) return;
      const cur = qc.getQueryData<Board>(keys.board(code));
      if (cur) qc.setQueryData(keys.board(code), removeCardById(cur, ctx.optimisticId));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}

/** Optimistically append a comment to the cached card. `code`/`slug` are the
    card-query identity (= projectCode/cardSlug). The ghost matches the
    CardComment row shape so CommentItem renders it unchanged; it carries a
    unique `optimistic:` id (no React key collisions on rapid double-posts) and
    a real `created_at` so the timestamp renders rather than "Invalid Date". A
    null created_by_staff_id keeps the ghost non-editable until the real row
    arrives via onSettled invalidation. */
export function useAddComment(code: string, slug: string) {
  const qc = useQueryClient();
  return useMutation({
    // Server action resolves with { ok: false, error } instead of throwing, so
    // re-throw here to give onError a single rollback path.
    mutationFn: async (fd: FormData) => {
      const res = await createComment(fd);
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onMutate: async (fd: FormData) => {
      const body = String(fd.get("body") ?? "");
      const cardId = String(fd.get("cardId") ?? "");
      const projectId = String(fd.get("projectId") ?? "");
      await qc.cancelQueries({ queryKey: keys.card(code, slug) });
      const prev = qc.getQueryData<CardPayload>(keys.card(code, slug));
      const ghostId = `optimistic:${crypto.randomUUID()}`;
      if (prev) {
        const ghost: CardComment = {
          id: ghostId,
          card_id: cardId,
          project_id: projectId,
          body,
          mentions: [],
          created_by_staff_id: null,
          created_at: new Date().toISOString(),
          edited_at: null,
          deleted_at: null,
        };
        qc.setQueryData<CardPayload>(keys.card(code, slug), {
          ...prev,
          comments: [...prev.comments, ghost],
        });
      }
      return { ghostId };
    },
    // Surgical rollback: drop only this mutation's ghost comment (see
    // useAddCard for why snapshot-restore is wrong under concurrency).
    onError: (_e, _fd, ctx) => {
      if (!ctx) return;
      const cur = qc.getQueryData<CardPayload>(keys.card(code, slug));
      if (cur) {
        qc.setQueryData<CardPayload>(keys.card(code, slug), {
          ...cur,
          comments: cur.comments.filter((c) => c.id !== ctx.ghostId),
        });
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.card(code, slug) }),
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
      let fromTopicId: string | null = null;
      if (prev) {
        for (const col of prev.columns) {
          if (col.cards.some((c) => c.id === cardId)) { fromTopicId = col.topic.id; break; }
        }
        qc.setQueryData(keys.board(code), applyMoveCard(prev, cardId, newTopicId));
      }
      return { cardId, fromTopicId };
    },
    // Surgical rollback: move only this card back to where it came from (see
    // useAddCard for why snapshot-restore is wrong under concurrency).
    onError: (_e, _fd, ctx) => {
      if (!ctx?.fromTopicId) return;
      const cur = qc.getQueryData<Board>(keys.board(code));
      if (cur) qc.setQueryData(keys.board(code), applyMoveCard(cur, ctx.cardId, ctx.fromTopicId));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(code) }),
  });
}
