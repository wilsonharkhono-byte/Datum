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
  // "Apa keputusannya?" — optional inline capture from the "Tandai diputuskan"
  // flow. There is no p_outcome RPC param (that would require a migration —
  // see resolve_card_event's fixed (uuid, text, text) signature). Instead the
  // caller folds this into `reason` with a "Keputusan: " prefix so it lands
  // in the existing record_revisions.reason column via the unmodified RPC.
  // getDecisionOutcomesByCardEvent (apps/web/lib/cards/queries.ts) reads it
  // back out for the timeline. Empty/omitted leaves reason untouched.
  outcome:   z.string().max(500).optional(),
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
 * resolve_card_event's signature is fixed at (uuid, text, text) — no p_outcome
 * param (adding one would require a migration, which the decision-outcome
 * capture feature is not allowed to ship). Instead `outcome` is folded into
 * `reason` as a "Keputusan: {outcome}" line before the call, so it lands in
 * the existing record_revisions.reason column. If both `reason` and `outcome`
 * are supplied, the decision line comes first, then the reason on its own
 * line — today only `outcome` is ever sent (the "Apa keputusannya?" input),
 * but the combination is handled so a future caller-supplied reason isn't
 * silently dropped.
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
    p_reason:     combineReasonAndOutcome(input.reason, input.outcome),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Merge the free-text `reason` and the "Apa keputusannya?" `outcome` into a
 *  single string for the RPC's p_reason param. Prefixes outcome with
 *  "Keputusan: " so getDecisionOutcomesByCardEvent can recognize and strip it
 *  back out when rendering the timeline. Returns undefined when both are
 *  empty/omitted so the RPC's own default (null) applies unchanged. */
function combineReasonAndOutcome(
  reason: string | undefined,
  outcome: string | undefined,
): string | undefined {
  const trimmedOutcome = outcome?.trim();
  const trimmedReason = reason?.trim();
  const parts: string[] = [];
  if (trimmedOutcome) parts.push(`Keputusan: ${trimmedOutcome}`);
  if (trimmedReason) parts.push(trimmedReason);
  return parts.length > 0 ? parts.join(" — ") : undefined;
}
