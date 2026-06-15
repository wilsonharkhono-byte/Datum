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
import { computeCardDeadlines, type CardDeadline, type DeadlineCell } from "@/lib/gates/board-deadlines";
import type { LabelEvent } from "@/lib/cards/labels";

export type BoardColumn = { topic: Topic; cards: CardWithLabels[] };
export type Board = { project: Project; columns: BoardColumn[] };
export type CardDetail = { card: Card; events: CardEvent[] };

export type BoardBundle = {
  project: Project;
  topics: Pick<Topic, "id" | "code" | "name" | "sort_order">[];
  cards: Pick<Card, "id" | "slug" | "title" | "topic_id" | "status" | "last_event_at" | "current_summary" | "properties">[];
  loop_events: { id: string; card_id: string; event_kind: string; payload: Record<string, unknown> | null; occurred_at: string; created_at: string }[];
  card_areas: { card_id: string; area_id: string }[];
  gate_status: DeadlineCell[];
};

export async function getBoardForProject(
  supabase: SupabaseClient<Database>,
  projectSlug: string,
): Promise<Board> {
  // Single round-trip via the get_board_bundle RPC. Typed through a local cast so
  // this compiles whether or not types.generated.ts has been regenerated yet.
  const rpc = supabase.rpc as unknown as (
    fn: "get_board_bundle",
    args: { p_code: string },
  ) => Promise<{ data: BoardBundle | null; error: { message: string } | null }>;
  const { data, error } = await rpc("get_board_bundle", { p_code: projectSlug });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Project not found: ${projectSlug}`);
  return mapBoardBundle(data, new Date().toISOString().slice(0, 10));
}

/** Pure: turn a get_board_bundle payload into the Board the UI renders. Holds all
    label/deadline/grouping logic so it stays in one tested place. */
export function mapBoardBundle(bundle: BoardBundle, today: string): Board {
  const eventsByCard = new Map<string, LabelEvent[]>();
  for (const ev of bundle.loop_events) {
    const arr = eventsByCard.get(ev.card_id) ?? [];
    arr.push({
      event_kind: ev.event_kind,
      payload: ev.payload,
      occurred_at: ev.occurred_at,
      created_at: ev.created_at,
      id: ev.id,
    });
    eventsByCard.set(ev.card_id, arr);
  }

  const cards = (bundle.cards as unknown) as Card[];
  const deadlines = cards.length
    ? computeCardDeadlines(bundle.card_areas, bundle.gate_status, today)
    : new Map<string, CardDeadline>();

  const cardsByTopic = new Map<string, CardWithLabels[]>();
  for (const c of cards) {
    const labels = computeCardLabels(c, eventsByCard.get(c.id) ?? []);
    const withLabels: CardWithLabels = { ...c, labels, deadline: deadlines.get(c.id) ?? null };
    const arr = cardsByTopic.get(c.topic_id) ?? [];
    arr.push(withLabels);
    cardsByTopic.set(c.topic_id, arr);
  }

  const columns: BoardColumn[] = ((bundle.topics as unknown) as Topic[]).map((t) => ({
    topic: t,
    cards: cardsByTopic.get(t.id) ?? [],
  }));

  return { project: bundle.project, columns };
}

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
