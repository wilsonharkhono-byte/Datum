import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";
import {
  EVENT_KINDS,
  EventPayloadSchemas,
  COST_VISIBLE_KINDS,
  type EventKind,
} from "@datum/types";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const CreateCardEventInput = z.object({
  cardId:           z.string().uuid(),
  projectId:        z.string().uuid(),
  eventKind:        z.enum(EVENT_KINDS),
  payload:          z.record(z.unknown()),
  occurredAt:       z.string().optional(),
  loggedByStaffId:  z.string().uuid(),
});

export type CreateCardEventInputType = z.infer<typeof CreateCardEventInput>;

// ─── Result ──────────────────────────────────────────────────────────────────

export type CreateCardEventResult =
  | { ok: true; eventId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

// ─── Mutation ────────────────────────────────────────────────────────────────

/**
 * Insert a card event row.
 *
 * Validates the payload against EventPayloadSchemas[kind] and inserts into
 * card_events. Returns the new event id on success.
 *
 * Side effects (gate recompute, notifications) are NOT run here — the web
 * server action and the mobile call site orchestrate those after this returns.
 */
export async function createCardEvent(
  supabase: SupabaseClient<Database>,
  input: CreateCardEventInputType,
): Promise<CreateCardEventResult> {
  // Validate the payload against the kind schema.
  const schema = EventPayloadSchemas[input.eventKind as EventKind];
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      if (issue.path[0] && typeof issue.path[0] === "string") {
        fieldErrors[issue.path[0]] = issue.message;
      }
    }
    return { ok: false, error: "Isi data wajib", fieldErrors };
  }

  const occurred = input.occurredAt
    ? new Date(input.occurredAt).toISOString()
    : new Date().toISOString();

  const { data, error } = await supabase
    .from("card_events")
    .insert({
      card_id:            input.cardId,
      project_id:         input.projectId,
      event_kind:         input.eventKind as Database["public"]["Enums"]["card_event_kind"],
      payload:            parsed.data as unknown as Database["public"]["Tables"]["card_events"]["Insert"]["payload"],
      occurred_at:        occurred,
      logged_by_staff_id: input.loggedByStaffId,
      source_kind:        "manual",
      cost_visible:       COST_VISIBLE_KINDS.has(input.eventKind),
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, eventId: data.id };
}
