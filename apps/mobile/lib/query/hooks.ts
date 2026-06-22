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
  getBriefData,
  getAdvisorData,
  listPendingCardEventDrafts,
  getRecentNotifications,
  getUnreadCount,
  getRecentActivity,
  keys,
} from "@datum/core";
import type { GetAdvisorOpts } from "@datum/core";
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

// ─── Brief + Advisor ──────────────────────────────────────────────────────────

/** Morning brief: all 6 sections + gateRisks + staleByProject. */
export function useBrief() {
  return useQuery({
    queryKey: keys.brief(),
    queryFn: () => getBriefData(supabase),
  });
}

/**
 * Hari Ini advisor feed — ranked next-action items.
 * Pass `{ projectId }` to scope to a single project; omit for cross-project.
 */
export function useAdvisor(scope?: { projectId: string }) {
  const opts: GetAdvisorOpts = { now: new Date(), limit: 10, projectId: scope?.projectId };
  return useQuery({
    queryKey: keys.advisor(scope ? { projectId: scope.projectId } : "all"),
    queryFn: () => getAdvisorData(supabase, opts),
    // Re-fetch `now` on each call so the score reflects the real current time.
    staleTime: 60_000,
  });
}

// ─── Review queue ─────────────────────────────────────────────────────────────

/** All pending AI card-event drafts (status='draft', draft_type='card_event'). */
export function useReviewDrafts() {
  return useQuery({
    queryKey: keys.reviewDrafts(),
    queryFn: () => listPendingCardEventDrafts(supabase),
  });
}

// ─── Notifications ────────────────────────────────────────────────────────────

/** 50 most recent notifications for the current staff member. */
export function useNotifications(staffId: string | undefined) {
  return useQuery({
    queryKey: staffId ? keys.notifications(staffId) : ["notifications", "none"],
    enabled: !!staffId,
    queryFn: () => getRecentNotifications(supabase),
  });
}

/** Live unread notification count for the current staff member. */
export function useUnreadCount(staffId: string | undefined) {
  return useQuery({
    queryKey: staffId ? keys.unreadCount(staffId) : ["notifications", "none", "unread"],
    enabled: !!staffId,
    queryFn: () => getUnreadCount(supabase),
    staleTime: 30_000,
  });
}

/** Recent cross-project activity feed (card events, comments, new cards). */
export function useActivity() {
  return useQuery({
    queryKey: keys.activity(),
    queryFn: () => getRecentActivity(supabase),
    staleTime: 60_000,
  });
}
