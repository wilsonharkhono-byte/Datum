import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import {
  EventPayloadSchemas,
  COST_VISIBLE_KINDS,
  type EventKind,
} from "@datum/types";

/** Input schema — usable by web (parses FormData) and mobile (object call). */
export const ApproveDraftInput = z.object({
  draftId:    z.string().uuid(),
  approverId: z.string().uuid(),
});
export type ApproveDraftInputType = z.infer<typeof ApproveDraftInput>;

/** Kinds whose approval should trigger a gate recompute (web-only side effect). */
export const GATE_RELEVANT_KINDS: ReadonlySet<EventKind> = new Set([
  "work", "material", "decision", "vendor", "drawing", "client_request", "document",
]);

export type ApproveDraftResult =
  | {
      ok: true;
      eventId: string;
      projectId: string;
      projectCode: string | null;
      cardSlug: string | null;
      eventKind: EventKind;
      draftAuthorId: string | null;
      gateRelevant: boolean;
    }
  | { ok: false; error: string };

/**
 * Core approve logic: load draft → guard → re-validate payload →
 * insert card_events row → mark draft approved.
 * Returns metadata the web wrapper uses for recomputeProjectGates +
 * notifyDraftApproved. Does NOT revalidate paths or notify — those are
 * web-only side effects.
 */
export async function approveCardEventDraft(
  supabase: SupabaseClient<Database>,
  args: ApproveDraftInputType,
): Promise<ApproveDraftResult> {
  const { draftId, approverId } = args;

  // Load the draft
  const { data: draft, error: dErr } = await supabase
    .from("data_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (dErr || !draft) return { ok: false, error: "Draft tidak ditemukan" };
  if (draft.status !== "draft") return { ok: false, error: `Draft sudah ${draft.status}` };
  if (draft.draft_type !== "card_event") return { ok: false, error: "Draft bukan card_event" };

  const proposed = draft.proposed_payload as {
    kind: string;
    payload: Record<string, unknown>;
    card_id: string;
    occurred_at: string;
  };

  // Re-validate the payload defensively
  const schema = EventPayloadSchemas[proposed.kind as keyof typeof EventPayloadSchemas];
  if (!schema) return { ok: false, error: `Kind tidak valid: ${proposed.kind}` };
  const recheck = schema.safeParse(proposed.payload);
  if (!recheck.success) return { ok: false, error: "Payload tidak lolos validasi ulang" };

  const eventKind = proposed.kind as EventKind;

  // Insert the card_event
  const { data: ev, error: evErr } = await supabase
    .from("card_events")
    .insert({
      card_id:            proposed.card_id,
      project_id:         draft.project_id,
      event_kind:         eventKind as Database["public"]["Enums"]["card_event_kind"],
      payload:            proposed.payload as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
      occurred_at:        proposed.occurred_at,
      logged_by_staff_id: draft.created_by_staff_id,
      source_kind:        "chat",
      cost_visible:       COST_VISIBLE_KINDS.has(eventKind),
      draft_id:           draft.id,
    })
    .select("id")
    .single();
  if (evErr) return { ok: false, error: evErr.message };

  // Mark the draft approved + record promotion
  await supabase.from("data_drafts").update({
    status:               "approved",
    approved_by_staff_id: approverId,
    approved_at:          new Date().toISOString(),
    promoted_record_type: "card_events",
    promoted_record_id:   ev.id,
  }).eq("id", draftId);

  // Fetch card slug + project code so the web wrapper can build notification
  // args and revalidation paths without an extra round-trip.
  const { data: cardRow } = await supabase
    .from("cards")
    .select("slug")
    .eq("id", proposed.card_id)
    .maybeSingle();
  const { data: projRow } = await supabase
    .from("projects")
    .select("project_code")
    .eq("id", draft.project_id)
    .maybeSingle();

  return {
    ok: true,
    eventId: ev.id,
    projectId: draft.project_id,
    projectCode: projRow?.project_code ?? null,
    cardSlug: cardRow?.slug ?? null,
    eventKind,
    draftAuthorId: draft.created_by_staff_id,
    gateRelevant: GATE_RELEVANT_KINDS.has(eventKind),
  };
}
