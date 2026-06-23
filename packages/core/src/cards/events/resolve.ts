import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@datum/db";

// ─── Schema ───────────────────────────────────────────────────────────────────

export const RESOLVE_STATUSES = [
  "needs_decision",
  "decided",
  "superseded",
  "open",
  "answered",
] as const;

export type ResolveStatus = (typeof RESOLVE_STATUSES)[number];

export const ResolveEventInput = z.object({
  eventId:   z.string().uuid(),
  newStatus: z.enum(RESOLVE_STATUSES),
  reason:    z.string().max(500).optional(),
});

export type ResolveEventInputType = z.infer<typeof ResolveEventInput>;

// ─── Result ──────────────────────────────────────────────────────────────────

export type ResolveEventResult =
  | { ok: true }
  | { ok: false; error: string };

// ─── Mutation ────────────────────────────────────────────────────────────────

/**
 * Mark an open-loop event resolved by calling the resolve_card_event RPC.
 *
 * The RPC updates the payload.status field and appends a record_revisions
 * audit row in one atomic transaction. RLS and the RPC enforce who may resolve.
 *
 * Web-only side effects (revalidatePath) stay in the server action wrapper.
 */
export async function resolveCardEvent(
  supabase: SupabaseClient<Database>,
  input: ResolveEventInputType,
): Promise<ResolveEventResult> {
  const { error } = await supabase.rpc("resolve_card_event", {
    p_event_id:   input.eventId,
    p_new_status: input.newStatus,
    p_reason:     input.reason ?? undefined,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
