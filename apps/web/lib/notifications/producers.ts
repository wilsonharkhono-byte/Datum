/**
 * Notification producers for the web app.
 *
 * Anon-safe producers (those that only need the caller's Supabase client) are
 * re-exported from @datum/core so mobile and web share a single implementation.
 *
 * notifyPrincipalsOfHighRiskEvent is defined here (web-only) because it requires
 * the service-role admin client to read principal/admin staff rows that the
 * project-scoped RLS would otherwise hide from a normal caller.
 */

// ─── Re-export anon-safe producers from @datum/core ──────────────────────────
export {
  notifyMentions,
  shouldNotifyWatchers,
  notifyWatchersOfEvent,
  notifyCardStatusChange,
  notifyDraftApproved,
  notifyDraftRejected,
  notifyDraftPending,
} from "@datum/core";

// ─── Admin-client producer (web-only, NOT in @datum/core) ────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Supa = SupabaseClient<Database>;

// High-risk event went straight to a card → notify principals/admins so they
// can spot-check it. Fires from createCardEvent when the event_kind is in
// HIGH_RISK_KINDS. Best-effort, never throws.
//
// Uses the service-role client because this select must see ALL active
// principals/admins firm-wide: under the shared-project staff policy
// (staff_read_shared_project_colleagues, 20260708000001) a caller who shares
// no project with a given principal/admin cannot read that row, so a caller's
// own client could silently miss reviewers and the notification never fires.
export async function notifyPrincipalsOfHighRiskEvent(
  _supabase: Supa,
  args: {
    eventId:     string;
    eventKind:   string;
    actorId:     string;
    projectId:   string;
    projectCode: string;
    cardId:      string;
    cardSlug:    string;
    cardTitle:   string;
    preview?:    string | null;
  },
): Promise<void> {
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
  const previewText =
    args.preview && args.preview.trim().length > 0
      ? `: "${args.preview.length > 80 ? args.preview.slice(0, 80) + "…" : args.preview}"`
      : "";
  if (unique.length === 0) return;
  const { error } = await admin.from("notifications").insert(
    unique.map((staffId) => ({
      recipient_staff_id: staffId,
      kind:               "watcher_event" as const,
      project_id:         args.projectId,
      card_id:            args.cardId,
      card_event_id:      args.eventId,
      actor_staff_id:     args.actorId,
      summary:            `${args.eventKind} berisiko tinggi di "${args.cardTitle}"${previewText}`,
      link:               `/project/${args.projectCode}/cards/${args.cardSlug}`,
    })),
  );
  if (error) console.warn("[notifications] insert failed:", error.message);
}
