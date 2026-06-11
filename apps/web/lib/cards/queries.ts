import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  Project,
  Topic,
  Card,
  CardEvent,
  CardComment,
  CardAttachment,
  CardMember,
  Staff,
} from "@datum/db";
import { computeCardLabels, type CardWithLabels } from "@/lib/cards/labels";

export type BoardColumn = { topic: Topic; cards: CardWithLabels[] };
export type Board = { project: Project; columns: BoardColumn[] };
export type CardDetail = { card: Card; events: CardEvent[] };

const LABEL_LOOKBACK_DAYS = 30;

export async function getBoardForProject(
  supabase: SupabaseClient<Database>,
  projectSlug: string,
): Promise<Board> {
  // Pilot: projects.slug not yet a column; fall back to project_code lookup case-insensitively.
  const slugUpper = projectSlug.toUpperCase();
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("*")
    .eq("project_code", slugUpper)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project) throw new Error(`Project not found: ${projectSlug}`);

  const sinceIso = new Date(Date.now() - LABEL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [topicsRes, cardsRes, recentEventsRes] = await Promise.all([
    supabase
      .from("topics")
      .select("*")
      .eq("project_id", project.id)
      .order("sort_order", { ascending: true }),
    supabase
      .from("cards")
      .select("*")
      .eq("project_id", project.id)
      .order("last_event_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("card_events")
      .select("card_id, event_kind")
      .eq("project_id", project.id)
      .gte("occurred_at", sinceIso),
  ]);
  if (topicsRes.error) throw topicsRes.error;
  if (cardsRes.error) throw cardsRes.error;
  if (recentEventsRes.error) {
    console.warn("[getBoardForProject] recent events query failed — labels will be empty:", recentEventsRes.error.message);
  }

  // Group recent event kinds by card so we can derive labels without a per-card round-trip.
  const recentKindsByCard = new Map<string, Set<string>>();
  for (const ev of recentEventsRes.data ?? []) {
    const set = recentKindsByCard.get(ev.card_id) ?? new Set<string>();
    set.add(ev.event_kind);
    recentKindsByCard.set(ev.card_id, set);
  }

  const cardsByTopic = new Map<string, CardWithLabels[]>();
  for (const c of cardsRes.data ?? []) {
    const labels = computeCardLabels(c, recentKindsByCard.get(c.id) ?? new Set());
    const withLabels: CardWithLabels = { ...c, labels };
    const arr = cardsByTopic.get(c.topic_id) ?? [];
    arr.push(withLabels);
    cardsByTopic.set(c.topic_id, arr);
  }

  const columns: BoardColumn[] = (topicsRes.data ?? []).map((t) => ({
    topic: t,
    cards: cardsByTopic.get(t.id) ?? [],
  }));

  return { project, columns };
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

  const { data: events, error: evErr } = await supabase
    .from("card_events")
    .select("*")
    .eq("card_id", card.id)
    .order("occurred_at", { ascending: false });
  if (evErr) throw evErr;

  return { card, events: events ?? [] };
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

// ─── Slice 1.2a — card members ────────────────────────────────────────────────

export type CardMemberWithStaff = CardMember & {
  staff: Pick<Staff, "id" | "full_name" | "role"> | null;
};

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

// ─── Slice 1.2b — move card ───────────────────────────────────────────────────

export async function getProjectTopics(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<Topic[]> {
  const { data, error } = await supabase
    .from("topics")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
