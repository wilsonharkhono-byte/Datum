import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Supa = SupabaseClient<Database>;

// Best-effort fire-and-forget; never throws. Failures are logged via console.
async function safeInsert(
  supabase: Supa,
  rows: Database["public"]["Tables"]["notifications"]["Insert"][],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) console.warn("[notifications] insert failed:", error.message);
}

// 1. Mention: someone @mentioned a staff in a comment
export async function notifyMentions(supabase: Supa, args: {
  mentionedStaffIds: string[];
  actorId: string;
  projectId: string;
  cardId: string;
  cardSlug: string;
  cardComment: { id: string; body: string };
  projectCode: string;
}): Promise<void> {
  if (args.mentionedStaffIds.length === 0) return;
  const preview = args.cardComment.body.length > 100
    ? args.cardComment.body.slice(0, 100) + "…"
    : args.cardComment.body;
  await safeInsert(supabase, args.mentionedStaffIds
    .filter((id) => id !== args.actorId) // don't notify self-mentions
    .map((staffId) => ({
      recipient_staff_id: staffId,
      kind: "mention" as const,
      project_id: args.projectId,
      card_id: args.cardId,
      card_comment_id: args.cardComment.id,
      actor_staff_id: args.actorId,
      summary: `Anda disebut di komentar: "${preview}"`,
      link: `/project/${args.projectCode}/cards/${args.cardSlug}`,
    })));
}

// 2. Watcher event: fan out to card_members (owner/watcher/assignee).
//    Decisions and client requests always notify; work only when it is a
//    blocker or a defect — routine progress logs would be noise.
const NOTIFIABLE_KINDS = new Set(["decision", "client_request", "work"]);

export function shouldNotifyWatchers(
  eventKind: string,
  payload?: Record<string, unknown> | null,
): boolean {
  if (!NOTIFIABLE_KINDS.has(eventKind)) return false;
  if (eventKind === "work") {
    return payload?.status === "blocked" || payload?.issue === "defect";
  }
  return true;
}

export async function notifyWatchersOfEvent(supabase: Supa, args: {
  eventId: string;
  eventKind: string;
  payload?: Record<string, unknown> | null;
  actorId: string;
  projectId: string;
  projectCode: string;
  cardId: string;
  cardSlug: string;
  cardTitle: string;
}): Promise<void> {
  if (!shouldNotifyWatchers(args.eventKind, args.payload)) return;
  const { data: members } = await supabase
    .from("card_members")
    .select("staff_id")
    .eq("card_id", args.cardId)
    .is("removed_at", null);
  const recipients = (members ?? [])
    .map((m) => m.staff_id)
    .filter((id): id is string => typeof id === "string" && id !== args.actorId);
  // Dedup
  const unique = [...new Set(recipients)];
  await safeInsert(supabase, unique.map((staffId) => ({
    recipient_staff_id: staffId,
    kind: "watcher_event" as const,
    project_id: args.projectId,
    card_id: args.cardId,
    card_event_id: args.eventId,
    actor_staff_id: args.actorId,
    summary: `${args.eventKind} baru di "${args.cardTitle}"`,
    link: `/project/${args.projectCode}/cards/${args.cardSlug}`,
  })));
}

// 3. Card status changed
export async function notifyCardStatusChange(supabase: Supa, args: {
  cardId: string;
  cardTitle: string;
  cardSlug: string;
  projectId: string;
  projectCode: string;
  newStatus: string;
  actorId: string;
}): Promise<void> {
  const { data: members } = await supabase
    .from("card_members")
    .select("staff_id")
    .eq("card_id", args.cardId)
    .is("removed_at", null);
  const recipients = (members ?? [])
    .map((m) => m.staff_id)
    .filter((id): id is string => typeof id === "string" && id !== args.actorId);
  await safeInsert(supabase, [...new Set(recipients)].map((staffId) => ({
    recipient_staff_id: staffId,
    kind: "card_status" as const,
    project_id: args.projectId,
    card_id: args.cardId,
    actor_staff_id: args.actorId,
    summary: `Status kartu "${args.cardTitle}" diubah ke ${args.newStatus}`,
    link: `/project/${args.projectCode}/cards/${args.cardSlug}`,
  })));
}

// 4. Draft approved (notify the original author)
export async function notifyDraftApproved(supabase: Supa, args: {
  draftId: string;
  draftAuthorId: string;
  approverActorId: string;
  projectId: string;
  projectCode: string;
  cardId: string;
  cardSlug: string;
  eventKind: string;
}): Promise<void> {
  if (args.draftAuthorId === args.approverActorId) return;
  await safeInsert(supabase, [{
    recipient_staff_id: args.draftAuthorId,
    kind: "draft_approved" as const,
    project_id: args.projectId,
    card_id: args.cardId,
    draft_id: args.draftId,
    actor_staff_id: args.approverActorId,
    summary: `Draft ${args.eventKind} Anda disetujui dan dicatat di kartu`,
    link: `/project/${args.projectCode}/cards/${args.cardSlug}`,
  }]);
}

// 5. Draft rejected (notify author with reason if provided)
export async function notifyDraftRejected(supabase: Supa, args: {
  draftId: string;
  draftAuthorId: string;
  rejectorActorId: string;
  projectId: string;
  reason?: string | null;
  eventKind: string;
}): Promise<void> {
  if (args.draftAuthorId === args.rejectorActorId) return;
  const reasonText = args.reason ? ` — alasan: "${args.reason}"` : "";
  await safeInsert(supabase, [{
    recipient_staff_id: args.draftAuthorId,
    kind: "draft_rejected" as const,
    project_id: args.projectId,
    draft_id: args.draftId,
    actor_staff_id: args.rejectorActorId,
    summary: `Draft ${args.eventKind} Anda ditolak${reasonText}`,
    link: "/review",
  }]);
}

// High-risk event went straight to a card → notify principals/admins so
// they can spot-check it. Fires from createCardEvent when the event_kind is
// in HIGH_RISK_KINDS. Best-effort, never throws.
//
// Uses the service-role client because the caller (e.g. a designer) is rarely
// allowed to read principal/admin staff rows under the project-scoped staff
// RLS — without it the staff select returns only the caller's own row and the
// principal notification never fires.
export async function notifyPrincipalsOfHighRiskEvent(_supabase: Supa, args: {
  eventId: string;
  eventKind: string;
  actorId: string;
  projectId: string;
  projectCode: string;
  cardId: string;
  cardSlug: string;
  cardTitle: string;
  preview?: string | null;  // 1-line summary of the payload, e.g. the request_text
}): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: reviewers } = await admin
    .from("staff")
    .select("id")
    .eq("active", true)
    .in("role", ["principal", "admin"]);
  const recipients = (reviewers ?? [])
    .map((s) => s.id)
    .filter((id) => id !== args.actorId);
  const unique = [...new Set(recipients)];
  const previewText = args.preview && args.preview.trim().length > 0
    ? `: "${args.preview.length > 80 ? args.preview.slice(0, 80) + "…" : args.preview}"`
    : "";
  await safeInsert(admin, unique.map((staffId) => ({
    recipient_staff_id: staffId,
    kind: "watcher_event" as const,  // reuse existing kind; semantics are "noteworthy"
    project_id: args.projectId,
    card_id: args.cardId,
    card_event_id: args.eventId,
    actor_staff_id: args.actorId,
    summary: `${args.eventKind} berisiko tinggi di "${args.cardTitle}"${previewText}`,
    link: `/project/${args.projectCode}/cards/${args.cardSlug}`,
  })));
}

// 6. New draft → notify cross-project-read roles (principal/admin/estimator)
//    so they know there's something pending. Best-effort fan-out.
export async function notifyDraftPending(supabase: Supa, args: {
  draftId: string;
  actorId: string;
  projectId: string;
  eventKind: string;
  cardTitle: string;
  cardId: string;
}): Promise<void> {
  // Fan out to all active principals (simplest approximation of "reviewers")
  const { data: principals } = await supabase
    .from("staff")
    .select("id")
    .eq("active", true)
    .eq("role", "principal");
  const recipients = (principals ?? [])
    .map((s) => s.id)
    .filter((id) => id !== args.actorId);
  await safeInsert(supabase, recipients.map((staffId) => ({
    recipient_staff_id: staffId,
    kind: "draft_pending" as const,
    project_id: args.projectId,
    card_id: args.cardId,
    draft_id: args.draftId,
    actor_staff_id: args.actorId,
    summary: `Draft ${args.eventKind} baru menunggu approval untuk "${args.cardTitle}"`,
    link: "/review",
  })));
}
