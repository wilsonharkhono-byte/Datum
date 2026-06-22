import { useQuery } from "@tanstack/react-query";
import {
  getProjectsList,
  getDevelopments,
  getBoardForProject,
  getProjectTopics,
  getCardWithTimelineByProjectCode,
  getCardComments,
  getCardMembers,
  getCardAttachments,
  keys,
} from "@datum/core";
import { supabase } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/env";

export function useProjects() {
  return useQuery({
    queryKey: keys.projects(),
    queryFn: () => getProjectsList(supabase, SUPABASE_URL),
  });
}

export function useDevelopments() {
  return useQuery({
    queryKey: ["developments"],
    queryFn: () => getDevelopments(supabase),
  });
}

export function useBoard(code: string) {
  return useQuery({
    queryKey: keys.board(code),
    queryFn: () => getBoardForProject(supabase, code),
  });
}

export function useProjectTopics(projectId: string | undefined) {
  return useQuery({
    queryKey: ["topics", projectId],
    enabled: !!projectId,
    queryFn: () => getProjectTopics(supabase, projectId!),
  });
}

// ─── Card-detail reads ────────────────────────────────────────────────────────

/** Load the card header + timeline (events) for a (projectCode, cardSlug) pair. */
export function useCard(code: string, slug: string) {
  return useQuery({
    queryKey: keys.card(code, slug),
    queryFn: () => getCardWithTimelineByProjectCode(supabase, code, slug),
  });
}

/** Load all comments for a card. Disabled until cardId is known. */
export function useCardComments(cardId: string | undefined) {
  return useQuery({
    queryKey: ["card-comments", cardId],
    enabled: !!cardId,
    queryFn: () => getCardComments(supabase, cardId!),
  });
}

/** Load all active members for a card. Disabled until cardId is known. */
export function useCardMembers(cardId: string | undefined) {
  return useQuery({
    queryKey: ["card-members", cardId],
    enabled: !!cardId,
    queryFn: () => getCardMembers(supabase, cardId!),
  });
}

/** Load attachments keyed by event id. Disabled until cardId is known. */
export function useCardAttachments(cardId: string | undefined) {
  return useQuery({
    queryKey: ["card-attachments", cardId],
    enabled: !!cardId,
    queryFn: () => getCardAttachments(supabase, cardId!),
  });
}
