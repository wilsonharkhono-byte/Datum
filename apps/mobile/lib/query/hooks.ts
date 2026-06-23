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
  fetchMatrix,
  getProjectScheduleCells,
  getGateCheckpoints,
  getProjectRooms,
  getProjectAreas,
  getProjectMembers,
  getAvailableStaff,
  getProjectBySlug,
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

// ─── Schedule / gates / matrix ────────────────────────────────────────────────

/**
 * Full area × gate readiness matrix for a project.
 *
 * REALTIME GAP: gate-status live updates require a DB publication on
 * `area_gate_status` that is not yet enabled. Until that migration lands,
 * the matrix is kept fresh via refetchOnWindowFocus + pull-to-refresh on the
 * schedule screen. The cron-triggered recompute will reflect within 1–2 min.
 */
export function useMatrix(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? keys.matrix(projectId) : ["matrix", "none"],
    enabled: !!projectId,
    queryFn: () => fetchMatrix(supabase, projectId!),
    refetchOnWindowFocus: true,
  });
}

/**
 * Overlaid ScheduledCell[] (per-area target windows) for a project.
 * Used alongside useMatrix to show target start/end dates per gate per area.
 *
 * Same realtime gap as useMatrix — pull-to-refresh on the schedule screen.
 */
export function useScheduleCells(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? keys.schedule(projectId) : ["schedule", "none"],
    enabled: !!projectId,
    queryFn: () => getProjectScheduleCells(supabase, projectId!),
    refetchOnWindowFocus: true,
  });
}

/**
 * Lampiran-A checkpoint templates for a gate — static reference data, cached
 * indefinitely (never changes unless seeded again).
 */
export function useGateCheckpoints(gateCode: string | undefined) {
  return useQuery({
    queryKey: gateCode ? keys.gateCheckpoints(gateCode) : ["gateCheckpoints", "none"],
    enabled: !!gateCode,
    queryFn: () => getGateCheckpoints(supabase, gateCode!),
    staleTime: Infinity,
  });
}

// ─── Rooms + Areas ────────────────────────────────────────────────────────────

/**
 * ProjectRooms (sorted Room[]) for a project identified by its slug (project_code).
 * Sorted by urgency via sortRoomsByUrgency in core — blockers first, then stage progress.
 */
export function useRooms(slug: string) {
  return useQuery({
    queryKey: keys.rooms(slug),
    queryFn: () => getProjectRooms(supabase, slug),
    enabled: !!slug,
  });
}

/**
 * Area[] for a project, ordered by sort_order asc, area_code asc.
 * Disabled until projectId is known.
 */
export function useAreas(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? keys.areas(projectId) : ["areas", "none"],
    enabled: !!projectId,
    queryFn: () => getProjectAreas(supabase, projectId!),
  });
}

// ─── Members + Settings ───────────────────────────────────────────────────────

/**
 * project_staff rows for a project (active + inactive).
 * Filter by !active_until on the client to get currently-active members.
 * Disabled until projectId is known.
 */
export function useProjectMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? keys.projectMembers(projectId) : ["project-members", "none"],
    enabled: !!projectId,
    queryFn: () => getProjectMembers(supabase, projectId!),
  });
}

/**
 * All active staff rows — used as the "add member" picker source.
 * Filter out already-active members client-side.
 */
export function useAvailableStaff() {
  return useQuery({
    queryKey: keys.availableStaff(),
    queryFn: () => getAvailableStaff(supabase),
  });
}

/**
 * Project settings row (id, code, name, client, location, status, dates) by slug.
 * Disabled when slug is empty.
 */
export function useProjectSettings(slug: string) {
  return useQuery({
    queryKey: keys.projectSettings(slug),
    enabled: !!slug,
    queryFn: () => getProjectBySlug(supabase, slug),
  });
}
