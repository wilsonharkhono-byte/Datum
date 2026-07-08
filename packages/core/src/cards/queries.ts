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

export type CardDetail = { card: Card; events: CardEventWithLogger[] };

export type CardMemberWithStaff = CardMember & {
  staff: Pick<Staff, "id" | "full_name" | "role"> | null;
};

export type CardCommentWithAuthor = CardComment & {
  author: Pick<Staff, "id" | "full_name" | "role"> | null;
};

export type CardEventWithLogger = CardEvent & {
  logger: Pick<Staff, "id" | "full_name"> | null;
};

async function getTimelineEvents(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CardEventWithLogger[]> {
  const { data: events, error: evErr } = await supabase
    .from("card_events")
    .select("*, logger:logged_by_staff_id (id, full_name)")
    .eq("card_id", cardId)
    .order("occurred_at", { ascending: false });
  if (evErr) throw evErr;
  return (events as unknown as CardEventWithLogger[]) ?? [];
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

export async function getCardComments(
  supabase: SupabaseClient<Database>,
  cardId: string,
): Promise<CardCommentWithAuthor[]> {
  const { data, error } = await supabase
    .from("card_comments")
    .select("*, author:created_by_staff_id (id, full_name, role)")
    .eq("card_id", cardId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as unknown as CardCommentWithAuthor[]) ?? [];
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
