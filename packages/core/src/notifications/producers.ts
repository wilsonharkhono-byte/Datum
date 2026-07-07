/**
 * Anon-safe notification producers — every function here uses only the
 * caller-supplied SupabaseClient (never the service-role admin client) and only
 * inserts `notifications` rows that the caller's RLS permits.
 *
 * NOT included here:
 *   - notifyPrincipalsOfHighRiskEvent  — requires the service-role admin client to
 *     read principal/admin staff rows across project-scoped RLS; stays in
 *     apps/web/lib/notifications/producers.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import type { EventKind } from "@datum/types";

type Supa = SupabaseClient<Database>;

// ─── Internal helper ──────────────────────────────────────────────────────────

/** Best-effort fire-and-forget; never throws. Failures are logged via console. */
async function safeInsert(
  supabase: Supa,
  rows: Database["public"]["Tables"]["notifications"]["Insert"][],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) console.warn("[notifications] insert failed:", error.message);
}

// ─── 1. Mentions ──────────────────────────────────────────────────────────────

/** Fan out mention notifications to @mentioned staff. Self-mentions are filtered. */
export async function notifyMentions(
  supabase: Supa,
  args: {
    mentionedStaffIds: string[];
    actorId:           string;
    projectId:         string;
    cardId:            string;
    cardSlug:          string;
    cardComment:       { id: string; body: string };
    projectCode:       string;
  },
): Promise<void> {
  if (args.mentionedStaffIds.length === 0) return;
  const preview =
    args.cardComment.body.length > 100
      ? args.cardComment.body.slice(0, 100) + "…"
      : args.cardComment.body;
  await safeInsert(
    supabase,
    args.mentionedStaffIds
      .filter((id) => id !== args.actorId) // don't notify self-mentions
      .map((staffId) => ({
        recipient_staff_id: staffId,
        kind:               "mention" as const,
        project_id:         args.projectId,
        card_id:            args.cardId,
        card_comment_id:    args.cardComment.id,
        actor_staff_id:     args.actorId,
        summary:            `Anda disebut di komentar: "${preview}"`,
        link:               `/project/${args.projectCode}/cards/${args.cardSlug}`,
      })),
  );
}

// ─── 2. Watcher event ─────────────────────────────────────────────────────────

/**
 * Decisions and client_requests always notify; work events only notify when
 * the payload indicates a blocker or defect — routine progress logs are noise.
 */
const NOTIFIABLE_KINDS: ReadonlySet<EventKind> = new Set([
  "decision",
  "client_request",
  "work",
]);

export function shouldNotifyWatchers(
  eventKind: string,
  payload?: Record<string, unknown> | null,
): boolean {
  if (!NOTIFIABLE_KINDS.has(eventKind as EventKind)) return false;
  if (eventKind === "work") {
    return payload?.status === "blocked" || payload?.issue === "defect";
  }
  return true;
}

/** Fan out watcher notifications to all active card_members (owner/watcher/assignee).
    Returns the recipient staff ids so callers (e.g. Expo push) reuse the same
    derivation instead of re-querying card_members. */
export async function notifyWatchersOfEvent(
  supabase: Supa,
  args: {
    eventId:     string;
    eventKind:   string;
    payload:     Record<string, unknown> | null;
    actorId:     string;
    projectId:   string;
    projectCode: string;
    cardId:      string;
    cardSlug:    string;
    cardTitle:   string;
  },
): Promise<string[]> {
  if (!shouldNotifyWatchers(args.eventKind, args.payload)) return [];
  const { data: members, error } = await supabase
    .from("card_members")
    .select("staff_id")
    .eq("card_id", args.cardId)
    .is("removed_at", null);
  if (error) {
    console.warn("[notifications] watcher recipient read failed:", error.message);
    return [];
  }
  const recipients = (members ?? [])
    .map((m) => m.staff_id)
    .filter((id): id is string => typeof id === "string" && id !== args.actorId);
  const unique = [...new Set(recipients)];
  await safeInsert(
    supabase,
    unique.map((staffId) => ({
      recipient_staff_id: staffId,
      kind:               "watcher_event" as const,
      project_id:         args.projectId,
      card_id:            args.cardId,
      card_event_id:      args.eventId,
      actor_staff_id:     args.actorId,
      summary:            `${args.eventKind} baru di "${args.cardTitle}"`,
      link:               `/project/${args.projectCode}/cards/${args.cardSlug}`,
    })),
  );
  return unique;
}

// ─── 3. Card status changed ───────────────────────────────────────────────────

/** Notify all card members when a card's status changes. Returns recipient ids. */
export async function notifyCardStatusChange(
  supabase: Supa,
  args: {
    cardId:      string;
    cardTitle:   string;
    cardSlug:    string;
    projectId:   string;
    projectCode: string;
    newStatus:   string;
    actorId:     string;
  },
): Promise<string[]> {
  const { data: members, error } = await supabase
    .from("card_members")
    .select("staff_id")
    .eq("card_id", args.cardId)
    .is("removed_at", null);
  if (error) {
    console.warn("[notifications] status-change recipient read failed:", error.message);
    return [];
  }
  const recipients = (members ?? [])
    .map((m) => m.staff_id)
    .filter((id): id is string => typeof id === "string" && id !== args.actorId);
  const unique = [...new Set(recipients)];
  await safeInsert(
    supabase,
    unique.map((staffId) => ({
      recipient_staff_id: staffId,
      kind:               "card_status" as const,
      project_id:         args.projectId,
      card_id:            args.cardId,
      actor_staff_id:     args.actorId,
      summary:            `Status kartu "${args.cardTitle}" diubah ke ${args.newStatus}`,
      link:               `/project/${args.projectCode}/cards/${args.cardSlug}`,
    })),
  );
  return unique;
}

// ─── 4. Draft approved ────────────────────────────────────────────────────────

/** Notify the draft author when their draft is approved. */
export async function notifyDraftApproved(
  supabase: Supa,
  args: {
    draftId:         string;
    draftAuthorId:   string;
    approverActorId: string;
    projectId:       string;
    projectCode:     string;
    cardId:          string;
    cardSlug:        string;
    eventKind:       string;
  },
): Promise<void> {
  if (args.draftAuthorId === args.approverActorId) return;
  await safeInsert(supabase, [
    {
      recipient_staff_id: args.draftAuthorId,
      kind:               "draft_approved" as const,
      project_id:         args.projectId,
      card_id:            args.cardId,
      draft_id:           args.draftId,
      actor_staff_id:     args.approverActorId,
      summary:            `Draft ${args.eventKind} Anda disetujui dan dicatat di kartu`,
      link:               `/project/${args.projectCode}/cards/${args.cardSlug}`,
    },
  ]);
}

// ─── 5. Draft rejected ────────────────────────────────────────────────────────

/** Notify the draft author when their draft is rejected. */
export async function notifyDraftRejected(
  supabase: Supa,
  args: {
    draftId:         string;
    draftAuthorId:   string;
    rejectorActorId: string;
    projectId:       string;
    reason?:         string | null;
    eventKind:       string;
  },
): Promise<void> {
  if (args.draftAuthorId === args.rejectorActorId) return;
  const reasonText = args.reason ? ` — alasan: "${args.reason}"` : "";
  await safeInsert(supabase, [
    {
      recipient_staff_id: args.draftAuthorId,
      kind:               "draft_rejected" as const,
      project_id:         args.projectId,
      draft_id:           args.draftId,
      actor_staff_id:     args.rejectorActorId,
      summary:            `Draft ${args.eventKind} Anda ditolak${reasonText}`,
      link:               "/review",
    },
  ]);
}

// ─── 6. Draft pending ─────────────────────────────────────────────────────────

/**
 * Notify principal staff when a new draft awaits approval.
 *
 * NOTE: This reads from `staff` with `role = "principal"` which is accessible to
 * the caller under the normal anon client (principals are readable when the caller
 * has project membership). If this becomes insufficient, move to the admin-client
 * variant in web (like notifyPrincipalsOfHighRiskEvent).
 */
export async function notifyDraftPending(
  supabase: Supa,
  args: {
    draftId:   string;
    actorId:   string;
    projectId: string;
    eventKind: string;
    cardTitle: string;
    cardId:    string;
  },
): Promise<string[]> {
  const { data: principals, error } = await supabase
    .from("staff")
    .select("id")
    .eq("active", true)
    .eq("role", "principal");
  if (error) {
    console.warn("[notifications] principal recipient read failed:", error.message);
    return [];
  }
  const recipients = (principals ?? [])
    .map((s) => s.id)
    .filter((id) => id !== args.actorId);
  await safeInsert(
    supabase,
    recipients.map((staffId) => ({
      recipient_staff_id: staffId,
      kind:               "draft_pending" as const,
      project_id:         args.projectId,
      card_id:            args.cardId,
      draft_id:           args.draftId,
      actor_staff_id:     args.actorId,
      summary:            `Draft ${args.eventKind} baru menunggu approval untuk "${args.cardTitle}"`,
      link:               "/review",
    })),
  );
  return recipients;
}
