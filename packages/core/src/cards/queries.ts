import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Card,
  CardEvent,
  CardComment,
  CardAttachment,
  CardMember,
  Staff,
} from "@datum/db";

export type CardDetail = { card: Card; events: CardEvent[] };

export type CardMemberWithStaff = CardMember & {
  staff: Pick<Staff, "id" | "full_name" | "role"> | null;
};

async function getTimelineEvents(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CardEvent[]> {
  const { data: events, error: evErr } = await supabase
    .from("card_events")
    .select("*")
    .eq("card_id", cardId)
    .order("occurred_at", { ascending: false });
  if (evErr) throw evErr;
  return events ?? [];
}

export async function getCardWithTimeline(
  supabase: SupabaseClient<Database>,
  projectId: string,
  cardSlug: string,
): Promise<CardDetail> {
  const { data: card, error: cardErr } = await supabase
    .from("cards")
    .select("*")
    .eq("project_id", projectId)
    .eq("slug", cardSlug)
    .maybeSingle();
  if (cardErr) throw cardErr;
  if (!card) throw new Error(`Card not found: ${cardSlug}`);

  return { card, events: await getTimelineEvents(supabase, card.id) };
}

export async function getCardWithTimelineByProjectCode(
  supabase: SupabaseClient<Database>,
  projectCode: string,
  cardSlug: string,
): Promise<CardDetail> {
  const { data, error: cardErr } = await supabase
    .from("cards")
    .select("*, projects!inner(project_code)")
    .eq("projects.project_code", projectCode)
    .eq("slug", cardSlug)
    .maybeSingle();
  if (cardErr) throw cardErr;
  if (!data) throw new Error(`Card not found: ${cardSlug}`);

  const { projects: _projects, ...card } = data;
  return { card: card as Card, events: await getTimelineEvents(supabase, card.id) };
}

export async function getCardAttachments(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<Map<string, CardAttachment[]>> {
  // Two-query approach to avoid type-inference issues with nested join syntax.
  const { data: events, error: evErr } = await supabase
    .from("card_events")
    .select("id")
    .eq("card_id", cardId);
  if (evErr) throw evErr;

  const eventIds = (events ?? []).map((e) => e.id);
  if (eventIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("card_attachments")
    .select("*")
    .in("card_event_id", eventIds);
  if (error) throw error;

  const byEvent = new Map<string, CardAttachment[]>();
  for (const a of data ?? []) {
    const arr = byEvent.get(a.card_event_id) ?? [];
    arr.push(a as CardAttachment);
    byEvent.set(a.card_event_id, arr);
  }
  return byEvent;
}

/**
 * Fix 3 rework (decision outcome capture, plan-compliant): resolve_card_event
 * has no p_outcome param (that would need a migration). The "Apa
 * keputusannya?" text instead rides the RPC's existing p_reason param as a
 * "Keputusan: {text}" line (see resolveCardEvent/combineReasonAndOutcome in
 * cards/events/resolve.ts), landing in record_revisions.reason — a column
 * that already exists and is already readable via RLS
 * (record_revisions_read_visible: current_can_read_project). This reads it
 * back out per event so the timeline can render it. Only the latest
 * 'corrected' revision per event_id is returned (a decision could in theory
 * be resolved more than once across its lifecycle); revisions without the
 * "Keputusan: " prefix (plain reasons, or older non-decision resolutions)
 * are skipped.
 */
export async function getDecisionOutcomesByCardEvent(
  supabase: SupabaseClient<Database>,
  cardEventIds: string[],
): Promise<Map<string, string>> {
  if (cardEventIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("record_revisions")
    .select("entity_id, reason, created_at")
    .eq("entity_type", "card_event")
    .eq("revision_type", "corrected")
    .in("entity_id", cardEventIds)
    .not("reason", "is", null)
    .order("created_at", { ascending: true }); // last write wins on insert below
  if (error) throw error;

  const OUTCOME_PREFIX = "Keputusan: ";
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const reason = row.reason ?? "";
    // A combined "Keputusan: X — reason" string — take just the decision part.
    const afterPrefix = reason.startsWith(OUTCOME_PREFIX) ? reason.slice(OUTCOME_PREFIX.length) : null;
    if (afterPrefix === null) continue;
    const outcome = afterPrefix.split(" — ")[0]!.trim();
    if (outcome.length === 0) continue;
    map.set(row.entity_id, outcome); // later (later created_at) overwrites earlier
  }
  return map;
}

export async function getCardComments(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CardComment[]> {
  const { data, error } = await supabase
    .from("card_comments")
    .select("*")
    .eq("card_id", cardId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getCardMembers(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CardMemberWithStaff[]> {
  const { data, error } = await supabase
    .from("card_members")
    .select("*, staff:staff_id (id, full_name, role)")
    .eq("card_id", cardId)
    .is("removed_at", null)
    .order("added_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as CardMemberWithStaff[]) ?? [];
}

export async function getProjectStaff(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<Pick<Staff, "id" | "full_name" | "role">[]> {
  // Staff assigned to this project plus cross-project-read roles
  const { data, error } = await supabase
    .from("staff")
    .select("id, full_name, role")
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Pick<Staff, "id" | "full_name" | "role">[];
}
